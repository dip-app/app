// Import curated images into the cover library.
//   node --import tsx scripts/covers/import.ts --src <folder> --labels <labels.csv|labels.json> [--root <coversDir>] [--dry-run]
// labels.json: array of rows (or { "covers": [...] }). labels.csv: header row; list columns use ";" or "|".
// Row fields: key?, file, themes, tags, mood?, season?, label, alt, kind?, gravity?,
//   autoPick? (default true; false/0/no keeps it out of Dipbot automatic picks), license {type, source, sourceURL, creator, creatorURL, notes} (CSV: license_type, license_source, license_source_url,
//   license_creator, license_creator_url, license_notes).
import fs from "node:fs";
import path from "node:path";
import {
  buildImages, coversDirFrom, entryFrom, flagString, metaErrors, parseArgs, readManifest, slugKey, toList,
  writeCoverFiles, writeManifest, type CoverMeta, type License,
} from "./lib";

export interface ImportRow extends Partial<CoverMeta> {
  file: string;
  gravity?: string;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((c) => c.trim() !== "")) rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

function normalizeRow(raw: Record<string, unknown>): ImportRow {
  const lic = (raw.license ?? {}) as Partial<License>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const license: License = {
    type: s(lic.type) || s(raw.license_type),
    source: s(lic.source) || s(raw.license_source),
    sourceURL: s(lic.sourceURL) || s(raw.license_source_url),
    creator: s(lic.creator) || s(raw.license_creator),
    creatorURL: s(lic.creatorURL) || s(raw.license_creator_url),
    notes: s(lic.notes) || s(raw.license_notes),
  };
  const label = s(raw.label);
  return {
    key: s(raw.key) || slugKey(label),
    file: s(raw.file),
    kind: (s(raw.kind) || "photo") as "photo" | "illustration",
    themes: toList(raw.themes),
    tags: toList(raw.tags),
    mood: toList(raw.mood),
    season: toList(raw.season).length ? toList(raw.season) : ["any"],
    label,
    alt: s(raw.alt),
    gravity: s(raw.gravity) || undefined,
    ...(raw.autoPick === false || /^(false|0|no)$/i.test(s(raw.autoPick)) ? { autoPick: false } : {}),
    license,
  };
}

export function loadRows(labelsPath: string): ImportRow[] {
  const text = fs.readFileSync(labelsPath, "utf8");
  if (labelsPath.endsWith(".json")) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.covers;
    return (list as Record<string, unknown>[]).map(normalizeRow);
  }
  return parseCsv(text).map((r) => normalizeRow(r));
}

export interface ImportResult {
  added: string[];
  skipped: string[];
  failed: string[];
}

export async function runImport(opts: {
  src: string; labels: string; coversDir: string; dryRun?: boolean; log?: (m: string) => void;
}): Promise<ImportResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const manifest = readManifest(opts.coversDir);
  const keys = new Set(manifest.covers.map((c) => c.key));
  const hashes = new Map(manifest.covers.map((c) => [c.sha256, c.key]));
  const result: ImportResult = { added: [], skipped: [], failed: [] };

  for (const row of loadRows(opts.labels)) {
    const id = row.key || row.file;
    const errors = metaErrors(row);
    if (!row.file) errors.push("file is required");
    if (errors.length) {
      log(`FAIL ${id}: ${errors.join("; ")}`);
      result.failed.push(id);
      continue;
    }
    if (keys.has(row.key!)) {
      log(`SKIP ${row.key}: key already in manifest`);
      result.skipped.push(row.key!);
      continue;
    }
    const srcFile = path.resolve(opts.src, row.file);
    if (!fs.existsSync(srcFile)) {
      log(`FAIL ${id}: source file not found: ${srcFile}`);
      result.failed.push(id);
      continue;
    }
    try {
      const img = await buildImages(srcFile, { gravity: row.gravity });
      const entry = entryFrom(row as CoverMeta, img);
      const dup = hashes.get(entry.sha256);
      if (dup) {
        log(`SKIP ${row.key}: identical image already imported as ${dup}`);
        result.skipped.push(row.key!);
        continue;
      }
      if (!opts.dryRun) writeCoverFiles(opts.coversDir, entry, img);
      manifest.covers.push(entry);
      keys.add(entry.key);
      hashes.set(entry.sha256, entry.key);
      result.added.push(entry.key);
      log(`${opts.dryRun ? "DRY " : "ADD "} ${entry.key} ${entry.width}x${entry.height} full ${entry.bytes.full} thumb ${entry.bytes.thumb} jpeg ${entry.bytes.jpeg} ${entry.dominantColor}`);
    } catch (err) {
      log(`FAIL ${id}: ${(err as Error).message}`);
      result.failed.push(id);
    }
  }
  if (!opts.dryRun && result.added.length) writeManifest(opts.coversDir, manifest);
  log(`${result.added.length} added, ${result.skipped.length} skipped, ${result.failed.length} failed${opts.dryRun ? " (dry run, nothing written)" : ""}`);
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const src = flagString(args, "src");
  const labels = flagString(args, "labels");
  if (!src || !labels) {
    console.error("usage: import.ts --src <folder> --labels <labels.csv|labels.json> [--root <coversDir>] [--dry-run]");
    process.exit(2);
  }
  const res = await runImport({ src, labels, coversDir: coversDirFrom(args), dryRun: args.flags["dry-run"] === true });
  if (res.failed.length) process.exit(1);
  if (!args.flags["dry-run"] && res.added.length) console.log("Next: npm run covers:validate && npm run covers:index");
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
