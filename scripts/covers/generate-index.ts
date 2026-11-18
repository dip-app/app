// Generate gcp/functions/src/modules/covers/domain/catalog.generated.ts from the manifest.
//   node --import tsx scripts/covers/generate-index.ts [--check] [--root <coversDir>] [--out <file>]
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_INDEX_PATH, coversDirFrom, flagString, generateIndexSource, parseArgs, readManifest } from "./lib";

const args = parseArgs(process.argv.slice(2));
const out = path.resolve(flagString(args, "out") ?? DEFAULT_INDEX_PATH);
const source = generateIndexSource(readManifest(coversDirFrom(args)));

if (args.flags.check === true) {
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== source) {
    console.error(`${path.relative(process.cwd(), out)} is out of date. Run: npm run covers:index`);
    process.exit(1);
  }
  console.log("Cover catalog index is up to date");
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, source);
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}
