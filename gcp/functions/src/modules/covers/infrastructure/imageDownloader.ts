import { PixabayUnavailableError, type DownloadedImage, type ImageDownloader } from "../application/livePorts";
import { assertPixabayImageURL, MAX_IMAGE_BYTES, normalizeContentType, sniffImageType } from "../domain/imageGuards";

const DOWNLOAD_TIMEOUT_MS = 10_000;

export interface PixabayImageDownloaderOptions { fetch?: typeof fetch; timeoutMs?: number }

/** SSRF-safe download: guarded URL, no redirects, timeout, declared and streamed size caps, magic bytes must match the content type. */
export class PixabayImageDownloader implements ImageDownloader {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(options: PixabayImageDownloaderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  }

  async download(url: string, signal?: AbortSignal): Promise<DownloadedImage> {
    const parsed = assertPixabayImageURL(url);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const failure = (fallback: string) => new PixabayUnavailableError(signal?.aborted ? "aborted" : timeout.aborted ? "timeout" : fallback);
    let res: Response;
    try {
      res = await this.fetchImpl(parsed.toString(), { method: "GET", redirect: "manual", signal: combined });
    } catch {
      throw failure("network");
    }
    const cancel = () => { void res.body?.cancel().catch(() => undefined); };
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) { cancel(); throw new PixabayUnavailableError("redirect"); }
    if (!res.ok) { cancel(); throw new PixabayUnavailableError(`http_${res.status}`); }
    const contentType = normalizeContentType(res.headers.get("content-type"));
    if (!contentType) { cancel(); throw new PixabayUnavailableError("content_type"); }
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > MAX_IMAGE_BYTES) { cancel(); throw new PixabayUnavailableError("too_large"); }
    if (!res.body) throw new PixabayUnavailableError("empty");

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          void reader.cancel().catch(() => undefined);
          throw new PixabayUnavailableError("too_large");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof PixabayUnavailableError) throw error;
      throw failure("network");
    }
    if (total === 0) throw new PixabayUnavailableError("empty");
    const bytes = Buffer.concat(chunks, total);
    if (sniffImageType(bytes) !== contentType) throw new PixabayUnavailableError("magic_mismatch");
    return { bytes, contentType };
  }
}
