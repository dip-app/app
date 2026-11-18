import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { LlmUnavailableError, type DecisionRequest, type DecisionResult } from "../../functions/src/modules/ai/application/ports";
import { ScriptedDecisions, type DecisionStepScript } from "../../functions/src/modules/ai/infrastructure/fakes";
import { aiConfig } from "../../functions/src/modules/ai/infrastructure/aiConfig";
import { runLiveCover } from "../../functions/src/modules/covers/application/liveCover";
import {
  DEFAULT_LIVE_COVER_CONFIG, PixabayRateLimitedError, PixabayUnavailableError,
  type DownloadedImage, type DynamicCoverCatalog, type DynamicCoverDoc, type DynamicCoverWriter, type ImageDownloader, type ImageProcessor, type LiveCoverConfig,
  type LiveCoverDeps, type LiveQuota, type PixabayHit, type PixabaySearchPort, type ProcessedCover, type QuotaDenial, type CoverSearchCache,
} from "../../functions/src/modules/covers/application/livePorts";
import { pickCover, pickEventCover, type PickCoverDeps } from "../../functions/src/modules/covers/application/pickCover";
import type { CoverIndexEntry } from "../../functions/src/modules/covers/domain/catalog.generated";
import { dynamicCoverImagePath, toIndexEntry } from "../../functions/src/modules/covers/domain/dynamicCovers";
import { hammingHex, findNearDuplicate } from "../../functions/src/modules/covers/domain/nearDuplicate";
import { FakeAdminStore, caller, seedCompany } from "./helpers/adminFakes";
import { choiceAnswer, decision, uuid } from "./helpers/aiFakes";

const entry = (key: string, themes: string[], tags: string[], label: string, extra: Partial<CoverIndexEntry> = {}): CoverIndexEntry => ({
  key, url: `catalog://cover/${key}`, kind: "photo", themes, tags, mood: [], label, alt: label, hasJpeg: true, ...extra,
});
const STATIC: readonly CoverIndexEntry[] = [
  entry("default-outdoors", ["outdoors"], ["outdoors", "park", "picnic"], "Outdoors in the park", { url: "catalog://default/outdoors" }),
  entry("kayak-lake", ["outdoors"], ["kayaking", "paddling", "lake", "canoe"], "Kayaking on a lake"),
  entry("hike-ridge", ["outdoors", "wellness"], ["hiking", "trail", "mountain"], "Hiking a mountain trail"),
  entry("yoga-studio", ["fitness", "wellness"], ["yoga", "stretching", "meditation"], "Yoga class in a studio"),
  entry("pottery-wheel", ["arts"], ["pottery", "ceramics", "painting", "craft"], "Pottery on the wheel"),
  entry("bowling-lane", ["games"], ["bowling", "league"], "Bowling lane"),
  entry("lunch-and-learn", ["learning"], ["workshop", "training", "class"], "Workshop in a classroom"),
];

// The words "axe throwing" appear nowhere in the static fixture: the live fallback triggers (low_score and few_matches).
const WEAK = { title: "Axe throwing" };
const STRONG = { title: "Sunset kayak trip", tagIds: ["tag-outdoors"] };

const hit = (id: number, tags: string, extra: Partial<PixabayHit> = {}): PixabayHit => ({
  id, pageURL: `https://pixabay.com/photos/x-${id}/`, tags, user: "someone", user_id: 7, imageWidth: 4000, imageHeight: 2500,
  largeImageURL: `https://pixabay.com/get/large-${id}_1280.jpg`, webformatURL: `https://pixabay.com/get/web-${id}_640.jpg`, ...extra,
});
const HITS = [hit(111, "axe throwing, target, wood"), hit(222, "forest, trees, nature")];

const existingDoc = (id: number, tags: string[], extra: Partial<DynamicCoverDoc> = {}): DynamicCoverDoc => ({
  key: `pixabay-${id}`, status: "active", source: "pixabay", pixabayId: id, pageURL: `https://pixabay.com/photos/x-${id}/`, user: "someone", userId: 7,
  license: { type: "pixabay", source: "Pixabay", sourceURL: "https://pixabay.com/photos/x/", creator: "someone", creatorURL: "https://pixabay.com/users/someone-7/", notes: "n" },
  tags, themes: ["outdoors"], label: tags[0] ?? "Photo", alt: `Photo of ${tags[0] ?? "x"}`, width: 1200, height: 750, dHash: "ffff0000ffff0000", sha256: "0".repeat(64),
  bytes: { webp: 10, jpeg: 10 }, storagePaths: { webp: `covers-dynamic/pixabay-${id}.webp`, jpeg: `covers-dynamic/jpg/pixabay-${id}.jpg` },
  storedURL: dynamicCoverImagePath(`pixabay-${id}`), createdAt: new Date("2030-01-01T00:00:00Z"), createdBy: { companyId: "alpha", uid: "admin2" },
  usageCount: 1, lastUsedAt: new Date("2030-01-01T00:00:00Z"), ...extra,
});

// ---- fakes -------------------------------------------------------------------------------------------------------
class FakeCatalog implements DynamicCoverCatalog {
  docs = new Map<string, DynamicCoverDoc>();
  failEntries = false;
  async entries() {
    if (this.failEntries) throw new Error("firestore down");
    return [...this.docs.values()].filter(d => d.status === "active").map(toIndexEntry);
  }
  async hashes() { return [...this.docs.values()].filter(d => d.status === "active").map(d => ({ key: d.key, dHash: d.dHash })); }
  async get(key: string) { return this.docs.get(key) ?? null; }
  async has(key: string) { return this.docs.get(key)?.status === "active"; }
}
class FakeWriter implements DynamicCoverWriter {
  objects: string[] = [];
  created: DynamicCoverDoc[] = [];
  touched: string[] = [];
  /** When false, create() reports a lost race after `onLost` ran (a competing pick stored the key). */
  createResult = true;
  onLost: (() => void) | null = null;
  constructor(private readonly catalog: FakeCatalog) {}
  async putObjects(key: string, _cover: ProcessedCover) { this.objects.push(key); return { webp: `covers-dynamic/${key}.webp`, jpeg: `covers-dynamic/jpg/${key}.jpg` }; }
  async create(doc: DynamicCoverDoc) {
    if (!this.createResult) { this.onLost?.(); return false; }
    this.created.push(doc);
    this.catalog.docs.set(doc.key, doc);
    return true;
  }
  async touch(key: string) { this.touched.push(key); }
}

class Rig {
  catalog = new FakeCatalog();
  writer = new FakeWriter(this.catalog);
  searchCalls: string[] = [];
  searchImpl: (q: string) => Promise<PixabayHit[]> = async () => HITS;
  cacheStore = new Map<string, PixabayHit[]>();
  quotaCalls = 0;
  quotaDenial: QuotaDenial | null = null;
  downloads: string[] = [];
  downloadImpl: (url: string) => Promise<DownloadedImage> = async () => ({ bytes: Buffer.from("img"), contentType: "image/jpeg" });
  processed = 0;
  dHash = "0f0f0f0f0f0f0f0f";
  processImpl: () => Promise<ProcessedCover> = async () => {
    this.processed += 1;
    return { webp: Buffer.from("webp"), jpeg: Buffer.from("jpeg"), width: 1200, height: 750, dHash: this.dHash, sha256: "a".repeat(64) };
  };
  config: LiveCoverConfig = { ...DEFAULT_LIVE_COVER_CONFIG };

  get live(): LiveCoverDeps {
    const search: PixabaySearchPort = { search: async q => { this.searchCalls.push(q); return this.searchImpl(q); } };
    const cache: CoverSearchCache = {
      get: async q => this.cacheStore.get(q) ?? null,
      put: async (q, hits) => { this.cacheStore.set(q, [...hits]); },
    };
    const quota: LiveQuota = { tryConsume: async () => { this.quotaCalls += 1; return this.quotaDenial; } };
    const downloader: ImageDownloader = { download: async url => { this.downloads.push(url); return this.downloadImpl(url); } };
    const processor: ImageProcessor = { process: async () => this.processImpl() };
    return { search, cache, quota, downloader, processor, catalog: this.catalog, writer: this.writer, config: this.config };
  }
}

const jev = (answer: ReturnType<typeof choiceAnswer>): DecisionStepScript => (req: DecisionRequest) => decision(req, { cover: answer });
const asProvider = (provider: DecisionResult["provider"], answer: ReturnType<typeof choiceAnswer>): DecisionStepScript =>
  (req: DecisionRequest) => ({ ...decision(req, { cover: answer }), provider, model: `${provider}-model` });
const criteria = (req: DecisionRequest) => Object.keys((req.questions.cover as { criteria: Record<string, string> }).criteria);
const context = { companyId: "alpha", uid: "admin1", requestId: uuid(1) };
const NOW = () => new Date("2030-01-02T10:00:00Z");
const pickDeps = (rig: Rig, script: DecisionStepScript[] = [], extra: Partial<PickCoverDeps> = {}) => {
  const decisions = new ScriptedDecisions(script);
  return { decisions, deps: { decisions, aiEnabled: true, index: STATIC, live: rig.live, now: NOW, context, ...extra } };
};

describe("domain helpers: near duplicates", () => {
  test("hammingHex counts differing bits and treats malformed hashes as different", () => {
    assert.equal(hammingHex("0000000000000000", "0000000000000000"), 0);
    assert.equal(hammingHex("0000000000000000", "000000000000000f"), 4);
    assert.equal(hammingHex("ffffffffffffffff", "0000000000000000"), 64);
    assert.equal(hammingHex("nothex", "0000000000000000"), 64);
    assert.equal(findNearDuplicate("0f0f0f0f0f0f0f0f", [{ key: "a", dHash: "ffff0000ffff0000" }, { key: "b", dHash: "0f0f0f0f0f0f0f07" }]), "b");
    assert.equal(findNearDuplicate("0f0f0f0f0f0f0f0f", [{ key: "a", dHash: "0f0f0f0f0f0f0f70" }]), null, "6 bits would match, 4+ more do not");
  });
});

describe("live fallback: triggers", () => {
  test("a good library match does not search (no cache, quota, search or model call from the live path)", async () => {
    const rig = new Rig();
    rig.config = { ...rig.config, minScore: 1, minMatches: 1 };
    const { decisions, deps } = pickDeps(rig, [jev(choiceAnswer("kayak-lake", 0.9))]);
    const result = await pickCover(deps, STRONG);
    assert.equal(result.coverImageURL, "catalog://cover/kayak-lake");
    assert.deepEqual([rig.searchCalls.length, rig.quotaCalls, decisions.calls.length], [0, 0, 1]);
    assert.equal(result.live?.triggered, false);
  });

  test("a weak match triggers the search once and the model sees Pixabay candidates plus library covers", async () => {
    const rig = new Rig();
    const { decisions, deps } = pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]);
    const result = await pickCover(deps, WEAK);
    assert.equal(rig.searchCalls.length, 1);
    assert.equal(rig.searchCalls[0], "axe throwing");
    assert.equal(decisions.calls.length, 1, "one Choice question for the whole live path");
    const keys = criteria(decisions.calls[0]!);
    assert.ok(keys.includes("pixabay-111") && keys.includes("pixabay-222"));
    assert.ok(keys.some(key => STATIC.some(item => item.key === key)), "static covers are offered too");
    assert.ok(!JSON.stringify(decisions.calls[0]!.questions).includes("pixabay.com"), "no URLs reach the model");
    assert.equal(result.live?.reason, "low_score");
  });

  test("a dynamic cover that already matches is reused before any Pixabay call", async () => {
    const rig = new Rig();
    rig.catalog.docs.set("pixabay-555", existingDoc(555, ["axe throwing", "target"]));
    rig.config = { ...rig.config, minScore: 1, minMatches: 1 };
    const { deps } = pickDeps(rig, [jev(choiceAnswer("pixabay-555", 0.9))]);
    const result = await pickCover(deps, WEAK);
    assert.equal(result.coverImageURL, "catalog://cover/pixabay-555");
    assert.equal(result.source, "dipbot");
    assert.equal(result.coverAlt, "Photo of axe throwing");
    assert.equal(result.newPhoto, undefined);
    assert.deepEqual([rig.searchCalls.length, rig.downloads.length, rig.quotaCalls], [0, 0, 0]);
  });

  test("AI off, config disabled and missing live deps never search", async () => {
    const off = new Rig();
    await pickCover(pickDeps(off, [], { aiEnabled: false }).deps, WEAK);
    const disabled = new Rig();
    disabled.config = { ...disabled.config, enabled: false };
    await pickCover(pickDeps(disabled).deps, WEAK);
    const none = new Rig();
    const { live: _live, ...without } = pickDeps(none).deps;
    const result = await pickCover(without, WEAK);
    assert.deepEqual([off.searchCalls.length, disabled.searchCalls.length, none.searchCalls.length], [0, 0, 0]);
    assert.equal(result.live, undefined);
    const noContext = new Rig();
    const { context: _context, ...bare } = pickDeps(noContext).deps;
    await pickCover(bare, WEAK);
    assert.equal(noContext.searchCalls.length, 0);
  });
});

describe("live fallback: search, cache and quota", () => {
  test("a cache hit skips the quota and the Pixabay search", async () => {
    const rig = new Rig();
    rig.cacheStore.set("axe throwing", HITS);
    const { deps } = pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]);
    const result = await pickCover(deps, WEAK);
    assert.deepEqual([rig.quotaCalls, rig.searchCalls.length, result.live?.cacheHit, result.newPhoto], [0, 0, true, true]);
  });

  test("a miss consumes the quota, searches once and caches the hits", async () => {
    const rig = new Rig();
    await pickCover(pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]).deps, WEAK);
    assert.deepEqual([rig.quotaCalls, rig.searchCalls.length, rig.cacheStore.get("axe throwing")?.length, ], [1, 1, 2]);
  });

  test("a quota denial answers from the library without a search or a download", async () => {
    const rig = new Rig();
    rig.quotaDenial = "company_daily";
    const { decisions, deps } = pickDeps(rig, [jev(choiceAnswer("kayak-lake", 0.9))]);
    const result = await pickCover(deps, WEAK);
    assert.deepEqual([rig.searchCalls.length, rig.downloads.length], [0, 0]);
    assert.equal(result.live?.outcome, "skipped:company_daily");
    assert.ok(result.coverImageURL.startsWith("catalog://") && !result.coverImageURL.includes("pixabay-"));
    assert.equal(decisions.calls.length, 1, "the normal static model pick still runs");
  });

  for (const [label, error, outcome] of [
    ["429", new PixabayRateLimitedError(30), "failed:rate_limited"],
    ["timeout", Object.assign(new Error("t"), { name: "TimeoutError" }), "failed:timeout"],
    ["server error", new PixabayUnavailableError("http_500"), "failed:http_500"],
  ] as const) {
    test(`search ${label} falls back to the library pick and does not throw`, async () => {
      const rig = new Rig();
      rig.searchImpl = async () => { throw error; };
      const { deps } = pickDeps(rig, [jev(choiceAnswer("kayak-lake", 0.9))]);
      const result = await pickCover(deps, WEAK);
      assert.equal(result.live?.outcome, outcome);
      assert.equal(result.coverImageURL, "catalog://cover/kayak-lake");
      assert.equal(result.newPhoto, undefined);
      assert.deepEqual([rig.downloads.length, rig.writer.created.length], [0, 0]);
    });
  }

  test("no acceptable candidate (all excluded or unsuitable) falls back without a model call from the live path", async () => {
    const rig = new Rig();
    rig.searchImpl = async () => [hit(1, "logo, brand"), hit(2, "axe", { imageWidth: 600, imageHeight: 400 }), hit(3, "axe", { imageWidth: 3000, imageHeight: 3000 })];
    const result = await pickCover(pickDeps(rig).deps, WEAK);
    assert.equal(result.live?.outcome, "skipped:no_candidates");
    assert.equal(result.live?.candidateCount, 0);
  });

  test("a query with no usable words searches nothing", async () => {
    const rig = new Rig();
    const result = await pickCover(pickDeps(rig).deps, { title: "12345 and the" });
    assert.equal(result.live?.outcome, "skipped:no_query");
    assert.equal(rig.searchCalls.length, 0);
  });

  test("a failing dynamic catalog falls back to the static library and is logged", async () => {
    const rig = new Rig();
    rig.catalog.failEntries = true;
    const logs: string[] = [];
    const { deps } = pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))], { log: event => logs.push(event) });
    const result = await pickCover(deps, WEAK);
    assert.ok(logs.includes("ai.cover_catalog_failed"));
    assert.equal(result.newPhoto, true, "the live path still runs");
  });
});

describe("live fallback: choice and materialization", () => {
  test("the model picks a Pixabay candidate: stored document, both renditions, newPhoto and alt", async () => {
    const rig = new Rig();
    const { deps } = pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]);
    const result = await pickCover(deps, WEAK);
    assert.deepEqual([result.coverImageURL, result.source, result.provider, result.newPhoto], ["catalog://cover/pixabay-111", "dipbot", "jev", true]);
    assert.equal(result.coverAlt, "Photo of axe throwing, target and wood");
    assert.deepEqual(rig.downloads, ["https://pixabay.com/get/large-111_1280.jpg"]);
    assert.deepEqual(rig.writer.objects, ["pixabay-111"]);
    const doc = rig.writer.created[0]!;
    assert.equal(doc.key, "pixabay-111");
    assert.equal(doc.status, "active");
    assert.deepEqual(doc.createdBy, { companyId: "alpha", uid: "admin1" });
    assert.equal(doc.storedURL, "/img/covers-dyn/pixabay-111.webp");
    assert.deepEqual(doc.tags, ["axe throwing", "target", "wood"]);
    assert.deepEqual([doc.license.type, doc.license.source, doc.pixabayId, doc.usageCount, doc.dHash, doc.bytes], ["pixabay", "Pixabay", 111, 1, rig.dHash, { webp: 4, jpeg: 4 }]);
    assert.deepEqual(doc.storagePaths, { webp: "covers-dynamic/pixabay-111.webp", jpeg: "covers-dynamic/jpg/pixabay-111.jpg" });
    assert.ok(result.alternatives.every(url => url !== result.coverImageURL));
  });

  test("the model picks a library cover: nothing is downloaded or stored", async () => {
    const rig = new Rig();
    const pickStatic: DecisionStepScript = (req: DecisionRequest) => decision(req, { cover: choiceAnswer(criteria(req).find(key => !key.startsWith("pixabay-"))!, 0.9) });
    const result = await pickCover(pickDeps(rig, [pickStatic]).deps, WEAK);
    assert.equal(result.source, "dipbot");
    assert.ok(!result.coverImageURL.includes("pixabay-"));
    assert.deepEqual([rig.downloads.length, rig.processed, rig.writer.created.length, result.newPhoto], [0, 0, 0, undefined]);
  });

  test("a low-confidence model answer uses the lexical result, with no download", async () => {
    const rig = new Rig();
    const result = await pickCover(pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.1))]).deps, WEAK);
    assert.equal(result.source === "match" || result.source === "default", true);
    assert.equal(result.provider, "jev");
    assert.equal(rig.downloads.length, 0);
  });

  test("the heuristic provider takes the best-overlapping candidate deterministically (source match)", async () => {
    const rig = new Rig();
    const result = await pickCover(pickDeps(rig, [asProvider("heuristic", choiceAnswer("pixabay-222", 0.99))]).deps, WEAK);
    assert.deepEqual([result.coverImageURL, result.source, result.provider, result.newPhoto], ["catalog://cover/pixabay-111", "match", "heuristic", true]);
  });

  test("the heuristic provider with no relevant candidate keeps the library result and downloads nothing", async () => {
    const rig = new Rig();
    rig.searchImpl = async () => [hit(222, "forest, trees, nature")];
    const result = await pickCover(pickDeps(rig, [asProvider("heuristic", choiceAnswer("pixabay-222", 0.99))]).deps, WEAK);
    assert.deepEqual([result.provider, result.source === "match" || result.source === "default", rig.downloads.length], ["heuristic", true, 0]);
    assert.ok(!result.coverImageURL.includes("pixabay-"));
  });

  test("a chosen photo that already has an active document is reused without a download", async () => {
    const rig = new Rig();
    rig.catalog.docs.set("pixabay-111", existingDoc(111, ["forest"]));
    const result = await pickCover(pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]).deps, WEAK);
    assert.equal(result.coverImageURL, "catalog://cover/pixabay-111");
    assert.deepEqual([rig.downloads.length, rig.writer.created.length, rig.writer.touched, result.newPhoto], [0, 0, ["pixabay-111"], undefined]);
  });

  test("a removed document is not resurrected: the library answers", async () => {
    const rig = new Rig();
    rig.catalog.docs.set("pixabay-111", existingDoc(111, ["axe"], { status: "removed" }));
    const result = await pickCover(pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]).deps, WEAK);
    assert.ok(!result.coverImageURL.includes("pixabay-"));
    assert.deepEqual([rig.downloads.length, rig.writer.created.length, result.provider], [0, 0, null]);
  });

  test("a near-duplicate of a stored photo reuses that key", async () => {
    const rig = new Rig();
    rig.catalog.docs.set("pixabay-900", existingDoc(900, ["forest"], { dHash: "0f0f0f0f0f0f0f0e" }));
    const result = await pickCover(pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]).deps, WEAK);
    assert.equal(result.coverImageURL, "catalog://cover/pixabay-900");
    assert.deepEqual([rig.writer.objects.length, rig.writer.created.length, rig.writer.touched, result.newPhoto], [0, 0, ["pixabay-900"], undefined]);
    assert.equal(rig.downloads.length, 1, "it had to download to compare");
  });

  test("losing the create race reuses the winner's document", async () => {
    const rig = new Rig();
    rig.writer.createResult = false;
    rig.writer.onLost = () => rig.catalog.docs.set("pixabay-111", existingDoc(111, ["axe throwing"]));
    const result = await pickCover(pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]).deps, WEAK);
    assert.equal(result.coverImageURL, "catalog://cover/pixabay-111");
    assert.deepEqual([rig.writer.touched, result.newPhoto, rig.writer.created.length], [["pixabay-111"], undefined, 0]);
  });

  for (const [label, arrange, outcome] of [
    ["download failure", (rig: Rig) => { rig.downloadImpl = async () => { throw new PixabayUnavailableError("download_failed"); }; }, "failed:download_failed"],
    ["invalid image", (rig: Rig) => { rig.processImpl = async () => { throw new PixabayUnavailableError("image_invalid"); }; }, "failed:image_invalid"],
    ["storage failure", (rig: Rig) => { rig.writer.putObjects = async () => { throw new Error("storage down"); }; }, "failed:error"],
    ["slow download that times out", (rig: Rig) => { rig.downloadImpl = async () => { throw Object.assign(new Error("slow"), { name: "TimeoutError" }); }; }, "failed:timeout"],
  ] as const) {
    test(`${label} after the model's pick answers from the library, reports no model and stores nothing`, async () => {
      const rig = new Rig();
      arrange(rig);
      const { deps } = pickDeps(rig, [jev(choiceAnswer("pixabay-111", 0.9))]);
      const result = await pickCover(deps, WEAK);
      assert.equal(result.live?.outcome, outcome);
      assert.ok(!result.coverImageURL.includes("pixabay-"));
      assert.deepEqual([result.provider, result.newPhoto, rig.writer.created.length], [null, undefined, 0]);
    });
  }

  test("runLiveCover never throws even when every port throws", async () => {
    const rig = new Rig();
    const boom = async () => { throw new Error("boom"); };
    const live = rig.live;
    const broken: LiveCoverDeps = { ...live, cache: { get: boom, put: boom }, quota: { tryConsume: boom }, search: { search: boom } };
    const outcome = await runLiveCover(
      { live: broken, decisions: new ScriptedDecisions(), now: NOW },
      { query: WEAK, ranked: [], staticIndex: STATIC, index: STATIC, state: "", context },
    );
    assert.equal(outcome.kind, "continue");
  });
});

describe("pickEventCoverV1 with the live fallback", () => {
  const body = (n: number, extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", requestId: uuid(n), title: "Axe throwing", description: "Bring your own safety goggles", ...extra });
  const CREDITS = "companies/alpha/aiCredits/203001";
  const usedCredits = (store: FakeAdminStore) => Number(store.get(CREDITS)?.used ?? 0);

  function rig(script: DecisionStepScript[], live: Rig = new Rig(), extra: Partial<PickCoverDeps> = {}) {
    const store = new FakeAdminStore();
    seedCompany(store);
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const deps: PickCoverDeps = {
      store, decisions: new ScriptedDecisions(script), aiEnabled: true, index: STATIC, now: NOW, live: live.live,
      log: (event, fields) => logs.push({ event, fields }), ...extra,
    };
    return { store, deps, logs, live };
  }

  test("a model answer is charged once and returns newPhoto, coverAlt and the live summary record", async () => {
    const r = rig([jev(choiceAnswer("pixabay-111", 0.9))]);
    const response = await pickEventCover(r.deps, caller("admin1"), body(1));
    assert.deepEqual([response.coverImageURL, response.source, response.provider, response.newPhoto], ["catalog://cover/pixabay-111", "dipbot", "jev", true]);
    assert.equal(response.coverAlt, "Photo of axe throwing, target and wood");
    assert.equal(usedCredits(r.store), 1);
    const record = await r.store.getDoc(`companies/alpha/aiCoverPicks/admin1_${uuid(1)}`);
    assert.equal(record?.coverKey, "pixabay-111");
    assert.deepEqual(record?.live, { triggered: true, reason: "low_score", outcome: "stored", candidateCount: 2, cacheHit: false });
    assert.equal(r.live.writer.created[0]?.createdBy.uid, "admin1");
  });

  test("the heuristic pick is free: the credit is refunded and the source is match", async () => {
    const r = rig([asProvider("heuristic", choiceAnswer("pixabay-111", 0.9))]);
    const response = await pickEventCover(r.deps, caller("admin1"), body(2));
    assert.deepEqual([response.source, response.provider, response.newPhoto, usedCredits(r.store)], ["match", "heuristic", true, 0]);
  });

  test("a failed live attempt before the model leaves the normal pick and charges only for the model's own answer", async () => {
    const live = new Rig();
    live.searchImpl = async () => { throw new PixabayRateLimitedError(10); };
    const r = rig([jev(choiceAnswer("kayak-lake", 0.9))], live);
    const response = await pickEventCover(r.deps, caller("admin1"), body(3));
    assert.deepEqual([response.coverImageURL, response.provider, response.newPhoto, response.coverAlt, usedCredits(r.store)], ["catalog://cover/kayak-lake", "jev", undefined, undefined, 1]);
    const record = await r.store.getDoc(`companies/alpha/aiCoverPicks/admin1_${uuid(3)}`);
    assert.equal((record?.live as { outcome: string }).outcome, "failed:rate_limited");
  });

  test("a failed store after the model's pick is refunded (no model answer reached the user)", async () => {
    const live = new Rig();
    live.downloadImpl = async () => { throw new PixabayUnavailableError("download_failed"); };
    const r = rig([jev(choiceAnswer("pixabay-111", 0.9))], live);
    const response = await pickEventCover(r.deps, caller("admin1"), body(4));
    assert.deepEqual([response.provider, response.newPhoto, usedCredits(r.store)], [null, undefined, 0]);
  });

  test("AI off: no live path, no charge, the record says so", async () => {
    const r = rig([], new Rig(), { aiEnabled: false });
    const response = await pickEventCover(r.deps, caller("admin1"), body(5));
    assert.equal(response.newPhoto, undefined);
    assert.equal(r.live.searchCalls.length, 0);
    assert.equal(usedCredits(r.store), 0);
    assert.equal(((await r.store.getDoc(`companies/alpha/aiCoverPicks/admin1_${uuid(5)}`))?.live as { outcome: string }).outcome, "skipped:off");
  });

  test("a decision provider outage still answers from the library", async () => {
    const r = rig([new LlmUnavailableError(null)]);
    const response = await pickEventCover(r.deps, caller("admin1"), body(6));
    assert.deepEqual([response.provider, response.newPhoto, usedCredits(r.store)], [null, undefined, 0]);
    assert.ok(!response.coverImageURL.includes("pixabay-"));
  });

  test("the ai.coverLive log has the summary fields and no query text, URL or key", async () => {
    const r = rig([jev(choiceAnswer("pixabay-111", 0.9))]);
    await pickEventCover(r.deps, caller("admin1"), body(7));
    const live = r.logs.find(item => item.event === "ai.coverLive");
    assert.ok(live, "ai.coverLive was logged");
    assert.deepEqual(Object.keys(live.fields).sort(), ["bestScore", "cacheHit", "candidateCount", "companyId", "durationMs", "matchedCount", "outcome", "provider", "reason", "requestId"]);
    assert.deepEqual([live.fields.outcome, live.fields.candidateCount, live.fields.reason, live.fields.companyId], ["stored", 2, "low_score", "alpha"]);
    const text = JSON.stringify(r.logs).toLowerCase();
    for (const forbidden of ["axe", "throwing", "goggles", "pixabay.com", "http", "api_key", "key="]) assert.ok(!text.includes(forbidden), forbidden);
    const stored = JSON.stringify(await r.store.getDoc(`companies/alpha/aiCoverPicks/admin1_${uuid(7)}`)).toLowerCase();
    for (const forbidden of ["axe", "throwing", "goggles", "pixabay.com"]) assert.ok(!stored.includes(forbidden), forbidden);
  });

  test("authorization failures never reach the live path", async () => {
    const r = rig([jev(choiceAnswer("pixabay-111", 0.9))]);
    await assert.rejects(pickEventCover(r.deps, caller("m1"), body(8)), (e: unknown) => e instanceof AdminError);
    assert.deepEqual([r.live.quotaCalls, r.live.searchCalls.length], [0, 0]);
  });
});

describe("live fallback config", () => {
  test("defaults, the only-false kill switch and bounds clamping", () => {
    assert.deepEqual(aiConfig({}).coverLive, DEFAULT_LIVE_COVER_CONFIG);
    assert.equal(aiConfig({ AI_COVER_LIVE_FALLBACK: "false" }).coverLive.enabled, false);
    assert.equal(aiConfig({ AI_COVER_LIVE_FALLBACK: " FALSE " }).coverLive.enabled, false);
    for (const value of ["0", "no", "off", "", "true"]) assert.equal(aiConfig({ AI_COVER_LIVE_FALLBACK: value }).coverLive.enabled, true, value);
    const tuned = aiConfig({
      AI_COVER_LIVE_MIN_SCORE: "9", AI_COVER_LIVE_MIN_MATCHES: "3", AI_COVER_LIVE_CANDIDATES: "5", AI_COVER_LIVE_COMPANY_DAILY: "7",
      AI_COVER_LIVE_PLATFORM_DAILY: "70", AI_COVER_LIVE_INSTANCE_PER_MINUTE: "4",
    }).coverLive;
    assert.deepEqual(tuned, { enabled: true, minScore: 9, minMatches: 3, maxCandidates: 5, companyDaily: 7, platformDaily: 70, instancePerMinute: 4 });
    const huge = aiConfig({ AI_COVER_LIVE_CANDIDATES: "9999", AI_COVER_LIVE_INSTANCE_PER_MINUTE: "9999", AI_COVER_LIVE_COMPANY_DAILY: "-5", AI_COVER_LIVE_MIN_SCORE: "abc" }).coverLive;
    assert.deepEqual([huge.maxCandidates, huge.instancePerMinute, huge.companyDaily, huge.minScore], [12, 20, 1, DEFAULT_LIVE_COVER_CONFIG.minScore]);
  });
});
