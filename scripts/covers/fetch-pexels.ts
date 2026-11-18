// Fetch candidate photos from the official Pexels API into a staging folder OUTSIDE public/.
//   PEXELS_API_KEY=... node --import tsx scripts/covers/fetch-pexels.ts [--out .covers-staging] [--theme food] [--shot <id>]
//     [--candidates 2] [--max-requests 150] [--delay 20] [--dry-run]
// The key is read from the environment only and is never printed or written. It lives in the dip-app/secrets repo
// as PEXELS_API_KEY. Output: <out>/images/<key>.jpg and <out>/labels.json (input for import.ts, license.type "pexels").
// Review the candidates, delete rows/files you do not want, then run import.ts --src <out>/images --labels <out>/labels.json.
// Pexels limits: 200 requests/hour, 20,000/month. Default pacing is one API call per 20 s and 150 calls per run.
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_COVERS_DIR, REPO_ROOT, flagString, parseArgs, readManifest, slugKey } from "./lib";

interface Shot { id: string; theme: string; sub: string; label: string; query: string; tags: string[]; mood: string[]; season: string[] }
interface Plan { perShotCandidates: number; shots: Shot[] }
interface PexelsPhoto {
  id: number; width: number; height: number; url: string; photographer: string; photographer_url: string; alt?: string;
  src: { large2x: string };
}
interface State { doneShots: string[]; usedPhotoIds: number[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "query-plan.json"), "utf8")) as Plan;
  const out = path.resolve(flagString(args, "out") ?? path.join(REPO_ROOT, ".covers-staging"));
  const theme = flagString(args, "theme");
  const only = flagString(args, "shot");
  const candidates = Number(flagString(args, "candidates") ?? plan.perShotCandidates ?? 2);
  const maxRequests = Number(flagString(args, "max-requests") ?? 150);
  const delayMs = Number(flagString(args, "delay") ?? 20) * 1000;
  const dryRun = args.flags["dry-run"] === true;

  const rel = path.relative(REPO_ROOT, out);
  if (rel === "apps" || rel.startsWith("apps" + path.sep) || out.startsWith(DEFAULT_COVERS_DIR)) {
    console.error("Refusing to stage downloads under apps/: use a folder outside public/ (default .covers-staging/).");
    process.exit(2);
  }

  const existing = new Set(readManifest(DEFAULT_COVERS_DIR).covers.map((c) => c.key));
  const shots = plan.shots.filter((s) => (!theme || s.theme === theme) && (!only || s.id === only));
  if (!shots.length) { console.error("No shots match the filters."); process.exit(2); }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!dryRun && !apiKey) {
    console.error("PEXELS_API_KEY is not set.\nGet it from the dip-app/secrets repo (PEXELS_API_KEY) and export it for this shell only:\n  export PEXELS_API_KEY=...\nOr use --dry-run to list the planned queries.");
    process.exit(2);
  }

  const imagesDir = path.join(out, "images");
  const statePath = path.join(out, "state.json");
  const labelsPath = path.join(out, "labels.json");
  fs.mkdirSync(imagesDir, { recursive: true });
  const state: State = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { doneShots: [], usedPhotoIds: [] };
  const labels: Record<string, unknown>[] = fs.existsSync(labelsPath) ? JSON.parse(fs.readFileSync(labelsPath, "utf8")) : [];
  const save = () => {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
    fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2) + "\n");
  };

  let requests = 0;
  for (const shot of shots) {
    if (state.doneShots.includes(shot.id)) continue;
    if (dryRun) { console.log(`[plan] ${shot.theme}/${shot.sub}: "${shot.query}"`); continue; }
    if (requests >= maxRequests) { console.log(`Reached --max-requests ${maxRequests}; re-run later to continue (progress is saved).`); break; }

    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", shot.query);
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("size", "large");
    url.searchParams.set("per_page", "15");
    const res = await fetch(url, { headers: { Authorization: apiKey! } });
    requests++;
    const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "NaN");
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? "NaN");
    if (res.status === 429) {
      console.error(`Rate limited by Pexels. Progress saved; try again after ${Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : "an hour"}.`);
      break;
    }
    if (!res.ok) { console.error(`Pexels returned ${res.status} for shot ${shot.id}; skipping.`); await sleep(delayMs); continue; }
    const body = (await res.json()) as { photos: PexelsPhoto[] };

    const picks = body.photos
      .filter((p) => p.width >= 1600 && p.width / p.height >= 1.45 && p.width / p.height <= 1.9)
      .filter((p) => !state.usedPhotoIds.includes(p.id))
      .slice(0, candidates);
    let n = 0;
    for (const p of picks) {
      const key = slugKey(`${shot.id}-${p.id}`);
      if (existing.has(key)) continue;
      const img = await fetch(p.src.large2x);
      if (!img.ok) { console.error(`Download failed (${img.status}) for ${key}`); continue; }
      fs.writeFileSync(path.join(imagesDir, `${key}.jpg`), Buffer.from(await img.arrayBuffer()));
      labels.push({
        key,
        file: `${key}.jpg`,
        themes: [shot.theme],
        tags: shot.tags,
        mood: shot.mood,
        season: shot.season,
        label: shot.label,
        alt: clip(p.alt || `${shot.label}: ${shot.query}`, 160),
        license: {
          type: "pexels",
          source: "Pexels",
          sourceURL: p.url,
          creator: p.photographer,
          creatorURL: p.photographer_url,
          notes: "Pexels License; fetched via the official API",
        },
      });
      state.usedPhotoIds.push(p.id);
      n++;
      await sleep(1000);
    }
    state.doneShots.push(shot.id);
    save();
    console.log(`${shot.id}: ${n} candidate(s) staged (${requests} API calls this run, ${Number.isFinite(remaining) ? remaining : "?"} remaining this window)`);
    if (Number.isFinite(remaining) && remaining < 10) { console.log("Fewer than 10 requests left in the window; stopping."); break; }
    await sleep(delayMs);
  }
  if (!dryRun) {
    save();
    console.log(`Staged in ${path.relative(process.cwd(), out) || out}. Review, then:\n  npm run covers:import -- --src ${path.join(out, "images")} --labels ${labelsPath}`);
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
