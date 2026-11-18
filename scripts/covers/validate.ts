// Validate the cover library: node --import tsx scripts/covers/validate.ts [--root <coversDir>] [--min-per-theme N] [--index <path>]
// With --root and no --index the catalog.generated.ts sync check is skipped (used by tests).
import { DEFAULT_INDEX_PATH, coversDirFrom, dirSize, flagString, parseArgs, validateCovers } from "./lib";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = coversDirFrom(args);
  const min = Number(flagString(args, "min-per-theme") ?? 1);
  const indexFlag = flagString(args, "index");
  const indexPath = indexFlag ?? (flagString(args, "root") ? null : DEFAULT_INDEX_PATH);
  const errors = await validateCovers(dir, { minPerTheme: min, indexPath });
  if (errors.length) {
    console.error(`Cover library invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`Cover library OK (${(dirSize(dir) / 1024 / 1024).toFixed(2)} MB, min ${min} per theme)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
