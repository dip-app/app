import { isDynamicCoverKey, dynamicStoragePaths } from "../domain/dynamicCovers";
import type { BucketLike } from "./firestoreTypes";

/** Reads a Storage object by path; null when it does not exist. */
export interface CoverObjectReader { read(objectPath: string): Promise<{ bytes: Buffer; contentType: string } | null> }

export interface CoverImageResponse { status: number; headers: Record<string, string>; body: Buffer | null }

const WEBP_PATH = /^\/img\/covers-dyn\/(pixabay-[1-9][0-9]{0,11})\.webp$/;
const JPEG_PATH = /^\/img\/covers-dyn\/jpg\/(pixabay-[1-9][0-9]{0,11})\.jpg$/;
const IMMUTABLE = "public, max-age=604800, s-maxage=2592000, immutable";

const plain = (status: number, text: string, extra: Record<string, string> = {}, withBody = true): CoverImageResponse => ({
  status,
  headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  body: withBody ? Buffer.from(text) : null,
});

/** Request handler for coverImageV1 (GET and HEAD only; strict path patterns; nothing else is ever read from Storage). */
export async function handleCoverImage(method: string, path: string, reader: CoverObjectReader): Promise<CoverImageResponse> {
  if (method !== "GET" && method !== "HEAD") return plain(405, "Method not allowed", { Allow: "GET, HEAD" });
  const head = method === "HEAD";
  let key: string | undefined;
  let kind: "webp" | "jpeg" | null = null;
  const webp = WEBP_PATH.exec(path);
  const jpeg = JPEG_PATH.exec(path);
  if (webp) { key = webp[1]; kind = "webp"; } else if (jpeg) { key = jpeg[1]; kind = "jpeg"; }
  if (!kind || !isDynamicCoverKey(key)) return plain(404, "Not found", {}, !head);

  const object = await reader.read(dynamicStoragePaths(key)[kind]);
  if (!object) return plain(404, "Not found", {}, !head);
  return {
    status: 200,
    headers: {
      "Content-Type": kind === "webp" ? "image/webp" : "image/jpeg",
      "Content-Length": String(object.bytes.length),
      "Cache-Control": IMMUTABLE,
      "X-Content-Type-Options": "nosniff",
    },
    body: head ? null : object.bytes,
  };
}

/** CoverObjectReader over the default Storage bucket (Admin SDK). */
export class StorageCoverReader implements CoverObjectReader {
  constructor(private readonly bucket: BucketLike) {}
  async read(objectPath: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const [bytes] = await this.bucket.file(objectPath).download();
      return { bytes, contentType: objectPath.endsWith(".webp") ? "image/webp" : "image/jpeg" };
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 404) return null;
      throw error;
    }
  }
}
