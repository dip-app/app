import { z } from "zod";
import { PixabayRateLimitedError, PixabayUnavailableError, type PixabayHit, type PixabaySearchPort } from "../application/livePorts";
import { assertPixabayImageURL } from "../domain/imageGuards";

const API_URL = "https://pixabay.com/api/";
const SEARCH_TIMEOUT_MS = 5_000;
const MAX_Q = 100;

const hitSchema = z.object({
  id: z.number().int().positive(),
  pageURL: z.string().min(1).max(500),
  tags: z.string().max(500),
  user: z.string().max(200),
  user_id: z.number().int().nonnegative(),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  largeImageURL: z.string().min(1),
  webformatURL: z.string().min(1),
  previewURL: z.string().optional(),
});
const responseSchema = z.object({ hits: z.array(z.unknown()) });

export interface PixabayHttpClientOptions {
  /** Read lazily on every call (secret parameter); never logged or put into errors. */
  apiKey: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Per-request timeout (default 5 s). */
  timeoutMs?: number;
}

/**
 * Pixabay search over HTTP: one attempt, timeout, no redirects. A 429 (or an exhausted quota header) blocks this instance
 * until the advertised reset, so later calls fail fast instead of burning the shared 100 requests per minute.
 */
export class PixabayHttpClient implements PixabaySearchPort {
  private blockedUntil = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly options: PixabayHttpClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  }

  async search(query: string, signal?: AbortSignal): Promise<PixabayHit[]> {
    const q = query.trim().slice(0, MAX_Q);
    if (!q) throw new PixabayUnavailableError("empty_query");
    const t = this.now();
    if (t < this.blockedUntil) throw new PixabayRateLimitedError(Math.ceil((this.blockedUntil - t) / 1000));
    let key: string;
    try { key = this.options.apiKey(); } catch { throw new PixabayUnavailableError("no_api_key"); }
    if (!key) throw new PixabayUnavailableError("no_api_key");

    const url = new URL(API_URL);
    url.searchParams.set("key", key);
    url.searchParams.set("q", q);
    url.searchParams.set("image_type", "photo");
    url.searchParams.set("orientation", "horizontal");
    url.searchParams.set("min_width", "1280");
    url.searchParams.set("safesearch", "true");
    url.searchParams.set("order", "popular");
    url.searchParams.set("per_page", "30");
    url.searchParams.set("lang", "en");

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const why = (fallback: string) => (signal?.aborted ? "aborted" : timeout.aborted ? "timeout" : fallback);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method: "GET", redirect: "error", signal: combined, headers: { accept: "application/json" } });
    } catch {
      // Never include the error or URL: both can carry the key.
      throw new PixabayUnavailableError(why("network"));
    }

    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429) {
      const seconds = Number.isFinite(reset) && reset > 0 ? Math.min(reset, 120) : 60;
      this.blockedUntil = this.now() + seconds * 1000;
      void res.body?.cancel().catch(() => undefined);
      throw new PixabayRateLimitedError(seconds);
    }
    if (remaining !== null && Number(remaining) <= 0 && Number.isFinite(reset) && reset > 0) this.blockedUntil = this.now() + Math.min(reset, 120) * 1000;
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      throw new PixabayUnavailableError(`http_${res.status}`);
    }

    let body: unknown;
    try { body = await res.json(); } catch { throw new PixabayUnavailableError(why("bad_json")); }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new PixabayUnavailableError("bad_response");
    const hits: PixabayHit[] = [];
    for (const raw of parsed.data.hits) {
      const hit = hitSchema.safeParse(raw);
      if (!hit.success) continue;
      const h = hit.data;
      try {
        assertPixabayImageURL(h.largeImageURL);
        assertPixabayImageURL(h.webformatURL);
      } catch { continue; }
      const out: PixabayHit = {
        id: h.id, pageURL: h.pageURL, tags: h.tags, user: h.user, user_id: h.user_id,
        imageWidth: h.imageWidth, imageHeight: h.imageHeight, largeImageURL: h.largeImageURL, webformatURL: h.webformatURL,
      };
      if (h.previewURL !== undefined) {
        try { assertPixabayImageURL(h.previewURL); out.previewURL = h.previewURL; } catch { /* drop an unsafe preview URL */ }
      }
      hits.push(out);
    }
    return hits;
  }
}
