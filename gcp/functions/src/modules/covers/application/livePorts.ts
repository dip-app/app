import type { CoverIndexEntry } from "../domain/catalog.generated";
import type { CoverKeySource } from "../domain/coverCatalog";

/**
 * Ports of the live Pixabay cover fallback (docs/design/cover-library.md, Live fallback). The application service
 * (liveCover.ts) depends only on these; infrastructure adapters implement them and tests inject fakes. Nothing here may
 * carry the Pixabay API key, a full request URL or event text into logs.
 */

/** One Pixabay search hit, trimmed to the fields we keep (cache documents store exactly this shape). */
export interface PixabayHit {
  id: number;
  pageURL: string;
  /** Comma-separated tags as Pixabay returns them. */
  tags: string;
  user: string;
  user_id: number;
  imageWidth: number;
  imageHeight: number;
  /** 1280 px rendition on https://pixabay.com/get/...; downloaded once, never hotlinked. */
  largeImageURL: string;
  /** 640 px rendition, valid 24 hours; only for temporarily displaying search results. */
  webformatURL: string;
  previewURL?: string;
}

/** Thrown by the search port on HTTP 429 (after penalizing the limiter). */
export class PixabayRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) { super("Pixabay rate limited"); this.name = "PixabayRateLimitedError"; }
}
/** Any other search or download failure (network, timeout, non-2xx, malformed JSON, failed validation). `reason` is a short code, never a URL. */
export class PixabayUnavailableError extends Error {
  constructor(readonly reason: string) { super(`Pixabay unavailable: ${reason}`); this.name = "PixabayUnavailableError"; }
}

/** Pixabay API search (one HTTP attempt, bounded by a timeout; no waiting on the limiter: it throws instead). */
export interface PixabaySearchPort {
  search(query: string, signal?: AbortSignal): Promise<PixabayHit[]>;
}

/** 24 hour Firestore cache of search results keyed by the normalized query (only its hash is stored). */
export interface CoverSearchCache {
  get(normalizedQuery: string, now: Date): Promise<PixabayHit[] | null>;
  put(normalizedQuery: string, hits: readonly PixabayHit[], now: Date): Promise<void>;
  /** Remembers a hit shown to an admin (Search more photos) for 24 hours so an import can only use API-returned URLs. */
  rememberCandidates?(hits: readonly PixabayHit[], now: Date): Promise<void>;
  /** A hit remembered within the last 24 hours, or null. */
  candidate?(pixabayId: number, now: Date): Promise<PixabayHit | null>;
}

export type QuotaDenial = "company_daily" | "platform_daily" | "instance_rate";

/** Daily caps (per company and platform, Firestore counters) plus the per-instance burst limiter, checked before an API call. */
export interface LiveQuota {
  /** Consumes one live pull for the company; returns null when allowed, else why not. Never throws for a denial. */
  tryConsume(companyId: string, now: Date): Promise<QuotaDenial | null>;
}

/** A downloaded, validated source image. */
export interface DownloadedImage { bytes: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" }

/** SSRF-safe download of a Pixabay image URL (https, Pixabay hosts only, no redirects, timeout, size cap, magic bytes). */
export interface ImageDownloader {
  download(url: string, signal?: AbortSignal): Promise<DownloadedImage>;
}

/** Renditions produced from a source image. */
export interface ProcessedCover {
  /** 1200 x 750 WebP (iOS, admin). */
  webp: Buffer;
  /** 960 x 600 JPEG (emails, share page og:image). */
  jpeg: Buffer;
  width: number;
  height: number;
  /** 64-bit difference hash as 16 hex characters (near-duplicate detection). */
  dHash: string;
  /** SHA-256 hex of the WebP. */
  sha256: string;
}

/** Decodes, checks dimensions and re-encodes (strips metadata). Throws PixabayUnavailableError("image_invalid" | "image_too_small" | ...) on bad input. */
export interface ImageProcessor {
  process(source: DownloadedImage): Promise<ProcessedCover>;
}

/** Firestore document coverLibraryDynamic/{key} (server-only). */
export interface DynamicCoverDoc {
  key: string;
  status: "active" | "removed";
  source: "pixabay";
  pixabayId: number;
  pageURL: string;
  user: string;
  userId: number;
  license: { type: "pixabay"; source: "Pixabay"; sourceURL: string; creator: string; creatorURL: string; notes: string };
  tags: string[];
  themes: string[];
  label: string;
  alt: string;
  width: number;
  height: number;
  dHash: string;
  sha256: string;
  bytes: { webp: number; jpeg: number };
  storagePaths: { webp: string; jpeg: string };
  /** Site-relative hosted URL of the WebP (`/img/covers-dyn/<key>.webp`), served by coverImageV1 behind a Hosting rewrite. */
  storedURL: string;
  createdAt: Date;
  /** Tenant-aware audit: the company and admin whose pick first stored it. Never exposed to clients. */
  createdBy: { companyId: string; uid: string };
  usageCount: number;
  lastUsedAt: Date;
}

/** Read side of the dynamic library: index entries for the shortlist, and key validation for event writes. */
export interface DynamicCoverCatalog extends CoverKeySource {
  /** Active dynamic covers as index entries (newest first, bounded), cached in memory with a TTL. */
  entries(): Promise<CoverIndexEntry[]>;
  /** Active dynamic docs with a dHash, for near-duplicate checks (same cache). */
  hashes(): Promise<Array<{ key: string; dHash: string }>>;
  get(key: string): Promise<DynamicCoverDoc | null>;
}

/** Write side: stores the renditions, then creates the document (create-only; an existing key is reused). */
export interface DynamicCoverWriter {
  /** Uploads both renditions to Storage (covers-dynamic/<key>.webp, covers-dynamic/jpg/<key>.jpg). */
  putObjects(key: string, cover: ProcessedCover): Promise<{ webp: string; jpeg: string }>;
  /** Creates the document; returns false when it already exists (a concurrent pick stored it first). */
  create(doc: DynamicCoverDoc): Promise<boolean>;
  /** Increments usageCount and sets lastUsedAt (best effort). */
  touch(key: string, now: Date): Promise<void>;
}

/** Everything the live fallback needs; absent (undefined) means the fallback is off. */
export interface LiveCoverDeps {
  search: PixabaySearchPort;
  cache: CoverSearchCache;
  quota: LiveQuota;
  downloader: ImageDownloader;
  processor: ImageProcessor;
  catalog: DynamicCoverCatalog;
  writer: DynamicCoverWriter;
  config: LiveCoverConfig;
}

/** Env-driven config (aiConfig.ts): AI_COVER_LIVE_FALLBACK (default true), AI_COVER_LIVE_MIN_SCORE, ... */
export interface LiveCoverConfig {
  enabled: boolean;
  /** Fallback triggers when the best lexical score is below this (default 6: one tag matched by a title word). */
  minScore: number;
  /** ... or when fewer eligible covers than this matched the text at all (default 2). */
  minMatches: number;
  /** Pixabay candidates offered to the model (default 8). */
  maxCandidates: number;
  companyDaily: number;
  platformDaily: number;
  /** Per-instance searches per minute (default 15; pickEventCoverV1 runs at most 5 instances, so 75 < Pixabay's 100). */
  instancePerMinute: number;
}

export const DEFAULT_LIVE_COVER_CONFIG: LiveCoverConfig = {
  enabled: true, minScore: 6, minMatches: 2, maxCandidates: 8, companyDaily: 20, platformDaily: 200, instancePerMinute: 15,
};
