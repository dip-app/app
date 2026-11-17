/**
 * Google profile photo URLs (the Firebase Auth token's `picture` claim).
 *
 * The claim is only ever stored after strict validation: https, a Google image host, no credentials, port, query or
 * fragment, at most 512 characters. The Google size suffix (`=s96-c`, or a `/s96-c/` path segment on older URLs) is
 * stripped so the stored value is the size-less base form; each client appends the size it wants (`=s96-c`).
 * The URL is personal data: never log it.
 */
export const MAX_PHOTO_URL_LENGTH = 512;
const GOOGLE_IMAGE_HOST_SUFFIXES = [".googleusercontent.com", ".ggpht.com"] as const;
const SIZE_SUFFIX = /=[swh]\d+(?:-[a-z0-9]+)*$/i;
const SIZE_SEGMENT = /\/[swh]\d+(?:-[a-z0-9]+)*(?=\/[^/]+$)/i;

/** The base-form photo URL, or null when the value is missing or not an acceptable Google image URL. */
export function normalizeGooglePhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PHOTO_URL_LENGTH) return null;
  if (/[\u0000- \u007f]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  const host = url.hostname.toLowerCase();
  if (!GOOGLE_IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)) return null;
  const path = url.pathname.replace(SIZE_SUFFIX, "").replace(SIZE_SEGMENT, "");
  if (path === "" || path === "/") return null;
  const base = `https://${host}${path}`;
  return base.length <= MAX_PHOTO_URL_LENGTH ? base : null;
}
