import { PixabayUnavailableError } from "../application/livePorts";

/**
 * Pure checks for downloading Pixabay images (SSRF and content safety). The downloader adds the network side:
 * redirect "manual", timeout, Content-Length and streamed size cap.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** The parsed URL when it is an https Pixabay image URL, else null: exact host, no credentials, no port, expected path. */
function parseAllowed(url: string): URL | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return null;
  if (parsed.hostname === "pixabay.com") return parsed.pathname.startsWith("/get/") ? parsed : null;
  if (parsed.hostname === "cdn.pixabay.com") return parsed.pathname.startsWith("/photo/") ? parsed : null;
  return null;
}

export const isAllowedPixabayImageURL = (url: string): boolean => parseAllowed(url) !== null;

/** Throws PixabayUnavailableError("url_rejected") (never echoing the URL) unless the URL is an allowed Pixabay image URL. */
export function assertPixabayImageURL(url: string): URL {
  const parsed = parseAllowed(url);
  if (!parsed) throw new PixabayUnavailableError("url_rejected");
  return parsed;
}

/** The image type by magic bytes (JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP RIFF....WEBP), or null. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const at = (offset: number, ...expected: number[]) => expected.every((b, i) => bytes[offset + i] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** A Content-Type header without parameters, lowercased, when it is an accepted image type; else null. */
export function normalizeContentType(header: string | null): ImageType | null {
  const type = (header ?? "").split(";")[0]!.trim().toLowerCase();
  return type === "image/jpeg" || type === "image/png" || type === "image/webp" ? type : null;
}

export const isAllowedImageContentType = (header: string | null): boolean => normalizeContentType(header) !== null;
