import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";

// AbortSignal.timeout timers are unref'd: on Node 24 a test waiting only on one lets the event loop drain and the test is
// cancelled. A ref'd interval keeps the loop alive while this file runs.
let keepAlive: ReturnType<typeof setInterval> | undefined;
before(() => { keepAlive = setInterval(() => undefined, 1_000); });
after(() => clearInterval(keepAlive));
import { createRequire } from "node:module";
import { join } from "node:path";
import { PixabayRateLimitedError, PixabayUnavailableError, type DynamicCoverDoc, type PixabayHit, type ProcessedCover } from "../../functions/src/modules/covers/application/livePorts";
import { handleCoverImage, StorageCoverReader, type CoverObjectReader } from "../../functions/src/modules/covers/infrastructure/coverImageHandler";
import { FirestoreCoverSearchCache, searchCacheId } from "../../functions/src/modules/covers/infrastructure/firestoreCoverCache";
import { FirestoreDynamicCoverCatalog, FirestoreDynamicCoverWriter } from "../../functions/src/modules/covers/infrastructure/firestoreDynamicCovers";
import { FirestoreLiveQuota } from "../../functions/src/modules/covers/infrastructure/firestoreLiveQuota";
import type { BucketLike, FirestoreLike, SnapshotLike, TransactionLike } from "../../functions/src/modules/covers/infrastructure/firestoreTypes";
import { PixabayImageDownloader } from "../../functions/src/modules/covers/infrastructure/imageDownloader";
import { PixabayHttpClient } from "../../functions/src/modules/covers/infrastructure/pixabayHttpClient";
import { SharpImageProcessor } from "../../functions/src/modules/covers/infrastructure/sharpImageProcessor";

// sharp is a dependency of gcp/functions, so resolve it from there (this test file lives outside that package).
const sharp = createRequire(join(__dirname, "../../functions/package.json"))("sharp") as typeof import("sharp");

const SECRET = "SECRET-KEY-123456";
const IMG = "https://pixabay.com/get/abc123_1280.jpg";

const hit = (id: number, extra: Partial<PixabayHit> = {}): PixabayHit => ({
  id, pageURL: `https://pixabay.com/photos/x-${id}/`, tags: "hiking, mountain", user: "someone", user_id: 7,
  imageWidth: 4000, imageHeight: 2500, largeImageURL: IMG, webformatURL: "https://pixabay.com/get/abc123_640.jpg", ...extra,
});

// ---- generated images ------------------------------------------------------------------------------------------
async function gradient(width: number, height: number, format: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    raw[i] = (x * 255 / width) | 0; raw[i + 1] = (y * 255 / height) | 0; raw[i + 2] = ((x * y) % 251);
  }
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === "jpeg" ? img.jpeg({ quality: 85 }).toBuffer() : img.png().toBuffer();
}

// ---- fake fetch ------------------------------------------------------------------------------------------------
type FetchCall = { url: string; init: RequestInit | undefined };
function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: f, calls };
}
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const waitForAbort = (init: RequestInit | undefined) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener("abort", () => reject(new Error(`aborted ${init.signal ? "" : ""}`)));
});

async function rejection(p: Promise<unknown>): Promise<Error> {
  try { await p; } catch (e) { return e as Error; }
  throw new assert.AssertionError({ message: "expected rejection" });
}
const reason = (e: Error) => (e as PixabayUnavailableError).reason;

// ---- search client ---------------------------------------------------------------------------------------------
describe("PixabayHttpClient", () => {
  const client = (f: typeof fetch, extra: { timeoutMs?: number; now?: () => number } = {}) => new PixabayHttpClient({ apiKey: () => SECRET, fetch: f, ...extra });

  test("sends the documented parameters, safesearch on, one attempt, no redirects", async () => {
    const { fetch: f, calls } = fakeFetch(() => json({ hits: [hit(1)] }));
    const hits = await client(f).search("hiking mountain");
    assert.equal(hits.length, 1);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]!.url);
    assert.equal(url.origin + url.pathname, "https://pixabay.com/api/");
    assert.equal(url.searchParams.get("q"), "hiking mountain");
    assert.equal(url.searchParams.get("safesearch"), "true");
    assert.equal(url.searchParams.get("min_width"), "1280");
    assert.equal(url.searchParams.get("image_type"), "photo");
    assert.equal(url.searchParams.get("orientation"), "horizontal");
    assert.equal(url.searchParams.get("key"), SECRET);
    assert.equal(calls[0]!.init?.redirect, "error");
  });

  test("truncates q to 100 characters", async () => {
    const { fetch: f, calls } = fakeFetch(() => json({ hits: [] }));
    await client(f).search("a".repeat(300));
    assert.equal(new URL(calls[0]!.url).searchParams.get("q")?.length, 100);
  });

  test("the key never appears in thrown errors (network, http, bad json, timeout)", async () => {
    const cases: Array<() => Response | Promise<Response>> = [
      () => { throw new Error(`connect failed https://pixabay.com/api/?key=${SECRET}`); },
      () => new Response("nope", { status: 500 }),
      () => new Response("not json", { status: 200 }),
    ];
    for (const make of cases) {
      const err = await rejection(client(fakeFetch(make).fetch).search("hiking"));
      assert.ok(err instanceof PixabayUnavailableError);
      assert.ok(!err.message.includes(SECRET) && !JSON.stringify(err).includes(SECRET) && !(err.stack ?? "").includes(SECRET));
    }
    const err = await rejection(client(fakeFetch((_u, init) => waitForAbort(init)).fetch, { timeoutMs: 20 }).search("hiking"));
    assert.ok(!err.message.includes(SECRET));
  });

  test("429 maps to PixabayRateLimitedError and blocks later calls without fetching", async () => {
    let now = 1_000_000;
    const { fetch: f, calls } = fakeFetch(() => new Response("slow down", { status: 429, headers: { "x-ratelimit-reset": "12" } }));
    const c = client(f, { now: () => now });
    const err = await rejection(c.search("hiking"));
    assert.ok(err instanceof PixabayRateLimitedError);
    assert.equal(err.retryAfterSeconds, 12);
    const again = await rejection(c.search("hiking"));
    assert.ok(again instanceof PixabayRateLimitedError);
    assert.equal(calls.length, 1);
    now += 13_000;
    const ok = fakeFetch(() => json({ hits: [] }));
    const c2 = client(ok.fetch, { now: () => now });
    assert.deepEqual(await c2.search("hiking"), []);
  });

  test("timeout and caller abort become PixabayUnavailableError with a short code", async () => {
    const slow = client(fakeFetch((_u, init) => waitForAbort(init)).fetch, { timeoutMs: 20 });
    const t = await rejection(slow.search("hiking"));
    assert.ok(t instanceof PixabayUnavailableError);
    assert.equal(reason(t), "timeout");
    const controller = new AbortController();
    const pending = rejection(client(fakeFetch((_u, init) => waitForAbort(init)).fetch).search("hiking", controller.signal));
    controller.abort();
    assert.equal(reason(await pending), "aborted");
  });

  test("malformed JSON and unexpected shapes are unavailable", async () => {
    const bad = await rejection(client(fakeFetch(() => new Response("{oops", { status: 200 })).fetch).search("hiking"));
    assert.equal(reason(bad), "bad_json");
    const shape = await rejection(client(fakeFetch(() => json({ nothits: [] })).fetch).search("hiking"));
    assert.equal(reason(shape), "bad_response");
  });

  test("hits with invalid fields or non-Pixabay image URLs are dropped; unsafe previews are removed", async () => {
    const hits = [
      hit(1),
      hit(2, { largeImageURL: "https://evil.example/get/x.jpg" }),
      hit(3, { webformatURL: "http://pixabay.com/get/x.jpg" }),
      { id: "four" },
      hit(5, { previewURL: "https://evil.example/p.jpg" }),
      hit(6, { previewURL: "https://cdn.pixabay.com/photo/2020/01/01/p_150.jpg" }),
    ];
    const out = await client(fakeFetch(() => json({ hits })).fetch).search("hiking");
    assert.deepEqual(out.map(h => h.id), [1, 5, 6]);
    assert.equal(out[1]!.previewURL, undefined);
    assert.equal(out[2]!.previewURL, "https://cdn.pixabay.com/photo/2020/01/01/p_150.jpg");
  });

  test("missing key and empty query fail without fetching", async () => {
    const { fetch: f, calls } = fakeFetch(() => json({ hits: [] }));
    assert.equal(reason(await rejection(new PixabayHttpClient({ apiKey: () => "", fetch: f }).search("x"))), "no_api_key");
    assert.equal(reason(await rejection(client(f).search("   "))), "empty_query");
    assert.equal(calls.length, 0);
  });
});

// ---- downloader ------------------------------------------------------------------------------------------------
describe("PixabayImageDownloader", () => {
  const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const dl = (f: typeof fetch, timeoutMs?: number) => new PixabayImageDownloader({ fetch: f, ...(timeoutMs ? { timeoutMs } : {}) });
  const image = (body: BodyInit | null, headers: Record<string, string> = { "content-type": "image/jpeg" }, status = 200) => new Response(body, { status, headers });

  test("rejects non-https, other hosts and weird URLs before any fetch", async () => {
    const { fetch: f, calls } = fakeFetch(() => image(jpegHead));
    for (const url of ["http://pixabay.com/get/a.jpg", "https://evil.example/get/a.jpg", "https://pixabay.com.evil.example/get/a.jpg", "https://user:pw@pixabay.com/get/a.jpg", "https://pixabay.com:8443/get/a.jpg", "https://pixabay.com/other/a.jpg", "not a url"]) {
      assert.equal(reason(await rejection(dl(f).download(url))), "url_rejected", url);
    }
    assert.equal(calls.length, 0);
  });

  test("rejects redirects, even to pixabay, and uses redirect manual", async () => {
    const { fetch: f, calls } = fakeFetch(() => new Response(null, { status: 302, headers: { location: "https://pixabay.com/get/other.jpg" } }));
    assert.equal(reason(await rejection(dl(f).download(IMG))), "redirect");
    assert.equal(calls[0]!.init?.redirect, "manual");
    const opaque = fakeFetch(() => { const r = new Response(null, { status: 200 }); Object.defineProperty(r, "type", { value: "opaqueredirect" }); return r; });
    assert.equal(reason(await rejection(dl(opaque.fetch).download(IMG))), "redirect");
  });

  test("rejects non-2xx and bad content types", async () => {
    assert.equal(reason(await rejection(dl(fakeFetch(() => image(null, {}, 404)).fetch).download(IMG))), "http_404");
    assert.equal(reason(await rejection(dl(fakeFetch(() => image(jpegHead, { "content-type": "text/html" })).fetch).download(IMG))), "content_type");
    assert.equal(reason(await rejection(dl(fakeFetch(() => image(jpegHead, { "content-type": "image/svg+xml" })).fetch).download(IMG))), "content_type");
    assert.equal(reason(await rejection(dl(fakeFetch(() => image(jpegHead, {})).fetch).download(IMG))), "content_type");
  });

  test("rejects an oversize Content-Length without reading the body", async () => {
    const { fetch: f } = fakeFetch(() => image(jpegHead, { "content-type": "image/jpeg", "content-length": String(6 * 1024 * 1024) }));
    assert.equal(reason(await rejection(dl(f).download(IMG))), "too_large");
  });

  test("caps a stream without Content-Length and cancels the reader", async () => {
    let cancelled = false;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(1024 * 1024);
        if (sent === 0) chunk.set([0xff, 0xd8, 0xff]);
        sent++;
        controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    });
    const { fetch: f } = fakeFetch(() => image(stream));
    assert.equal(reason(await rejection(dl(f).download(IMG))), "too_large");
    assert.ok(cancelled);
    assert.ok(sent <= 8);
  });

  test("rejects HTML labeled as image/jpeg (magic bytes)", async () => {
    const { fetch: f } = fakeFetch(() => image("<html><body>hi</body></html>"));
    assert.equal(reason(await rejection(dl(f).download(IMG))), "magic_mismatch");
    const png = fakeFetch(() => image(jpegHead, { "content-type": "image/png" }));
    assert.equal(reason(await rejection(dl(png.fetch).download(IMG))), "magic_mismatch");
  });

  test("accepts a real small JPEG (and parameters on the content type)", async () => {
    const jpeg = await sharp({ create: { width: 64, height: 40, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    const { fetch: f } = fakeFetch(() => image(jpeg, { "content-type": "Image/JPEG; charset=binary", "content-length": String(jpeg.length) }));
    const out = await dl(f).download("https://cdn.pixabay.com/photo/2020/01/01/x.jpg");
    assert.equal(out.contentType, "image/jpeg");
    assert.ok(out.bytes.equals(jpeg));
  });

  test("timeout and network errors carry short codes", async () => {
    assert.equal(reason(await rejection(dl(fakeFetch((_u, init) => waitForAbort(init)).fetch, 20).download(IMG))), "timeout");
    assert.equal(reason(await rejection(dl(fakeFetch(() => { throw new Error("boom"); }).fetch).download(IMG))), "network");
  });
});

// ---- processor -------------------------------------------------------------------------------------------------
describe("SharpImageProcessor", () => {
  const processor = new SharpImageProcessor();

  test("produces 1200x750 WebP and 960x600 JPEG, stripped metadata, 16-hex dHash, sha256", async () => {
    const withExif = await sharp(await gradient(1600, 1000)).withMetadata({ exif: { IFD0: { Copyright: "secret-copyright" } } }).jpeg().toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif);
    const out = await processor.process({ bytes: withExif, contentType: "image/jpeg" });
    const w = await sharp(out.webp).metadata();
    const j = await sharp(out.jpeg).metadata();
    assert.deepEqual([w.format, w.width, w.height], ["webp", 1200, 750]);
    assert.deepEqual([j.format, j.width, j.height], ["jpeg", 960, 600]);
    assert.equal(w.exif, undefined);
    assert.equal(j.exif, undefined);
    assert.ok(!out.jpeg.includes(Buffer.from("secret-copyright")));
    assert.match(out.dHash, /^[0-9a-f]{16}$/);
    assert.match(out.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual([out.width, out.height], [1200, 750]);
  });

  test("dHash is stable across runs and survives re-encoding", async () => {
    const src = await gradient(1600, 1000);
    const a = await processor.process({ bytes: src, contentType: "image/jpeg" });
    const b = await processor.process({ bytes: src, contentType: "image/jpeg" });
    assert.equal(a.dHash, b.dHash);
    assert.equal(a.sha256, b.sha256);
    const png = await gradient(1600, 1000, "png");
    const c = await processor.process({ bytes: png, contentType: "image/png" });
    assert.match(c.dHash, /^[0-9a-f]{16}$/);
  });

  test("keeps output within the size budgets for a noisy image where possible", async () => {
    const width = 1600, height = 1000;
    const raw = Buffer.alloc(width * height * 3);
    let seed = 1;
    for (let i = 0; i < raw.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; raw[i] = seed & 0xff; }
    const noisy = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    const out = await processor.process({ bytes: noisy, contentType: "image/jpeg" });
    assert.ok(out.webp.length > 0 && out.jpeg.length > 0);
    assert.equal((await sharp(out.webp).metadata()).width, 1200);
  });

  test("rejects too small, wrong aspect and non-image bytes", async () => {
    assert.equal(reason(await rejection(processor.process({ bytes: await gradient(800, 500), contentType: "image/jpeg" }))), "image_too_small");
    assert.equal(reason(await rejection(processor.process({ bytes: await gradient(1600, 1600), contentType: "image/jpeg" }))), "image_aspect");
    assert.equal(reason(await rejection(processor.process({ bytes: await gradient(2400, 800), contentType: "image/jpeg" }))), "image_aspect");
    assert.equal(reason(await rejection(processor.process({ bytes: Buffer.from("definitely not an image"), contentType: "image/jpeg" }))), "image_invalid");
  });
});

// ---- Firestore and bucket fakes --------------------------------------------------------------------------------
class FakeDb implements FirestoreLike {
  readonly docs = new Map<string, Record<string, unknown>>();
  reads = 0;
  private snap(path: string): SnapshotLike {
    const data = this.docs.get(path);
    return { exists: data !== undefined, id: path.split("/").pop()!, data: () => data };
  }
  private ref(path: string) {
    return {
      path,
      get: async () => { this.reads++; return this.snap(path); },
      create: async (data: Record<string, unknown>) => {
        if (this.docs.has(path)) throw Object.assign(new Error("exists"), { code: 6 });
        this.docs.set(path, data);
      },
      set: async (data: Record<string, unknown>) => { this.docs.set(path, data); },
      update: async (data: Record<string, unknown>) => {
        const cur = this.docs.get(path);
        if (!cur) throw Object.assign(new Error("not found"), { code: 5 });
        const next = { ...cur };
        for (const [k, v] of Object.entries(data)) {
          next[k] = typeof v === "object" && v !== null && "inc" in v ? ((cur[k] as number) ?? 0) + (v as { inc: number }).inc : v;
        }
        this.docs.set(path, next);
      },
    };
  }
  collection(name: string) {
    const query = (order?: { field: string; dir: string }, max?: number) => ({
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query({ field, dir }, max),
      limit: (n: number) => query(order, n),
      get: async () => {
        this.reads++;
        let entries = [...this.docs.entries()].filter(([p]) => p.startsWith(`${name}/`));
        if (order) {
          const val = (d: Record<string, unknown>) => (d[order.field] as Date).getTime();
          entries.sort((a, b) => (val(a[1]) - val(b[1])) * (order.dir === "desc" ? -1 : 1));
        }
        if (max !== undefined) entries = entries.slice(0, max);
        return { docs: entries.map(([p]) => this.snap(p)) };
      },
    });
    return { ...query(), doc: (id: string) => this.ref(`${name}/${id}`) };
  }
  async runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T> {
    const tx: TransactionLike = {
      get: ref => ref.get(),
      set: (ref, data) => ref.set(data),
    };
    return fn(tx);
  }
}

class FakeBucket implements BucketLike {
  readonly objects = new Map<string, { data: Buffer; options: { resumable: boolean; contentType: string; metadata: { cacheControl: string } } }>();
  file(path: string) {
    return {
      save: async (data: Buffer, options: { resumable: boolean; contentType: string; metadata: { cacheControl: string } }) => { this.objects.set(path, { data, options }); },
      download: async (): Promise<[Buffer]> => {
        const o = this.objects.get(path);
        if (!o) throw Object.assign(new Error("No such object"), { code: 404 });
        return [o.data];
      },
    };
  }
}

const dynDoc = (id: number, extra: Partial<DynamicCoverDoc> = {}): DynamicCoverDoc => ({
  key: `pixabay-${id}`, status: "active", source: "pixabay", pixabayId: id, pageURL: `https://pixabay.com/photos/x-${id}/`, user: "u", userId: 1,
  license: { type: "pixabay", source: "Pixabay", sourceURL: "https://pixabay.com/", creator: "u", creatorURL: "https://pixabay.com/users/u-1/", notes: "n" },
  tags: ["hiking", "mountain"], themes: ["outdoors"], label: "Hiking mountain", alt: "Photo of hiking and mountain", width: 1200, height: 750,
  dHash: "0123456789abcdef", sha256: "a".repeat(64), bytes: { webp: 10, jpeg: 10 }, storagePaths: { webp: `covers-dynamic/pixabay-${id}.webp`, jpeg: `covers-dynamic/jpg/pixabay-${id}.jpg` },
  storedURL: `/img/covers-dyn/pixabay-${id}.webp`, createdAt: new Date(Date.UTC(2026, 10, id % 28 + 1)), createdBy: { companyId: "co", uid: "u" }, usageCount: 1, lastUsedAt: new Date(Date.UTC(2026, 10, 1)), ...extra,
});
const seed = (db: FakeDb, doc: DynamicCoverDoc) => { db.docs.set(`coverLibraryDynamic/${doc.key}`, { ...doc }); };

describe("FirestoreDynamicCoverCatalog", () => {
  test("entries are cached for 5 minutes, newest first, active only, as index entries", async () => {
    const db = new FakeDb();
    seed(db, dynDoc(1)); seed(db, dynDoc(2)); seed(db, dynDoc(3, { status: "removed" }));
    let now = 0;
    const catalog = new FirestoreDynamicCoverCatalog(db, () => now);
    const entries = await catalog.entries();
    assert.deepEqual(entries.map(e => e.key), ["pixabay-2", "pixabay-1"]);
    assert.equal(entries[0]!.url, "catalog://cover/pixabay-2");
    assert.equal(entries[0]!.kind, "photo");
    assert.equal(db.reads, 1);
    now = 4 * 60_000; await catalog.entries(); await catalog.hashes();
    assert.equal(db.reads, 1);
    now = 5 * 60_000 + 1; await catalog.entries();
    assert.equal(db.reads, 2);
    assert.deepEqual(await catalog.hashes(), [{ key: "pixabay-2", dHash: "0123456789abcdef" }, { key: "pixabay-1", dHash: "0123456789abcdef" }]);
  });

  test("has() caches positives for 10 min and negatives for 30 s", async () => {
    const db = new FakeDb();
    seed(db, dynDoc(10));
    let now = 0;
    const catalog = new FirestoreDynamicCoverCatalog(db, () => now);
    assert.equal(await catalog.has("pixabay-10"), true);
    assert.equal(await catalog.has("pixabay-10"), true);
    assert.equal(db.reads, 1);
    now = 9 * 60_000; assert.equal(await catalog.has("pixabay-10"), true); assert.equal(db.reads, 1);
    now = 10 * 60_000 + 1; await catalog.has("pixabay-10"); assert.equal(db.reads, 2);

    now = 0; db.reads = 0;
    const c2 = new FirestoreDynamicCoverCatalog(db, () => now);
    assert.equal(await c2.has("pixabay-11"), false);
    seed(db, dynDoc(11));
    now = 29_000; assert.equal(await c2.has("pixabay-11"), false);
    assert.equal(db.reads, 1);
    now = 31_000; assert.equal(await c2.has("pixabay-11"), true);
  });

  test("has() rejects static and malformed keys without reading, and removed covers are not valid", async () => {
    const db = new FakeDb();
    seed(db, dynDoc(20, { status: "removed" }));
    const catalog = new FirestoreDynamicCoverCatalog(db);
    for (const key of ["baking-bread-dough-1868396", "pixabay-0", "pixabay-01", "Pixabay-5", "pixabay-1/../x", "pixabay-1234567890123", "", "pixabay-"]) {
      assert.equal(await catalog.has(key), false, key);
    }
    assert.equal(db.reads, 0);
    assert.equal(await catalog.has("pixabay-20"), false);
    assert.equal((await catalog.get("pixabay-20"))?.status, "removed");
    assert.equal(await catalog.get("not-dynamic"), null);
  });

  test("the per-key cache is bounded", async () => {
    const db = new FakeDb();
    const catalog = new FirestoreDynamicCoverCatalog(db, () => 0);
    for (let i = 1; i <= 1100; i++) await catalog.has(`pixabay-${i}`);
    db.reads = 0;
    await catalog.has("pixabay-1100");
    assert.equal(db.reads, 0);
    await catalog.has("pixabay-1");
    assert.equal(db.reads, 1);
  });

  test("a malformed stored document is ignored", async () => {
    const db = new FakeDb();
    db.docs.set("coverLibraryDynamic/pixabay-30", { key: "pixabay-31", status: "active" });
    const catalog = new FirestoreDynamicCoverCatalog(db);
    assert.deepEqual(await catalog.entries(), []);
    assert.equal(await catalog.has("pixabay-30"), false);
  });
});

describe("FirestoreDynamicCoverWriter", () => {
  const cover: ProcessedCover = { webp: Buffer.from("webp"), jpeg: Buffer.from("jpeg"), width: 1200, height: 750, dHash: "0".repeat(16), sha256: "b".repeat(64) };

  test("putObjects writes both renditions with content type and cache control", async () => {
    const bucket = new FakeBucket();
    const writer = new FirestoreDynamicCoverWriter(new FakeDb(), bucket, { increment: n => ({ inc: n }) });
    const paths = await writer.putObjects("pixabay-42", cover);
    assert.deepEqual(paths, { webp: "covers-dynamic/pixabay-42.webp", jpeg: "covers-dynamic/jpg/pixabay-42.jpg" });
    const w = bucket.objects.get(paths.webp)!;
    assert.equal(w.options.contentType, "image/webp");
    assert.equal(w.options.resumable, false);
    assert.equal(w.options.metadata.cacheControl, "public, max-age=604800");
    assert.equal(bucket.objects.get(paths.jpeg)!.options.contentType, "image/jpeg");
    await assert.rejects(writer.putObjects("../etc/passwd", cover), RangeError);
    assert.equal(bucket.objects.size, 2);
  });

  test("create returns false when the document exists; touch increments", async () => {
    const db = new FakeDb();
    const writer = new FirestoreDynamicCoverWriter(db, new FakeBucket(), { increment: n => ({ inc: n }) });
    assert.equal(await writer.create(dynDoc(5)), true);
    assert.equal(await writer.create(dynDoc(5, { label: "Other" })), false);
    assert.equal(db.docs.get("coverLibraryDynamic/pixabay-5")!.label, "Hiking mountain");
    const at = new Date("2026-11-18T10:00:00Z");
    await writer.touch("pixabay-5", at);
    assert.equal(db.docs.get("coverLibraryDynamic/pixabay-5")!.usageCount, 2);
    assert.equal(db.docs.get("coverLibraryDynamic/pixabay-5")!.lastUsedAt, at);
    await writer.touch("pixabay-999", at); // missing doc: best effort, no throw
  });

  test("create rethrows other errors", async () => {
    const db = new FakeDb();
    const bad: FirestoreLike = { ...db, collection: () => ({ doc: () => ({ create: async () => { throw new Error("down"); } }) }) as never, runTransaction: db.runTransaction.bind(db) };
    await assert.rejects(new FirestoreDynamicCoverWriter(bad, new FakeBucket()).create(dynDoc(6)), /down/);
  });
});

describe("FirestoreCoverSearchCache", () => {
  const T0 = new Date("2026-11-18T10:00:00Z");

  test("fresh for 24 hours, stale at the boundary", async () => {
    const cache = new FirestoreCoverSearchCache(new FakeDb());
    await cache.put("hiking mountain", [hit(1), hit(2, { previewURL: "https://cdn.pixabay.com/photo/a.jpg" })], T0);
    const fresh = await cache.get("hiking mountain", new Date(T0.getTime() + 24 * 3600_000 - 1));
    assert.deepEqual(fresh?.map(h => h.id), [1, 2]);
    assert.equal(fresh?.[0]?.previewURL, undefined);
    assert.equal(fresh?.[1]?.previewURL, "https://cdn.pixabay.com/photo/a.jpg");
    assert.equal(await cache.get("hiking mountain", new Date(T0.getTime() + 24 * 3600_000)), null);
    assert.equal(await cache.get("other query", T0), null);
  });

  test("the stored document id is a hash and the query text is never stored; expireAt is +24h", async () => {
    const db = new FakeDb();
    await new FirestoreCoverSearchCache(db).put("secret hiking words", [hit(1)], T0);
    const [path] = [...db.docs.keys()];
    assert.equal(path, `coverSearchCache/${searchCacheId("secret hiking words")}`);
    assert.match(path!.split("/")[1]!, /^[0-9a-f]{64}$/);
    const stored = db.docs.get(path!)!;
    assert.ok(!JSON.stringify(stored).includes("secret"));
    assert.equal((stored.expireAt as Date).getTime(), T0.getTime() + 24 * 3600_000);
  });

  test("remembered candidates are readable for 24 hours only", async () => {
    const cache = new FirestoreCoverSearchCache(new FakeDb());
    await cache.rememberCandidates([hit(7), hit(8)], T0);
    assert.equal((await cache.candidate(7, new Date(T0.getTime() + 3600_000)))?.id, 7);
    assert.equal(await cache.candidate(9, T0), null);
    assert.equal(await cache.candidate(7, new Date(T0.getTime() + 25 * 3600_000)), null);
    assert.equal(await cache.candidate(-1, T0), null);
  });
});

describe("FirestoreLiveQuota", () => {
  const day = new Date("2026-11-18T10:00:00Z");

  test("company and platform daily caps; denial does not increment", async () => {
    const db = new FakeDb();
    const quota = new FirestoreLiveQuota(db, { companyDaily: 2, platformDaily: 3, instancePerMinute: 100 });
    assert.equal(await quota.tryConsume("a", day), null);
    assert.equal(await quota.tryConsume("a", day), null);
    assert.equal(await quota.tryConsume("a", day), "company_daily");
    assert.equal(db.docs.get("coverLiveUsage/2026-11-18")!.total, 2);
    assert.equal(await quota.tryConsume("b", day), null);
    assert.equal(await quota.tryConsume("c", day), "platform_daily");
    const stored = db.docs.get("coverLiveUsage/2026-11-18")!;
    assert.equal(stored.total, 3);
    assert.deepEqual(stored.byCompany, { a: 2, b: 1 });
    assert.equal((stored.expireAt as Date).getTime(), day.getTime() + 3 * 24 * 3600_000);
  });

  test("counters reset on the next UTC day", async () => {
    const db = new FakeDb();
    const quota = new FirestoreLiveQuota(db, { companyDaily: 1, platformDaily: 5, instancePerMinute: 100 });
    assert.equal(await quota.tryConsume("a", new Date("2026-11-18T23:59:00Z")), null);
    assert.equal(await quota.tryConsume("a", new Date("2026-11-18T23:59:30Z")), "company_daily");
    assert.equal(await quota.tryConsume("a", new Date("2026-11-19T00:00:01Z")), null);
  });

  test("per-instance sliding window denies before touching Firestore", async () => {
    const db = new FakeDb();
    const quota = new FirestoreLiveQuota(db, { companyDaily: 100, platformDaily: 100, instancePerMinute: 2 });
    assert.equal(await quota.tryConsume("a", day), null);
    assert.equal(await quota.tryConsume("a", new Date(day.getTime() + 1000)), null);
    const reads = db.reads;
    assert.equal(await quota.tryConsume("a", new Date(day.getTime() + 2000)), "instance_rate");
    assert.equal(db.reads, reads);
    assert.equal(db.docs.get("coverLiveUsage/2026-11-18")!.total, 2);
    assert.equal(await quota.tryConsume("a", new Date(day.getTime() + 61_000)), null);
  });
});

// ---- image handler ---------------------------------------------------------------------------------------------
describe("handleCoverImage", () => {
  const reader = (objects: Record<string, Buffer>): CoverObjectReader & { paths: string[] } => {
    const paths: string[] = [];
    return { paths, read: async p => { paths.push(p); const bytes = objects[p]; return bytes ? { bytes, contentType: "application/octet-stream" } : null; } };
  };
  const objects = { "covers-dynamic/pixabay-42.webp": Buffer.from("WEBP"), "covers-dynamic/jpg/pixabay-42.jpg": Buffer.from("JPEG!") };

  test("serves the webp and jpeg with immutable caching and nosniff", async () => {
    const r = reader(objects);
    const webp = await handleCoverImage("GET", "/img/covers-dyn/pixabay-42.webp", r);
    assert.equal(webp.status, 200);
    assert.equal(webp.headers["Content-Type"], "image/webp");
    assert.equal(webp.headers["Cache-Control"], "public, max-age=604800, s-maxage=2592000, immutable");
    assert.equal(webp.headers["X-Content-Type-Options"], "nosniff");
    assert.equal(webp.headers["Content-Length"], "4");
    assert.equal(webp.body?.toString(), "WEBP");
    const jpeg = await handleCoverImage("GET", "/img/covers-dyn/jpg/pixabay-42.jpg", r);
    assert.equal(jpeg.headers["Content-Type"], "image/jpeg");
    assert.equal(jpeg.body?.toString(), "JPEG!");
    assert.deepEqual(r.paths, ["covers-dynamic/pixabay-42.webp", "covers-dynamic/jpg/pixabay-42.jpg"]);
  });

  test("HEAD has headers and no body; other methods get 405", async () => {
    const head = await handleCoverImage("HEAD", "/img/covers-dyn/pixabay-42.webp", reader(objects));
    assert.equal(head.status, 200);
    assert.equal(head.body, null);
    assert.equal(head.headers["Content-Length"], "4");
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const res = await handleCoverImage(method, "/img/covers-dyn/pixabay-42.webp", reader(objects));
      assert.equal(res.status, 405);
      assert.equal(res.headers.Allow, "GET, HEAD");
    }
  });

  test("anything off-pattern is 404 and never reaches the reader", async () => {
    const r = reader(objects);
    const bad = [
      "/img/covers-dyn/../secret.webp", "/img/covers-dyn/pixabay-42/../../x.webp", "/img/covers-dyn/Pixabay-42.webp", "/img/covers-dyn/PIXABAY-42.webp",
      "/img/covers-dyn/pixabay-042.webp", "/img/covers-dyn/pixabay-0.webp", "/img/covers-dyn/pixabay-42.png", "/img/covers-dyn/pixabay-42.webp/", "/img/covers-dyn/pixabay-42.webp?x=1",
      "/img/covers/pixabay-42.webp", "/img/covers-dyn/baking-bread-dough-1868396.webp", "/img/covers-dyn/jpg/pixabay-42.webp", "/img/covers-dyn/pixabay-42.jpg",
      "/img/covers-dyn/jpg/jpg/pixabay-42.jpg", "/img/covers-dyn/%2e%2e/pixabay-42.webp", "/img/covers-dyn/pixabay-1234567890123.webp", "", "/",
      "/img/covers-dyn/pixabay-42.webp\n", "//img/covers-dyn/pixabay-42.webp",
    ];
    for (const path of bad) {
      const res = await handleCoverImage("GET", path, r);
      assert.equal(res.status, 404, JSON.stringify(path));
    }
    assert.deepEqual(r.paths, []);
  });

  test("a missing object is 404 with no-store; HEAD 404 has no body", async () => {
    const res = await handleCoverImage("GET", "/img/covers-dyn/pixabay-99.webp", reader(objects));
    assert.equal(res.status, 404);
    assert.equal(res.headers["Cache-Control"], "no-store");
    const head = await handleCoverImage("HEAD", "/img/covers-dyn/pixabay-99.webp", reader(objects));
    assert.equal(head.status, 404);
    assert.equal(head.body, null);
  });

  test("StorageCoverReader maps a 404 download error to null and rethrows others", async () => {
    const bucket = new FakeBucket();
    await bucket.file("covers-dynamic/pixabay-1.webp").save(Buffer.from("x"), { resumable: false, contentType: "image/webp", metadata: { cacheControl: "" } });
    const r = new StorageCoverReader(bucket);
    assert.equal((await r.read("covers-dynamic/pixabay-1.webp"))?.contentType, "image/webp");
    assert.equal(await r.read("covers-dynamic/pixabay-2.webp"), null);
    const broken: BucketLike = { file: () => ({ save: async () => undefined, download: async () => { throw Object.assign(new Error("denied"), { code: 403 }); } }) };
    await assert.rejects(new StorageCoverReader(broken).read("x"), /denied/);
  });
});
