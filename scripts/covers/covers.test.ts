// Run: npm run test:covers  (node --import tsx --test scripts/covers/covers.test.ts)
// All tests work in temp directories and never touch apps/admin/public.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, after, describe, it } from "node:test";
import { runImport } from "./import";
import { REPO_ROOT, THEMES, generateIndexSource, readManifest, sharp, slugKey, validateCovers, writeManifest } from "./lib";

const FIXTURES = path.join(__dirname, "fixtures");
const quiet = () => {};
let tmp: string;
let seeded: string;

function fresh(name: string): string {
  const dir = path.join(tmp, name);
  fs.cpSync(seeded, dir, { recursive: true });
  return dir;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "covers-test-"));
  seeded = path.join(tmp, "seeded");
  execFileSync(process.execPath, ["--import", "tsx", path.join(__dirname, "seed.ts"), "--root", seeded], { cwd: REPO_ROOT, stdio: "pipe" });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("seed", () => {
  it("passes validation with all nine themes covered", async () => {
    assert.deepEqual(await validateCovers(seeded), []);
    const m = readManifest(seeded);
    assert.equal(m.covers.length, 14);
    for (const t of THEMES) assert.ok(m.covers.some((c) => c.themes.includes(t)), t);
    assert.equal(m.covers.find((c) => c.key === "default-hiking")?.url, "catalog://default/hiking");
    assert.equal(m.covers.find((c) => c.key === "theme-music")?.url, "catalog://cover/theme-music");
  });
});

describe("import", () => {
  it("imports fixtures, writes all renditions and keeps the manifest sorted", async () => {
    const dir = fresh("import");
    const res = await runImport({ src: FIXTURES, labels: path.join(FIXTURES, "labels.json"), coversDir: dir, log: quiet });
    assert.deepEqual(res.added.sort(), ["fixture-blue", "fixture-green", "fixture-red"]);
    assert.deepEqual(await validateCovers(dir), []);
    const m = readManifest(dir);
    assert.deepEqual(m.covers.map((c) => c.key), [...m.covers.map((c) => c.key)].sort());
    const red = m.covers.find((c) => c.key === "fixture-red")!;
    assert.equal(red.width, 1200);
    assert.equal(red.height, 750);
    assert.ok(fs.existsSync(path.join(dir, red.thumb)) && fs.existsSync(path.join(dir, red.jpeg)));
  });

  it("skips duplicate keys and duplicate images", async () => {
    const dir = fresh("dupes");
    const labels = path.join(FIXTURES, "labels.json");
    await runImport({ src: FIXTURES, labels, coversDir: dir, log: quiet });
    const again = await runImport({ src: FIXTURES, labels, coversDir: dir, log: quiet });
    assert.equal(again.added.length, 0);
    assert.equal(again.skipped.length, 3);

    const copyDir = path.join(tmp, "copy-src");
    fs.mkdirSync(copyDir, { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, "fixture-red.jpg"), path.join(copyDir, "same.jpg"));
    fs.writeFileSync(path.join(copyDir, "l.json"), JSON.stringify([{
      key: "another-red", file: "same.jpg", themes: ["outdoors"], tags: ["hiking", "trail"], label: "Another red",
      alt: "Same pixels again", license: { type: "dip-original", creator: "DIP" },
    }]));
    const res = await runImport({ src: copyDir, labels: path.join(copyDir, "l.json"), coversDir: dir, log: quiet });
    assert.deepEqual(res.skipped, ["another-red"]);
  });

  it("dry run writes nothing", async () => {
    const dir = path.join(tmp, "dry");
    const res = await runImport({ src: FIXTURES, labels: path.join(FIXTURES, "labels.json"), coversDir: dir, dryRun: true, log: quiet });
    assert.equal(res.added.length, 3);
    assert.equal(fs.existsSync(dir), false);
  });

  it("rejects rows without alt or license and sources narrower than 960 px", async () => {
    const dir = fresh("reject");
    const src = path.join(tmp, "reject-src");
    fs.mkdirSync(src, { recursive: true });
    await sharp({ create: { width: 800, height: 500, channels: 3, background: "#123456" } }).jpeg().toFile(path.join(src, "small.jpg"));
    fs.copyFileSync(path.join(FIXTURES, "fixture-red.jpg"), path.join(src, "big.jpg"));
    const lic = { type: "dip-original", creator: "DIP" };
    const base = { themes: ["outdoors"], tags: ["hiking", "trail"], label: "X" };
    fs.writeFileSync(path.join(src, "l.json"), JSON.stringify([
      { ...base, key: "no-alt", file: "big.jpg", alt: "", license: lic },
      { ...base, key: "no-license", file: "big.jpg", alt: "Something", license: {} },
      { ...base, key: "pexels-no-source", file: "big.jpg", alt: "Something", license: { type: "pexels" } },
      { ...base, key: "too-small", file: "small.jpg", alt: "Small", license: lic },
    ]));
    const logs: string[] = [];
    const res = await runImport({ src, labels: path.join(src, "l.json"), coversDir: dir, log: (m) => logs.push(m) });
    assert.deepEqual(res.failed.sort(), ["no-alt", "no-license", "pexels-no-source", "too-small"]);
    assert.equal(res.added.length, 0);
    assert.ok(logs.some((l) => l.includes("alt text is required")));
    assert.ok(logs.some((l) => l.includes("source too small")));
  });
});

describe("validate", () => {
  it("fails on duplicate key", async () => {
    const dir = fresh("v-dup");
    const m = readManifest(dir);
    m.covers.push({ ...m.covers[0] });
    writeManifest(dir, m);
    const errors = await validateCovers(dir);
    assert.ok(errors.some((e) => e.includes("duplicate key")));
  });

  it("fails on missing alt and missing license", async () => {
    const dir = fresh("v-meta");
    const m = readManifest(dir);
    m.covers[0].alt = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.covers[1] as any).license = undefined;
    writeManifest(dir, m);
    const errors = await validateCovers(dir);
    assert.ok(errors.some((e) => e.includes("alt text is required")));
    assert.ok(errors.some((e) => e.includes("license is required")));
  });

  it("fails on oversize files, byte mismatch and stray files", async () => {
    const dir = fresh("v-size");
    const m = readManifest(dir);
    fs.writeFileSync(path.join(dir, m.covers[0].thumb), Buffer.alloc(40 * 1024));
    fs.writeFileSync(path.join(dir, "stray.txt"), "x");
    const errors = await validateCovers(dir);
    assert.ok(errors.some((e) => e.includes("thumb is 40960 bytes, limit") || e.includes("not a readable image")));
    assert.ok(errors.some((e) => e.includes("stray file in covers dir: stray.txt")));
  });

  it("fails when a theme has too few images", async () => {
    const errors = await validateCovers(seeded, { minPerTheme: 2 });
    assert.ok(errors.some((e) => e.includes("theme music has 1 images")));
  });

  it("fails on a wrong url and on missing files", async () => {
    const dir = fresh("v-url");
    const m = readManifest(dir);
    m.covers[0].url = "catalog://cover/wrong";
    writeManifest(dir, m);
    fs.rmSync(path.join(dir, m.covers[1].jpeg));
    const errors = await validateCovers(dir);
    assert.ok(errors.some((e) => e.includes("url must be")));
    assert.ok(errors.some((e) => e.includes("jpeg file missing")));
  });

  it("detects an out-of-sync catalog index", async () => {
    const dir = fresh("v-index");
    const index = path.join(tmp, "catalog.generated.ts");
    fs.writeFileSync(index, generateIndexSource(readManifest(dir)));
    assert.deepEqual(await validateCovers(dir, { indexPath: index }), []);
    fs.appendFileSync(index, "// drift\n");
    const errors = await validateCovers(dir, { indexPath: index });
    assert.ok(errors.some((e) => e.includes("out of sync")));
  });
});

describe("helpers and plan", () => {
  it("slugs keys", () => {
    assert.equal(slugKey("Café  Lunch Spot!"), "cafe-lunch-spot");
  });

  it("query plan is well formed", () => {
    const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "query-plan.json"), "utf8"));
    const ids = new Set<string>();
    for (const s of plan.shots) {
      assert.ok((THEMES as readonly string[]).includes(s.theme), s.id);
      assert.ok(!ids.has(s.id), `duplicate shot id ${s.id}`);
      ids.add(s.id);
      assert.ok(s.query && s.label.length <= 40 && s.tags.length >= 2, s.id);
    }
    assert.ok(plan.shots.length >= 160);
    for (const t of plan.themes) {
      assert.equal(plan.shots.filter((s: { theme: string }) => s.theme === t.theme).length, t.target, t.theme);
    }
  });
});
