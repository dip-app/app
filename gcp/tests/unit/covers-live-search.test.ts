import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { AdminError, type AdminErrorReason } from "../../functions/src/modules/admin/domain/errors";
import {
  DEFAULT_LIVE_COVER_CONFIG, PixabayRateLimitedError, PixabayUnavailableError,
  type DownloadedImage, type DynamicCoverCatalog, type DynamicCoverDoc, type DynamicCoverWriter, type ImageDownloader, type ImageProcessor,
  type LiveCoverDeps, type LiveQuota, type PixabayHit, type PixabaySearchPort, type ProcessedCover, type QuotaDenial, type CoverSearchCache,
} from "../../functions/src/modules/covers/application/livePorts";
import {
  ImportCoverPhotoRequestSchema, importCoverPhoto, searchCoverPhotos, type SearchCoverDeps,
} from "../../functions/src/modules/covers/application/searchCoverPhotos";
import { dynamicCoverImagePath, toIndexEntry } from "../../functions/src/modules/covers/domain/dynamicCovers";
import { FakeAdminStore, caller, seedCompany } from "./helpers/adminFakes";
import { uuid } from "./helpers/aiFakes";

const hit = (id: number, tags: string, extra: Partial<PixabayHit> = {}): PixabayHit => ({
  id, pageURL: `https://pixabay.com/photos/x-${id}/`, tags, user: "someone", user_id: 7, imageWidth: 4000, imageHeight: 2500,
  largeImageURL: `https://pixabay.com/get/large-${id}_1280.jpg`, webformatURL: `https://pixabay.com/get/web-${id}_640.jpg`, ...extra,
});

const existingDoc = (id: number, extra: Partial<DynamicCoverDoc> = {}): DynamicCoverDoc => ({
  key: `pixabay-${id}`, status: "active", source: "pixabay", pixabayId: id, pageURL: `https://pixabay.com/photos/x-${id}/`, user: "someone", userId: 7,
  license: { type: "pixabay", source: "Pixabay", sourceURL: "https://pixabay.com/photos/x/", creator: "someone", creatorURL: "https://pixabay.com/users/someone-7/", notes: "n" },
  tags: ["axe"], themes: ["outdoors"], label: "Axe", alt: "Photo of axe", width: 1200, height: 750, dHash: "ffff0000ffff0000", sha256: "0".repeat(64),
  bytes: { webp: 10, jpeg: 10 }, storagePaths: { webp: `covers-dynamic/pixabay-${id}.webp`, jpeg: `covers-dynamic/jpg/pixabay-${id}.jpg` },
  storedURL: dynamicCoverImagePath(`pixabay-${id}`), createdAt: new Date("2030-01-01T00:00:00Z"), createdBy: { companyId: "alpha", uid: "admin2" },
  usageCount: 1, lastUsedAt: new Date("2030-01-01T00:00:00Z"), ...extra,
});

class Rig {
  docs = new Map<string, DynamicCoverDoc>();
  created: DynamicCoverDoc[] = [];
  objects: string[] = [];
  touched: string[] = [];
  searchCalls: string[] = [];
  searchImpl: (q: string) => Promise<PixabayHit[]> = async () => [hit(111, "axe throwing, target"), hit(222, "axe, wood")];
  cacheStore = new Map<string, PixabayHit[]>();
  remembered = new Map<number, PixabayHit>();
  rememberCalls = 0;
  expired = new Set<number>();
  quotaCalls = 0;
  quotaDenial: QuotaDenial | null = null;
  downloads: string[] = [];
  downloadImpl: (url: string) => Promise<DownloadedImage> = async () => ({ bytes: Buffer.from("img"), contentType: "image/jpeg" });
  consumed: string[] = [];

  get live(): LiveCoverDeps {
    const search: PixabaySearchPort = { search: async q => { this.searchCalls.push(q); return this.searchImpl(q); } };
    const cache: CoverSearchCache = {
      get: async q => this.cacheStore.get(q) ?? null,
      put: async (q, hits) => { this.cacheStore.set(q, [...hits]); },
      rememberCandidates: async hits => { this.rememberCalls += 1; for (const h of hits) this.remembered.set(h.id, h); },
      candidate: async id => (this.expired.has(id) ? null : this.remembered.get(id) ?? null),
    };
    const quota: LiveQuota = { tryConsume: async () => { this.quotaCalls += 1; return this.quotaDenial; } };
    const downloader: ImageDownloader = { download: async url => { this.downloads.push(url); return this.downloadImpl(url); } };
    const processor: ImageProcessor = {
      process: async (): Promise<ProcessedCover> => ({ webp: Buffer.from("webp"), jpeg: Buffer.from("jpeg"), width: 1200, height: 750, dHash: "0f0f0f0f0f0f0f0f", sha256: "a".repeat(64) }),
    };
    const catalog: DynamicCoverCatalog = {
      entries: async () => [...this.docs.values()].filter(d => d.status === "active").map(toIndexEntry),
      hashes: async () => [...this.docs.values()].filter(d => d.status === "active").map(d => ({ key: d.key, dHash: d.dHash })),
      get: async key => this.docs.get(key) ?? null,
      has: async key => this.docs.get(key)?.status === "active",
    };
    const writer: DynamicCoverWriter = {
      putObjects: async key => { this.objects.push(key); return { webp: `covers-dynamic/${key}.webp`, jpeg: `covers-dynamic/jpg/${key}.jpg` }; },
      create: async doc => { this.created.push(doc); this.docs.set(doc.key, doc); return true; },
      touch: async key => { this.touched.push(key); },
    };
    return { search, cache, quota, downloader, processor, catalog, writer, config: { ...DEFAULT_LIVE_COVER_CONFIG } };
  }
}

const NOW = () => new Date("2030-01-02T10:00:00Z");
function rig(extra: Partial<SearchCoverDeps> = {}, r = new Rig()) {
  const store = new FakeAdminStore();
  seedCompany(store);
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const deps: SearchCoverDeps = {
    store, aiEnabled: true, live: r.live, now: NOW, limiter: { consume: async uid => { r.consumed.push(uid); } },
    log: (event, fields) => logs.push({ event, fields }), ...extra,
  };
  return { r, deps, logs };
}
const search = (n: number, extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", requestId: uuid(n), query: "axe throwing", ...extra });
const imp = (n: number, extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", requestId: uuid(n), key: "pixabay-111", ...extra });
async function fails(promise: Promise<unknown>, reason: AdminErrorReason) {
  await assert.rejects(promise, (error: unknown) => error instanceof AdminError && error.reason === reason);
}

describe("searchCoverPhotosV1", () => {
  test("auth: signed out, plain member, organizer, another company and a stranger are refused before the limiter, quota or search", async () => {
    const { r, deps } = rig();
    await fails(searchCoverPhotos(deps, null, search(1)), "UNAUTHENTICATED");
    await fails(searchCoverPhotos(deps, caller("m1"), search(1)), "INSUFFICIENT_ROLE");
    await fails(searchCoverPhotos(deps, caller("org1"), search(1)), "INSUFFICIENT_ROLE");
    await fails(searchCoverPhotos(deps, caller("bo"), search(1)), "COMPANY_MISMATCH");
    await fails(searchCoverPhotos(deps, caller("nobody"), search(1)), "MEMBERSHIP_CONFLICT");
    assert.deepEqual([r.consumed, r.quotaCalls, r.searchCalls.length], [[], 0, 0]);
  });

  test("a found search returns capped, filtered candidates and remembers them", async () => {
    const r = new Rig();
    const many = Array.from({ length: 20 }, (_, i) => hit(1000 + i, "axe throwing"));
    r.searchImpl = async () => [
      ...many,
      hit(900, "axe throwing, child"),                                            // blocked tag
      hit(901, "axe throwing", { imageWidth: 800, imageHeight: 800 }),            // wrong aspect
      hit(902, "axe throwing", { webformatURL: "https://evil.test/get/x.jpg" }),  // not a Pixabay URL
    ];
    r.docs.set("pixabay-1000", existingDoc(1000));
    const { deps, logs } = rig({}, r);
    const response = await searchCoverPhotos(deps, caller("admin1"), search(2));
    assert.equal(response.status, "ok");
    assert.equal(response.candidates.length, 12);
    const keys = response.candidates.map(c => c.key);
    assert.ok(!keys.includes("pixabay-900") && !keys.includes("pixabay-901") && !keys.includes("pixabay-902"));
    assert.ok(response.candidates.every(c => c.previewURL.startsWith("https://pixabay.com/get/") && c.tags.length <= 8));
    assert.equal(response.candidates.find(c => c.key === "pixabay-1000")?.stored, true);
    assert.equal(response.candidates.find(c => c.key !== "pixabay-1000")?.stored, false);
    assert.equal(r.rememberCalls, 1);
    assert.equal(r.remembered.size, 12, "exactly the shown hits are remembered");
    assert.deepEqual(r.consumed, ["admin1"]);
    assert.equal(JSON.stringify(logs).includes("axe"), false, "no query text in logs");
  });

  test("personal data is stripped from the Pixabay query", async () => {
    const { r, deps } = rig();
    await searchCoverPhotos(deps, caller("admin1"), search(3, { query: "bowling jane.doe@acme.com @jane 555-123-4567 www.acme.com" }));
    assert.equal(r.searchCalls.length, 1);
    assert.equal(r.searchCalls[0], "bowling");
  });

  test("a query with nothing usable returns ok with no candidates and never searches", async () => {
    const { r, deps } = rig();
    const response = await searchCoverPhotos(deps, caller("admin1"), search(4, { query: "12345 ... 777" }));
    assert.deepEqual([response.status, response.candidates, r.searchCalls.length, r.quotaCalls], ["ok", [], 0, 0]);
  });

  test("a cache hit skips the quota and the Pixabay search", async () => {
    const r = new Rig();
    r.cacheStore.set("axe throwing", [hit(111, "axe throwing")]);
    const { deps } = rig({}, r);
    const response = await searchCoverPhotos(deps, caller("admin1"), search(5));
    assert.deepEqual([response.candidates.length, r.quotaCalls, r.searchCalls.length], [1, 0, 0]);
  });

  test("a miss consumes the quota once, searches once and caches the hits", async () => {
    const { r, deps } = rig();
    await searchCoverPhotos(deps, caller("admin1"), search(6));
    assert.deepEqual([r.quotaCalls, r.searchCalls.length, r.cacheStore.has("axe throwing")], [1, 1, true]);
  });

  test("a quota denial is a quota status, the per-instance limiter is rate_limited, and Pixabay is not called", async () => {
    const a = rig();
    a.r.quotaDenial = "company_daily";
    assert.deepEqual(await searchCoverPhotos(a.deps, caller("admin1"), search(7)), { contractVersion: 1, candidates: [], status: "quota" });
    a.r.quotaDenial = "platform_daily";
    assert.equal((await searchCoverPhotos(a.deps, caller("admin1"), search(7))).status, "quota");
    a.r.quotaDenial = "instance_rate";
    assert.equal((await searchCoverPhotos(a.deps, caller("admin1"), search(7))).status, "rate_limited");
    assert.equal(a.r.searchCalls.length, 0);
  });

  test("a 429 and other Pixabay failures come back as statuses, never as errors", async () => {
    const a = rig();
    a.r.searchImpl = async () => { throw new PixabayRateLimitedError(30); };
    assert.equal((await searchCoverPhotos(a.deps, caller("admin1"), search(8))).status, "rate_limited");
    a.r.searchImpl = async () => { throw new PixabayUnavailableError("timeout"); };
    assert.deepEqual(await searchCoverPhotos(a.deps, caller("admin1"), search(8)), { contractVersion: 1, candidates: [], status: "unavailable" });
  });

  test("AI off, no live deps or a disabled fallback is COVER_SEARCH_UNAVAILABLE (after authorization)", async () => {
    const off = rig({ aiEnabled: false });
    await fails(searchCoverPhotos(off.deps, caller("admin1"), search(9)), "COVER_SEARCH_UNAVAILABLE");
    const { live: _live, ...without } = rig().deps;
    await fails(searchCoverPhotos(without, caller("admin1"), search(9)), "COVER_SEARCH_UNAVAILABLE");
    await fails(searchCoverPhotos(without, caller("m1"), search(9)), "INSUFFICIENT_ROLE");
    const disabled = new Rig();
    const deps = rig({}, disabled).deps;
    deps.live = { ...disabled.live, config: { ...DEFAULT_LIVE_COVER_CONFIG, enabled: false } };
    await fails(searchCoverPhotos(deps, caller("admin1"), search(9)), "COVER_SEARCH_UNAVAILABLE");
    assert.equal(off.r.searchCalls.length, 0);
  });

  test("validation: strict fields and bounds", async () => {
    const { r, deps } = rig();
    for (const extra of [{ query: "" }, { query: "   " }, { query: "x".repeat(61) }, { extra: 1 }, { requestId: "nope" }, { companyId: "" }, { contractVersion: 2 }, { previewURL: "https://x.test" }]) {
      await fails(searchCoverPhotos(deps, caller("admin1"), search(10, extra)), "VALIDATION_FAILED");
    }
    assert.deepEqual([r.searchCalls.length, r.consumed], [0, []]);
  });
});

describe("importCoverPhotoV1", () => {
  const remembered = (r: Rig, id = 111) => { r.remembered.set(id, hit(id, "axe throwing, target")); };

  test("auth: signed out, plain member, organizer and another company are refused", async () => {
    const { r, deps } = rig();
    remembered(r);
    await fails(importCoverPhoto(deps, null, imp(1)), "UNAUTHENTICATED");
    await fails(importCoverPhoto(deps, caller("m1"), imp(1)), "INSUFFICIENT_ROLE");
    await fails(importCoverPhoto(deps, caller("org1"), imp(1)), "INSUFFICIENT_ROLE");
    await fails(importCoverPhoto(deps, caller("bo"), imp(1)), "COMPANY_MISMATCH");
    assert.deepEqual([r.downloads.length, r.created.length], [0, 0]);
  });

  test("only a key is accepted: a URL or any extra field is rejected and nothing is fetched", async () => {
    const { r, deps } = rig();
    remembered(r);
    for (const extra of [
      { key: "https://pixabay.com/get/large-111_1280.jpg" }, { key: "pixabay-0" }, { key: "kayak-lake" }, { key: "pixabay-111/../x" },
      { url: "https://pixabay.com/get/large-111_1280.jpg" }, { largeImageURL: "https://pixabay.com/get/x.jpg" },
    ]) await fails(importCoverPhoto(deps, caller("admin1"), imp(2, extra)), "VALIDATION_FAILED");
    assert.equal(ImportCoverPhotoRequestSchema.safeParse(imp(2, { url: "x" })).success, false);
    assert.equal(r.downloads.length, 0);
  });

  test("a photo that was never remembered, or whose candidate expired, is COVER_CANDIDATE_EXPIRED without a download", async () => {
    const { r, deps } = rig();
    await fails(importCoverPhoto(deps, caller("admin1"), imp(3)), "COVER_CANDIDATE_EXPIRED");
    remembered(r);
    r.expired.add(111);
    await fails(importCoverPhoto(deps, caller("admin1"), imp(3)), "COVER_CANDIDATE_EXPIRED");
    assert.deepEqual([r.downloads.length, r.created.length], [0, 0]);
  });

  test("a remembered photo is downloaded and stored with objects and createdBy; the response names the dynamic cover", async () => {
    const { r, deps, logs } = rig();
    remembered(r);
    const response = await importCoverPhoto(deps, caller("admin1"), imp(4));
    assert.deepEqual(response, { contractVersion: 1, coverImageURL: "catalog://cover/pixabay-111", coverAlt: "Photo of axe throwing and target", newPhoto: true });
    assert.deepEqual(r.downloads, ["https://pixabay.com/get/large-111_1280.jpg"]);
    assert.deepEqual(r.objects, ["pixabay-111"]);
    assert.equal(r.created.length, 1);
    assert.deepEqual(r.created[0]?.createdBy, { companyId: "alpha", uid: "admin1" });
    assert.ok(r.created[0]!.themes.length >= 1);
    assert.equal(JSON.stringify(logs).includes("pixabay.com"), false, "no URLs in logs");
  });

  test("an existing active stored cover is reused without a download", async () => {
    const { r, deps } = rig();
    remembered(r);
    r.docs.set("pixabay-111", existingDoc(111));
    const response = await importCoverPhoto(deps, caller("admin1"), imp(5));
    assert.deepEqual([response.newPhoto, response.coverImageURL, response.coverAlt], [false, "catalog://cover/pixabay-111", "Photo of axe"]);
    assert.deepEqual([r.downloads.length, r.created.length, r.touched], [0, 0, ["pixabay-111"]]);
  });

  test("a download failure or a removed cover is COVER_IMPORT_FAILED without leaking a URL", async () => {
    const a = rig();
    remembered(a.r);
    a.r.downloadImpl = async () => { throw new PixabayUnavailableError("download_failed"); };
    await assert.rejects(importCoverPhoto(a.deps, caller("admin1"), imp(6)), (error: unknown) =>
      error instanceof AdminError && error.reason === "COVER_IMPORT_FAILED" && !error.message.includes("pixabay.com"));
    assert.equal(a.r.created.length, 0);
    const b = rig();
    remembered(b.r);
    b.r.docs.set("pixabay-111", existingDoc(111, { status: "removed" }));
    await fails(importCoverPhoto(b.deps, caller("admin1"), imp(6)), "COVER_IMPORT_FAILED");
  });

  test("AI off or no live deps is COVER_SEARCH_UNAVAILABLE", async () => {
    const { r, deps } = rig({ aiEnabled: false });
    remembered(r);
    await fails(importCoverPhoto(deps, caller("admin1"), imp(7)), "COVER_SEARCH_UNAVAILABLE");
    assert.equal(r.downloads.length, 0);
  });
});
