// CLI: fetch candidate photos from the official Pixabay API into a staging folder OUTSIDE the repo.
//   node --import tsx scripts/covers/fetch-pixabay.ts [--out <dir>] [--theme food] [--shot <id>] [--candidates 3]
//     [--min-width 1600] [--dry-run]
// The key is read from PIXABAY_API_KEY in the environment only and is never printed or written. It lives in the
// dip-app/secrets repo (backend/functions.enc.env). Load it without echoing, for example:
//   scripts/secrets/pull.sh --only backend --force
//   node --env-file=.secrets-cache/out/functions.env --import tsx scripts/covers/fetch-pixabay.ts
// Output: <out>/images/<key>.jpg, <out>/candidates.json (ranked candidates per shot) and <out>/labels.json
// (input rows for import.ts, license.type "pixabay"; alt text is filled in during curation).
// The client, rate limiter and helpers live in ./pixabay.ts (importable). Pixabay rules honoured: 100 requests per
// 60 seconds per key (sliding window, header aware, retry on 429), images downloaded once from largeImageURL (1280 px)
// or fullHDURL when the account has it, never hotlinked, only a few candidates per shot (no bulk mirroring), search
// results cached on disk for 24 hours.
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_COVERS_DIR, REPO_ROOT, flagString, parseArgs, readManifest, slugKey } from "./lib";
import { PixabayClient, RateLimiter, acceptable, dHash, hamming, pixabayLicense, popularity, queryVariants, relevance, type PixabayHit } from "./pixabay";

export interface Shot { id: string; theme: string; sub: string; label: string; query: string; pixabayQuery?: string; tags: string[]; mood: string[]; season: string[] }
interface Plan { perShotCandidates: number; shots: Shot[] }

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "query-plan.json"), "utf8")) as Plan;
  const out = path.resolve(flagString(args, "out") ?? path.join(process.env.TMPDIR ?? "/tmp", "dip-covers-pixabay"));
  const theme = flagString(args, "theme");
  const only = flagString(args, "shot");
  const candidates = Number(flagString(args, "candidates") ?? 3);
  const minWidth = Number(flagString(args, "min-width") ?? 1600);
  const dryRun = args.flags["dry-run"] === true;

  const rel = path.relative(REPO_ROOT, out);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    console.error("Refusing to stage downloads inside the repository: use a folder outside it (default $TMPDIR/dip-covers-pixabay).");
    process.exit(2);
  }
  const shots = plan.shots.filter((s) => (!theme || s.theme === theme) && (!only || s.id === only));
  if (!shots.length) { console.error("No shots match the filters."); process.exit(2); }
  const queryOf = (s: Shot) => s.pixabayQuery ?? s.query;
  if (dryRun) {
    for (const s of shots) console.log(`[plan] ${s.theme}/${s.sub}: ${queryVariants(queryOf(s)).map((q) => `"${q}"`).join(" | ")}`);
    return;
  }
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) {
    console.error("PIXABAY_API_KEY is not set. Load it from the dip-app/secrets repo without printing it (see the header of this file).");
    process.exit(2);
  }

  const existingKeys = new Set(readManifest(DEFAULT_COVERS_DIR).covers.map((c) => c.key));
  const imagesDir = path.join(out, "images");
  const cacheDir = path.join(out, "cache");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const candPath = path.join(out, "candidates.json");
  const labelsPath = path.join(out, "labels.json");
  const done: Record<string, unknown[]> = fs.existsSync(candPath) ? JSON.parse(fs.readFileSync(candPath, "utf8")) : {};
  const labels: Record<string, unknown>[] = fs.existsSync(labelsPath) ? JSON.parse(fs.readFileSync(labelsPath, "utf8")) : [];
  const usedIds = new Set<number>(Object.values(done).flat().map((c) => (c as { id: number }).id));
  const hashes: bigint[] = [];
  for (const f of fs.readdirSync(imagesDir)) if (f.endsWith(".jpg")) hashes.push(await dHash(fs.readFileSync(path.join(imagesDir, f))));
  const client = new PixabayClient(apiKey, new RateLimiter());

  async function search(q: string, editors: boolean): Promise<PixabayHit[]> {
    const cacheFile = path.join(cacheDir, slugKey(`${q}-${editors ? "ec" : "all"}`) + ".json");
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < 24 * 3600_000) {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as PixabayHit[];
    }
    const hits = await client.search({ q, editorsChoice: editors, minWidth });
    fs.writeFileSync(cacheFile, JSON.stringify(hits));
    return hits;
  }

  let requests = 0;
  for (const shot of shots) {
    if (done[shot.id]) continue;
    const pool = new Map<number, { hit: PixabayHit; editors: boolean }>();
    for (const q of queryVariants(queryOf(shot))) {
      for (const editors of [true, false]) {
        const hits = await search(q, editors); requests++;
        for (const h of hits) {
          if (!acceptable(h, minWidth) || usedIds.has(h.id) || relevance(h, queryOf(shot)) < 0.5) continue;
          const prev = pool.get(h.id);
          if (!prev || (editors && !prev.editors)) pool.set(h.id, { hit: h, editors: editors || !!prev?.editors });
        }
      }
      if (pool.size >= candidates * 4) break;
    }
    const rank = (x: { hit: PixabayHit; editors: boolean }) => relevance(x.hit, queryOf(shot)) * 4 + Number(x.editors) + popularity(x.hit) * 0.5;
    const ranked = [...pool.values()].sort((a, b) => rank(b) - rank(a));
    const kept: unknown[] = [];
    for (const item of ranked) {
      if (kept.length >= candidates) break;
      const hit = item.hit;
      const key = slugKey(`${shot.id}-${hit.id}`);
      if (existingKeys.has(key)) continue;
      let buf: Buffer;
      try { buf = await client.download(hit); } catch { continue; }
      const h = await dHash(buf);
      if (hashes.some((o) => hamming(o, h) <= 6)) continue; // near-duplicate of a staged image
      hashes.push(h);
      usedIds.add(hit.id);
      fs.writeFileSync(path.join(imagesDir, `${key}.jpg`), buf);
      kept.push({ key, id: hit.id, editors: item.editors, score: Number(rank(item).toFixed(2)), tags: hit.tags, user: hit.user, pageURL: hit.pageURL, w: hit.imageWidth, h: hit.imageHeight });
      labels.push({
        key, file: `${key}.jpg`, shot: shot.id, themes: [shot.theme], tags: shot.tags, mood: shot.mood, season: shot.season,
        label: shot.label, alt: "", license: pixabayLicense(hit),
      });
    }
    done[shot.id] = kept;
    fs.writeFileSync(candPath, JSON.stringify(done, null, 2) + "\n");
    fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2) + "\n");
    console.log(`${shot.id}: ${kept.length} candidate(s) (${requests} searches so far)`);
  }
  console.log(`Staged in ${out}. Curate (alt text, drop weak rows), then: npm run covers:import -- --src ${imagesDir} --labels <labels.json>`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
}
