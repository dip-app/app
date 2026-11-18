// Importable Pixabay client and candidate helpers for the cover library (no CLI, no filesystem layout).
// Used by fetch-pixabay.ts today; written so a server-side runtime fallback can reuse it (inject `fetchImpl`, `now`, `wait`).
// Pixabay API: GET https://pixabay.com/api/ ; 100 requests per 60 s per key; 429 means wait X-RateLimit-Reset seconds.
// Never log the key or a full request URL.
import { sharp } from "./lib";

export interface PixabayHit {
  id: number; pageURL: string; tags: string; user: string; user_id: number;
  imageWidth: number; imageHeight: number; largeImageURL: string; fullHDURL?: string;
  likes: number; downloads: number; views: number;
}

export interface PixabaySearchOptions {
  q: string;
  editorsChoice?: boolean;
  minWidth?: number;
  perPage?: number;
  order?: "popular" | "latest";
  category?: string;
}

/** Tags that rule a candidate out: minors, gore, adult content, obvious logos and signage. */
export const BLOCKED_TAGS = [
  "child", "children", "kid", "kids", "baby", "babies", "toddler", "infant", "boy", "girl", "teen", "teenager", "schoolgirl", "schoolboy", "student",
  "nude", "naked", "bikini", "lingerie", "erotic", "sexy", "blood", "gun", "weapon", "gore", "cigarette", "smoking", "smoke", "drug", "cannabis",
  "logo", "brand", "advertising", "poster", "billboard", "sign", "text", "typography", "watermark",
];
const FILLER = new Set(["friends", "friend", "group", "people", "team", "together", "of", "a", "the", "with", "by", "in", "on", "at"]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sliding-window limiter: at most `limit` calls per `windowMs`, tracked locally and corrected by the server headers. */
export class RateLimiter {
  private stamps: number[] = [];
  private blockedUntil = 0;
  constructor(private limit = 90, private windowMs = 60_000, private now: () => number = Date.now, private wait: (ms: number) => Promise<void> = sleep) {}
  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
      const hold = Math.max(this.blockedUntil - t, this.stamps.length >= this.limit ? this.stamps[0] + this.windowMs - t : 0);
      if (hold <= 0) { this.stamps.push(t); return; }
      await this.wait(hold + 50);
    }
  }
  /** Called after a response with X-RateLimit-Remaining and X-RateLimit-Reset (seconds until reset). */
  observe(remaining: number, resetSeconds: number): void {
    if (Number.isFinite(remaining) && remaining <= 1 && Number.isFinite(resetSeconds)) this.blockedUntil = this.now() + resetSeconds * 1000 + 500;
  }
  penalize(resetSeconds: number): void { this.blockedUntil = this.now() + Math.max(1, resetSeconds) * 1000 + 500; }
}

export class PixabayClient {
  constructor(
    private apiKey: string,
    private limiter: RateLimiter = new RateLimiter(),
    private fetchImpl: typeof fetch = fetch,
    private maxAttempts = 5,
  ) {}

  /** Search photos: horizontal, safesearch on. Retries on 429 after the advertised reset. */
  async search(opts: PixabaySearchOptions): Promise<PixabayHit[]> {
    const url = new URL("https://pixabay.com/api/");
    url.searchParams.set("q", opts.q.slice(0, 100));
    url.searchParams.set("image_type", "photo");
    url.searchParams.set("orientation", "horizontal");
    url.searchParams.set("min_width", String(opts.minWidth ?? 1600));
    url.searchParams.set("safesearch", "true");
    url.searchParams.set("order", opts.order ?? "popular");
    url.searchParams.set("per_page", String(opts.perPage ?? 40));
    if (opts.editorsChoice) url.searchParams.set("editors_choice", "true");
    if (opts.category) url.searchParams.set("category", opts.category);
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      await this.limiter.acquire();
      url.searchParams.set("key", this.apiKey);
      let res: Response;
      try {
        res = await this.fetchImpl(url);
      } catch {
        await sleep(5000 * (attempt + 1)); // transient network error (never include the URL: it carries the key)
        continue;
      }
      this.limiter.observe(Number(res.headers.get("x-ratelimit-remaining")), Number(res.headers.get("x-ratelimit-reset")));
      if (res.status === 429) { this.limiter.penalize(Number(res.headers.get("x-ratelimit-reset")) || 60); continue; }
      if (!res.ok) throw new Error(`Pixabay returned ${res.status} for "${opts.q}"`);
      return ((await res.json()) as { hits: PixabayHit[] }).hits;
    }
    throw new Error(`Pixabay kept rate limiting "${opts.q}"`);
  }

  /** Download an image once (largeImageURL or fullHDURL). Image URLs are not rate limited, never store them for hotlinking. */
  async download(hit: PixabayHit): Promise<Buffer> {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await this.fetchImpl(hit.fullHDURL ?? hit.largeImageURL); } catch { await sleep(3000 * (attempt + 1)); }
    }
    if (!res) throw new Error(`Pixabay image download failed (network) for id ${hit.id}`);
    if (!res.ok) throw new Error(`Pixabay image download failed (${res.status}) for id ${hit.id}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

/** Query variants for a plan query: full text, filler words removed, then the first and last two content words. */
export function queryVariants(query: string): string[] {
  const base = query.toLowerCase();
  const content = base.split(/\s+/).filter((w) => w && !FILLER.has(w));
  return [...new Set([base, content.join(" "), content.slice(0, 2).join(" "), content.slice(-2).join(" ")].filter((v) => v.length >= 3))];
}

export function popularity(h: PixabayHit): number {
  return Math.log10(1 + h.likes * 5 + h.downloads / 20 + h.views / 500);
}

export function hitTags(h: PixabayHit): string[] {
  return h.tags.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean);
}

export function acceptable(h: PixabayHit, minWidth: number): boolean {
  const ratio = h.imageWidth / h.imageHeight;
  if (h.imageWidth < minWidth || ratio < 1.5 || ratio > 2.1) return false;
  const words = new Set(hitTags(h).flatMap((t) => t.split(/[\s-]+/)));
  return !BLOCKED_TAGS.some((b) => words.has(b));
}

/** 64-bit difference hash of a 9x8 greyscale thumbnail. */
export async function dHash(buf: Buffer): Promise<bigint> {
  const px = await sharp(buf).rotate().resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] < px[y * 9 + x + 1] ? 1n : 0n);
  return bits;
}
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b; let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export function pixabayLicense(hit: PixabayHit) {
  const notes = `Pixabay Content License (free commercial use, no attribution required); pixabay id ${hit.id}; tags: ${hit.tags}`;
  return {
    type: "pixabay", source: "Pixabay", sourceURL: hit.pageURL, creator: hit.user,
    creatorURL: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
    notes: notes.length <= 300 ? notes : notes.slice(0, 299) + "…",
  };
}

const stem4 = (w: string) => w.replace(/(ing|es|s)$/, "").slice(0, 6);

/** Share (0..1) of the query's content words that appear, lightly stemmed, in the hit's tags. */
export function relevance(h: PixabayHit, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w && !FILLER.has(w)).map(stem4);
  if (!words.length) return 0;
  const tagWords = new Set(hitTags(h).flatMap((t) => t.split(/[\s-]+/)).map(stem4));
  return words.filter((w) => tagWords.has(w)).length / words.length;
}
