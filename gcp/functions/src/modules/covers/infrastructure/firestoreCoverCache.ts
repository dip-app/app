import { createHash } from "node:crypto";
import type { CoverSearchCache, PixabayHit } from "../application/livePorts";
import { DAY_MS, toDate, type FirestoreLike } from "./firestoreTypes";

export const SEARCH_CACHE_COLLECTION = "coverSearchCache";
export const CANDIDATES_COLLECTION = "coverLiveCandidates";
const CACHE_VERSION = "v1";

/** Document id of a cached query: the hash only, so the (anonymized) query text is never stored. */
export const searchCacheId = (normalizedQuery: string): string =>
  createHash("sha256").update(`${normalizedQuery}|${CACHE_VERSION}`).digest("hex");

/** Plain, undefined-free copy of a hit (Firestore rejects undefined values). */
function cleanHit(h: PixabayHit): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: h.id, pageURL: h.pageURL, tags: h.tags, user: h.user, user_id: h.user_id,
    imageWidth: h.imageWidth, imageHeight: h.imageHeight, largeImageURL: h.largeImageURL, webformatURL: h.webformatURL,
  };
  if (h.previewURL !== undefined) out.previewURL = h.previewURL;
  return out;
}

function readHit(v: unknown): PixabayHit | null {
  if (typeof v !== "object" || v === null) return null;
  const h = v as Record<string, unknown>;
  if (typeof h.id !== "number" || typeof h.pageURL !== "string" || typeof h.tags !== "string" || typeof h.user !== "string" || typeof h.user_id !== "number" ||
      typeof h.imageWidth !== "number" || typeof h.imageHeight !== "number" || typeof h.largeImageURL !== "string" || typeof h.webformatURL !== "string") return null;
  const hit: PixabayHit = {
    id: h.id, pageURL: h.pageURL, tags: h.tags, user: h.user, user_id: h.user_id,
    imageWidth: h.imageWidth, imageHeight: h.imageHeight, largeImageURL: h.largeImageURL, webformatURL: h.webformatURL,
  };
  if (typeof h.previewURL === "string") hit.previewURL = h.previewURL;
  return hit;
}

/** 24 hour search cache (Pixabay terms) and the 24 hour candidate memory for admin imports. TTL policy on `expireAt` cleans up. */
export class FirestoreCoverSearchCache implements CoverSearchCache {
  constructor(private readonly db: FirestoreLike) {}

  async get(normalizedQuery: string, now: Date): Promise<PixabayHit[] | null> {
    const snap = await this.db.collection(SEARCH_CACHE_COLLECTION).doc(searchCacheId(normalizedQuery)).get();
    const d = snap.data();
    if (!snap.exists || !d) return null;
    const fetchedAt = toDate(d.fetchedAt);
    if (!fetchedAt || now.getTime() - fetchedAt.getTime() >= DAY_MS || !Array.isArray(d.hits)) return null;
    const hits: PixabayHit[] = [];
    for (const raw of d.hits) {
      const hit = readHit(raw);
      if (hit) hits.push(hit);
    }
    return hits;
  }

  async put(normalizedQuery: string, hits: readonly PixabayHit[], now: Date): Promise<void> {
    await this.db.collection(SEARCH_CACHE_COLLECTION).doc(searchCacheId(normalizedQuery)).set({
      hits: hits.map(cleanHit), fetchedAt: now, expireAt: new Date(now.getTime() + DAY_MS),
    });
  }

  async rememberCandidates(hits: readonly PixabayHit[], now: Date): Promise<void> {
    const expireAt = new Date(now.getTime() + DAY_MS);
    await Promise.all(hits.map(hit =>
      this.db.collection(CANDIDATES_COLLECTION).doc(`pixabay-${hit.id}`).set({ hit: cleanHit(hit), fetchedAt: now, expireAt })));
  }

  async candidate(pixabayId: number, now: Date): Promise<PixabayHit | null> {
    if (!Number.isSafeInteger(pixabayId) || pixabayId < 1) return null;
    const snap = await this.db.collection(CANDIDATES_COLLECTION).doc(`pixabay-${pixabayId}`).get();
    const d = snap.data();
    if (!snap.exists || !d) return null;
    const fetchedAt = toDate(d.fetchedAt);
    if (!fetchedAt || now.getTime() - fetchedAt.getTime() >= DAY_MS) return null;
    return readHit(d.hit);
  }
}
