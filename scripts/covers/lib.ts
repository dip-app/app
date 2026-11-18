// Shared helpers for the event cover library tooling (see docs/design/cover-library.md).
// Run with: node --import tsx scripts/covers/<script>.ts
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DEFAULT_COVERS_DIR = path.join(REPO_ROOT, "apps/admin/public/img/covers");
export const DEFAULT_INDEX_PATH = path.join(
  REPO_ROOT,
  "gcp/functions/src/modules/covers/domain/catalog.generated.ts",
);

// sharp is installed in apps/admin (not a root dependency).
const adminRequire = createRequire(path.join(REPO_ROOT, "apps/admin/package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sharp: any = adminRequire("sharp");

export const THEMES = [
  "outdoors", "food", "arts", "games", "music", "learning", "volunteering", "wellness", "fitness",
] as const;
export const MOODS = ["calm", "energetic", "social", "cozy", "festive", "focused", "playful"] as const;
export const SEASONS = ["spring", "summer", "autumn", "winter", "any"] as const;
export const KINDS = ["photo", "illustration"] as const;
export const LICENSE_TYPES = ["pexels", "unsplash", "pixabay", "dip-original", "prototype-unconfirmed"] as const;
export const ATTRIBUTED_LICENSES = ["pexels", "unsplash", "pixabay"];
export const LEGACY_CATEGORIES = ["fitness", "outdoors", "hiking", "games", "cooking"] as const;

export const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TAG_RE = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/;
export const COLOR_RE = /^#[0-9A-F]{6}$/;

const KB = 1024;
export const LIMITS = {
  fullBytes: 150 * KB,
  thumbBytes: 30 * KB,
  jpegBytes: 100 * KB,
  totalBytes: 40 * KB * KB,
  fullWidthMax: 1200,
  fullWidthMin: 960,
  thumbWidth: 400,
  jpegWidth: 960,
  labelMax: 40,
  altMax: 160,
  aspect: 1.6,
  aspectTolerance: 0.01,
} as const;

export type Theme = (typeof THEMES)[number];

export interface License {
  type: string;
  source: string;
  sourceURL: string;
  creator: string;
  creatorURL: string;
  notes: string;
}

export interface CoverEntry {
  key: string;
  url: string;
  kind: "photo" | "illustration";
  file: string;
  thumb: string;
  jpeg: string;
  width: number;
  height: number;
  themes: string[];
  tags: string[];
  mood: string[];
  season: string[];
  label: string;
  alt: string;
  orientation: "landscape";
  dominantColor: string;
  bytes: { full: number; thumb: number; jpeg: number };
  sha256: string;
  /** Optional; missing means true. false = never offered to Dipbot automatic picks (still selectable manually). */
  autoPick?: boolean;
  license: License;
}

export interface Manifest {
  version: 1;
  baseURL: string;
  themeDefaults: Record<string, string>;
  covers: CoverEntry[];
}

export const DEFAULT_THEME_DEFAULTS: Record<string, string> = {
  outdoors: "default-outdoors",
  fitness: "default-fitness",
  food: "default-cooking",
  games: "default-games",
  arts: "theme-arts",
  music: "theme-music",
  learning: "theme-learning",
  volunteering: "theme-volunteering",
  wellness: "theme-wellness",
};

export function emptyManifest(): Manifest {
  return {
    version: 1,
    baseURL: "https://letsdip.work/img/covers/",
    themeDefaults: { ...DEFAULT_THEME_DEFAULTS },
    covers: [],
  };
}

// ---------- CLI helpers ----------

export interface Args {
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
      flags[a.slice(2)] = argv[++i];
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { flags };
}

export function flagString(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

export function coversDirFrom(args: Args): string {
  const root = flagString(args, "root");
  return root ? path.resolve(root) : DEFAULT_COVERS_DIR;
}

// ---------- small utilities ----------

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function slugKey(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function urlForKey(key: string): string {
  const legacy = (LEGACY_CATEGORIES as readonly string[]).find((c) => key === `default-${c}`);
  return legacy ? `catalog://default/${legacy}` : `catalog://cover/${key}`;
}

export function hex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string") return value.split(/[;|,]/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  return [];
}

export function readManifest(coversDir: string): Manifest {
  const file = path.join(coversDir, "manifest.json");
  if (!fs.existsSync(file)) return emptyManifest();
  return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

export function writeManifest(coversDir: string, manifest: Manifest): void {
  manifest.covers.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  fs.mkdirSync(coversDir, { recursive: true });
  fs.writeFileSync(path.join(coversDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

// ---------- image pipeline ----------

export interface BuiltImages {
  full: Buffer;
  thumb: Buffer;
  jpeg: Buffer;
  width: number;
  height: number;
  dominantColor: string;
}

async function encodeUnder(
  encode: (quality: number) => Promise<Buffer>,
  limit: number,
  start: number,
  floor: number,
  label: string,
): Promise<Buffer> {
  let last = Buffer.alloc(0);
  for (let q = start; q >= floor; q -= 4) {
    last = await encode(q);
    if (last.length <= limit) return last;
  }
  throw new Error(`${label} still ${last.length} bytes at quality ${floor} (limit ${limit})`);
}

function position(gravity: string | undefined): unknown {
  const g = (gravity ?? "attention").toLowerCase();
  if (g === "attention") return sharp.strategy.attention;
  if (g === "entropy") return sharp.strategy.entropy;
  const map: Record<string, string> = {
    center: "centre", centre: "centre", north: "north", south: "south", east: "east", west: "west",
    northeast: "north east", northwest: "north west", southeast: "south east", southwest: "south west",
  };
  if (!map[g]) throw new Error(`unknown crop gravity "${gravity}"`);
  return map[g];
}

/** Crop to 16:10 and encode full webp, thumb webp and jpeg. Never upscales; rejects sources narrower than 960 px. */
export async function buildImages(
  input: Buffer | string,
  opts: { gravity?: string; maxWidth?: number } = {},
): Promise<BuiltImages> {
  const base = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
  const { width: srcW, height: srcH } = base.info;
  const cropW = Math.min(srcW, srcH * LIMITS.aspect);
  if (cropW < LIMITS.fullWidthMin) {
    throw new Error(`source too small: ${srcW}x${srcH} gives ${Math.floor(cropW)} px of 16:10 width, need >= ${LIMITS.fullWidthMin}`);
  }
  const outW = Math.min(opts.maxWidth ?? LIMITS.fullWidthMax, Math.floor(cropW));
  const outH = Math.round(outW / LIMITS.aspect);
  const raw = await sharp(base.data)
    .resize(outW, outH, { fit: "cover", position: position(opts.gravity) })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rawInput = () => sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } });
  const full = await encodeUnder((q) => rawInput().webp({ quality: q, effort: 6 }).toBuffer(), LIMITS.fullBytes, 84, 40, "full webp");
  const thumb = await encodeUnder(
    (q) => rawInput().resize(LIMITS.thumbWidth).webp({ quality: q, effort: 6 }).toBuffer(),
    LIMITS.thumbBytes, 72, 30, "thumb webp",
  );
  const jpeg = await encodeUnder(
    (q) => rawInput().resize(LIMITS.jpegWidth).jpeg({ quality: q, mozjpeg: true }).toBuffer(),
    LIMITS.jpegBytes, 70, 40, "jpeg",
  );
  const { dominant } = await rawInput().stats();
  return { full, thumb, jpeg, width: raw.info.width, height: raw.info.height, dominantColor: hex(dominant.r, dominant.g, dominant.b) };
}

export interface CoverMeta {
  key: string;
  url?: string;
  kind?: "photo" | "illustration";
  themes: string[];
  tags: string[];
  mood: string[];
  season: string[];
  label: string;
  alt: string;
  autoPick?: boolean;
  license: License;
}

export function entryFrom(meta: CoverMeta, img: BuiltImages): CoverEntry {
  return {
    key: meta.key,
    url: meta.url ?? urlForKey(meta.key),
    kind: meta.kind ?? "photo",
    file: `${meta.key}.webp`,
    thumb: `thumbs/${meta.key}.webp`,
    jpeg: `jpg/${meta.key}.jpg`,
    width: img.width,
    height: img.height,
    themes: meta.themes,
    tags: meta.tags,
    mood: meta.mood,
    season: meta.season,
    label: meta.label,
    alt: meta.alt,
    orientation: "landscape",
    dominantColor: img.dominantColor,
    bytes: { full: img.full.length, thumb: img.thumb.length, jpeg: img.jpeg.length },
    sha256: sha256(img.full),
    ...(meta.autoPick === false ? { autoPick: false } : {}),
    license: meta.license,
  };
}

export function writeCoverFiles(coversDir: string, entry: CoverEntry, img: BuiltImages): void {
  for (const sub of ["", "thumbs", "jpg"]) fs.mkdirSync(path.join(coversDir, sub), { recursive: true });
  fs.writeFileSync(path.join(coversDir, entry.file), img.full);
  fs.writeFileSync(path.join(coversDir, entry.thumb), img.thumb);
  fs.writeFileSync(path.join(coversDir, entry.jpeg), img.jpeg);
}

/** Metadata errors for a row, shared by import and validation. */
export function metaErrors(m: Partial<CoverMeta>): string[] {
  const e: string[] = [];
  if (!m.key || !KEY_RE.test(m.key) || m.key.length > 64) e.push(`invalid key "${m.key ?? ""}"`);
  if (!m.themes || m.themes.length < 1 || m.themes.length > 3) e.push("themes must have 1-3 entries");
  for (const t of m.themes ?? []) if (!(THEMES as readonly string[]).includes(t)) e.push(`unknown theme "${t}"`);
  if (!m.tags || m.tags.length < 2 || m.tags.length > 12) e.push("tags must have 2-12 entries");
  for (const t of m.tags ?? []) if (!TAG_RE.test(t)) e.push(`invalid tag "${t}"`);
  if (new Set(m.tags).size !== (m.tags ?? []).length) e.push("duplicate tags");
  if ((m.mood?.length ?? 0) > 3) e.push("mood has more than 3 entries");
  for (const t of m.mood ?? []) if (!(MOODS as readonly string[]).includes(t)) e.push(`unknown mood "${t}"`);
  if (!m.season || m.season.length < 1 || m.season.length > 4) e.push("season must have 1-4 entries");
  for (const t of m.season ?? []) if (!(SEASONS as readonly string[]).includes(t)) e.push(`unknown season "${t}"`);
  if (!m.label || m.label.length > LIMITS.labelMax) e.push(`label required and <= ${LIMITS.labelMax} chars`);
  if (!m.alt || !m.alt.trim()) e.push("alt text is required");
  else if (m.alt.length > LIMITS.altMax) e.push(`alt must be <= ${LIMITS.altMax} chars`);
  if (m.autoPick !== undefined && typeof m.autoPick !== "boolean") e.push("autoPick must be a boolean when present");
  if (m.kind && !(KINDS as readonly string[]).includes(m.kind)) e.push(`unknown kind "${m.kind}"`);
  const l = m.license;
  if (!l || !l.type) e.push("license is required");
  else {
    if (!(LICENSE_TYPES as readonly string[]).includes(l.type)) e.push(`unknown license type "${l.type}"`);
    if (ATTRIBUTED_LICENSES.includes(l.type)) {
      if (!l.sourceURL || !/^https:\/\//.test(l.sourceURL)) e.push(`license ${l.type} requires an https sourceURL`);
      if (!l.creator) e.push(`license ${l.type} requires a creator`);
    }
  }
  return e;
}

// ---------- index generation ----------

export function generateIndexSource(manifest: Manifest): string {
  const entries = [...manifest.covers]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((c) => ({
      key: c.key, url: c.url, kind: c.kind, themes: c.themes, tags: c.tags, mood: c.mood,
      season: c.season, orientation: c.orientation, label: c.label, alt: c.alt, hasJpeg: Boolean(c.jpeg),
      ...(c.autoPick === false ? { autoPick: false } : {}),
    }));
  const defaults: Record<string, string> = {};
  for (const t of Object.keys(manifest.themeDefaults).sort()) defaults[t] = manifest.themeDefaults[t];
  return `// Generated by scripts/covers/generate-index.ts from apps/admin/public/img/covers/manifest.json.
// Do not edit by hand: run \`npm run covers:index\` after changing the manifest.
/* eslint-disable */

export interface CoverIndexEntry {
  key: string;
  url: string;
  kind: "photo" | "illustration";
  themes: readonly string[];
  tags: readonly string[];
  mood: readonly string[];
  season: readonly string[];
  orientation: "landscape" | "portrait" | "square";
  label: string;
  alt: string;
  hasJpeg: boolean;
  autoPick?: boolean;
}

export const COVER_INDEX: readonly CoverIndexEntry[] = ${JSON.stringify(entries, null, 2)};

export const THEME_DEFAULT_KEYS: Readonly<Record<string, string>> = ${JSON.stringify(defaults, null, 2)};
`;
}

// ---------- validation ----------

export interface ValidateOptions {
  minPerTheme?: number;
  indexPath?: string | null; // null/undefined = skip index sync check
}

function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs, r));
    else out.push(r);
  }
  return out;
}

export async function validateCovers(coversDir: string, opts: ValidateOptions = {}): Promise<string[]> {
  const errors: string[] = [];
  const manifestPath = path.join(coversDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return [`missing ${manifestPath}`];
  let manifest: Manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return [`manifest.json is not valid JSON: ${(err as Error).message}`];
  }
  if (manifest.version !== 1) errors.push("manifest.version must be 1");
  if (typeof manifest.baseURL !== "string" || !/^https:\/\/.+\/$/.test(manifest.baseURL)) errors.push("manifest.baseURL must be an https URL ending in /");
  if (!Array.isArray(manifest.covers)) return [...errors, "manifest.covers must be an array"];

  const keys = new Set<string>();
  const hashes = new Map<string, string>();
  const expectedFiles = new Set<string>(["manifest.json"]);
  const themeCounts: Record<string, number> = Object.fromEntries(THEMES.map((t) => [t, 0]));

  for (const c of manifest.covers) {
    const err = (m: string) => errors.push(`[${c?.key}] ${m}`);
    if (keys.has(c.key)) err("duplicate key");
    keys.add(c.key);
    for (const m of metaErrors(c)) err(m);
    if (c.url !== urlForKey(c.key)) err(`url must be ${urlForKey(c.key)} (got ${c.url})`);
    if (c.file !== `${c.key}.webp`) err(`file must be ${c.key}.webp`);
    if (c.thumb !== `thumbs/${c.key}.webp`) err(`thumb must be thumbs/${c.key}.webp`);
    if (c.jpeg !== `jpg/${c.key}.jpg`) err(`jpeg must be jpg/${c.key}.jpg`);
    if (c.orientation !== "landscape") err("orientation must be landscape");
    if (!COLOR_RE.test(c.dominantColor ?? "")) err("dominantColor must be #RRGGBB (uppercase)");
    if (c.sha256) {
      const dup = hashes.get(c.sha256);
      if (dup) err(`duplicate sha256 of ${dup}`);
      hashes.set(c.sha256, c.key);
    } else err("sha256 missing");
    for (const t of c.themes ?? []) if (t in themeCounts) themeCounts[t]++;

    const checks: Array<[string, string, number | undefined, number, string, number | undefined]> = [
      ["full", c.file, c.bytes?.full, LIMITS.fullBytes, "webp", undefined],
      ["thumb", c.thumb, c.bytes?.thumb, LIMITS.thumbBytes, "webp", LIMITS.thumbWidth],
      ["jpeg", c.jpeg, c.bytes?.jpeg, LIMITS.jpegBytes, "jpeg", LIMITS.jpegWidth],
    ];
    for (const [name, rel, declared, limit, format, width] of checks) {
      if (!rel) continue;
      expectedFiles.add(rel);
      const abs = path.join(coversDir, rel);
      if (!fs.existsSync(abs)) { err(`${name} file missing: ${rel}`); continue; }
      const buf = fs.readFileSync(abs);
      if (declared !== buf.length) err(`${name} bytes ${declared} != actual ${buf.length}`);
      if (buf.length > limit) err(`${name} is ${buf.length} bytes, limit ${limit}`);
      let meta;
      try {
        meta = await sharp(buf).metadata();
      } catch {
        err(`${name} file is not a readable image: ${rel}`);
        continue;
      }
      if (meta.format !== format) err(`${name} format is ${meta.format}, expected ${format}`);
      if (width && meta.width !== width) err(`${name} width ${meta.width}, expected ${width}`);
      if (name === "full") {
        if (meta.width !== c.width || meta.height !== c.height) err(`manifest size ${c.width}x${c.height} != actual ${meta.width}x${meta.height}`);
        if (meta.width < LIMITS.fullWidthMin || meta.width > LIMITS.fullWidthMax) err(`full width ${meta.width} outside ${LIMITS.fullWidthMin}-${LIMITS.fullWidthMax}`);
        const ratio = meta.width / meta.height;
        const ok = [1.6, 1.5].some((r) => Math.abs(ratio / r - 1) <= LIMITS.aspectTolerance);
        if (!ok) err(`aspect ${ratio.toFixed(3)} is not 16:10 or 3:2 (+-1%)`);
        if (sha256(buf) !== c.sha256) err("sha256 does not match full file");
      }
    }
  }

  const defaults = manifest.themeDefaults ?? {};
  for (const t of THEMES) {
    const k = defaults[t];
    if (!k) { errors.push(`themeDefaults.${t} missing`); continue; }
    const target = manifest.covers.find((c) => c.key === k);
    if (!target) errors.push(`themeDefaults.${t} -> unknown key ${k}`);
    else if (!target.themes.includes(t)) errors.push(`themeDefaults.${t} -> ${k} does not list theme ${t}`);
  }
  for (const k of Object.keys(defaults)) if (!(THEMES as readonly string[]).includes(k)) errors.push(`themeDefaults has unknown theme ${k}`);

  const min = opts.minPerTheme ?? 1;
  for (const t of THEMES) if (themeCounts[t] < min) errors.push(`theme ${t} has ${themeCounts[t]} images, need >= ${min}`);

  let total = 0;
  for (const rel of walk(coversDir)) {
    total += fs.statSync(path.join(coversDir, rel)).size;
    if (!expectedFiles.has(rel)) errors.push(`stray file in covers dir: ${rel}`);
  }
  if (total > LIMITS.totalBytes) errors.push(`covers dir is ${total} bytes, hard cap ${LIMITS.totalBytes}`);

  if (opts.indexPath) {
    if (!fs.existsSync(opts.indexPath)) errors.push(`catalog index missing: ${opts.indexPath} (run npm run covers:index)`);
    else if (fs.readFileSync(opts.indexPath, "utf8") !== generateIndexSource(manifest)) {
      errors.push("catalog.generated.ts is out of sync with manifest.json (run npm run covers:index)");
    }
  }
  return errors;
}

export function dirSize(dir: string): number {
  return fs.existsSync(dir) ? walk(dir).reduce((n, rel) => n + fs.statSync(path.join(dir, rel)).size, 0) : 0;
}
