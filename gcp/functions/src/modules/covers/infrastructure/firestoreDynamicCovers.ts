import { FieldValue } from "firebase-admin/firestore";
import type { CoverIndexEntry } from "../domain/catalog.generated";
import type { DynamicCoverCatalog, DynamicCoverDoc, DynamicCoverWriter, ProcessedCover } from "../application/livePorts";
import { dynamicStoragePaths, isDynamicCoverKey, toIndexEntry } from "../domain/dynamicCovers";
import { toDate, type BucketLike, type FirestoreLike, type SnapshotLike } from "./firestoreTypes";

export const DYNAMIC_COVERS_COLLECTION = "coverLibraryDynamic";
const LIST_LIMIT = 300;
const LIST_TTL_MS = 5 * 60_000;
const KEY_POSITIVE_TTL_MS = 10 * 60_000;
const KEY_NEGATIVE_TTL_MS = 30_000;
const KEY_CACHE_MAX = 1000;
const CACHE_CONTROL = "public, max-age=604800";

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");

/** Reads a stored document defensively; null when it is not a usable dynamic cover document. */
export function docFromSnapshot(snap: SnapshotLike): DynamicCoverDoc | null {
  const d = snap.data();
  if (!snap.exists || !d || !isDynamicCoverKey(d.key) || d.key !== snap.id) return null;
  if (d.status !== "active" && d.status !== "removed") return null;
  if (!isStringArray(d.tags) || !isStringArray(d.themes) || typeof d.label !== "string" || typeof d.alt !== "string") return null;
  const createdAt = toDate(d.createdAt);
  const lastUsedAt = toDate(d.lastUsedAt);
  if (!createdAt || !lastUsedAt) return null;
  return { ...(d as unknown as DynamicCoverDoc), createdAt, lastUsedAt };
}

interface Listing { at: number; docs: DynamicCoverDoc[] }

/** Read side. Newest 300 dynamic covers feed the shortlist (5 min cache); `has` validates a key for event writes. */
export class FirestoreDynamicCoverCatalog implements DynamicCoverCatalog {
  private listing: Listing | null = null;
  private pending: Promise<Listing> | null = null;
  private readonly keys = new Map<string, { at: number; ok: boolean }>();

  constructor(private readonly db: FirestoreLike, private readonly now: () => number = Date.now) {}

  private async load(): Promise<DynamicCoverDoc[]> {
    const t = this.now();
    if (this.listing && t - this.listing.at < LIST_TTL_MS) return this.listing.docs;
    // Filtering by status in memory avoids a composite index; removed covers are rare.
    this.pending ??= this.db.collection(DYNAMIC_COVERS_COLLECTION).orderBy("createdAt", "desc").limit(LIST_LIMIT).get()
      .then(res => {
        const docs: DynamicCoverDoc[] = [];
        for (const snap of res.docs) {
          const doc = docFromSnapshot(snap);
          if (doc?.status === "active") docs.push(doc);
        }
        const listing = { at: this.now(), docs };
        this.listing = listing;
        return listing;
      })
      .finally(() => { this.pending = null; });
    return (await this.pending).docs;
  }

  async entries(): Promise<CoverIndexEntry[]> {
    return (await this.load()).map(toIndexEntry);
  }

  async hashes(): Promise<Array<{ key: string; dHash: string }>> {
    return (await this.load()).filter(d => typeof d.dHash === "string" && d.dHash.length > 0).map(d => ({ key: d.key, dHash: d.dHash }));
  }

  /** The stored document for a dynamic key whatever its status (callers check `status`), or null. Cheap malformed keys never read. */
  async get(key: string): Promise<DynamicCoverDoc | null> {
    if (!isDynamicCoverKey(key)) return null;
    return docFromSnapshot(await this.db.collection(DYNAMIC_COVERS_COLLECTION).doc(key).get());
  }

  /** True only for an active stored dynamic cover. Static and malformed keys are rejected without a read. */
  async has(key: string): Promise<boolean> {
    if (!isDynamicCoverKey(key)) return false;
    const t = this.now();
    const cached = this.keys.get(key);
    if (cached && t - cached.at < (cached.ok ? KEY_POSITIVE_TTL_MS : KEY_NEGATIVE_TTL_MS)) return cached.ok;
    const doc = await this.get(key);
    const ok = doc?.status === "active";
    this.keys.delete(key);
    this.keys.set(key, { at: t, ok });
    if (this.keys.size > KEY_CACHE_MAX) {
      const oldest = this.keys.keys().next();
      if (!oldest.done) this.keys.delete(oldest.value);
    }
    return ok;
  }
}

export interface DynamicCoverWriterOptions {
  /** Defaults to FieldValue.increment; injectable so tests need no Firestore sentinel support. */
  increment?: (n: number) => unknown;
}

/** Write side: Storage objects first, then a create-only document. */
export class FirestoreDynamicCoverWriter implements DynamicCoverWriter {
  private readonly increment: (n: number) => unknown;
  constructor(private readonly db: FirestoreLike, private readonly bucket: BucketLike, options: DynamicCoverWriterOptions = {}) {
    this.increment = options.increment ?? (n => FieldValue.increment(n));
  }

  async putObjects(key: string, cover: ProcessedCover): Promise<{ webp: string; jpeg: string }> {
    if (!isDynamicCoverKey(key)) throw new RangeError("invalid dynamic cover key");
    const paths = dynamicStoragePaths(key);
    const save = (path: string, data: Buffer, contentType: string) =>
      this.bucket.file(path).save(data, { resumable: false, contentType, metadata: { cacheControl: CACHE_CONTROL } });
    await Promise.all([save(paths.webp, cover.webp, "image/webp"), save(paths.jpeg, cover.jpeg, "image/jpeg")]);
    return paths;
  }

  async create(doc: DynamicCoverDoc): Promise<boolean> {
    if (!isDynamicCoverKey(doc.key)) throw new RangeError("invalid dynamic cover key");
    try {
      await this.db.collection(DYNAMIC_COVERS_COLLECTION).doc(doc.key).create({ ...doc });
      return true;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 6 || code === "already-exists" || code === "ALREADY_EXISTS") return false;
      throw error;
    }
  }

  async touch(key: string, now: Date): Promise<void> {
    if (!isDynamicCoverKey(key)) return;
    try {
      await this.db.collection(DYNAMIC_COVERS_COLLECTION).doc(key).update({ usageCount: this.increment(1), lastUsedAt: now });
    } catch { /* best effort */ }
  }
}
