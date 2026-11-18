import type { DynamicCoverDoc } from "../application/livePorts";
import type { CoverIndexEntry } from "./catalog.generated";
import { parseCoverKey } from "./coverCatalog";

/**
 * Dynamic covers: Pixabay photos stored on demand by the live fallback (docs/design/cover-library.md, Live fallback).
 * Key `pixabay-<id>`, URL `catalog://cover/pixabay-<id>`. Clients map the key to its hosted image statelessly by prefix.
 */
export const DYNAMIC_KEY_PATTERN = /^pixabay-[1-9][0-9]{0,11}$/;
const KEY_PREFIX = "pixabay-";
const COVER_PREFIX = "catalog://cover/";

export const isDynamicCoverKey = (key: unknown): key is string => typeof key === "string" && DYNAMIC_KEY_PATTERN.test(key);

/** `pixabay-<id>` for a positive integer of at most 12 digits; throws otherwise. */
export function dynamicKeyFor(id: number): string {
  const key = `${KEY_PREFIX}${id}`;
  if (!Number.isSafeInteger(id) || !DYNAMIC_KEY_PATTERN.test(key)) throw new RangeError("invalid Pixabay id");
  return key;
}

/** The Pixabay id of a dynamic key, or null when it is not one. */
export function pixabayIdOfKey(key: unknown): number | null {
  return isDynamicCoverKey(key) ? Number(key.slice(KEY_PREFIX.length)) : null;
}

export const dynamicCoverURL = (key: string): string => `${COVER_PREFIX}${key}`;

/** True for a well-formed `catalog://cover/pixabay-<id>` URL (existence is checked separately against the catalog). */
export function isDynamicCoverURL(url: unknown): boolean {
  return isDynamicCoverKey(parseCoverKey(url));
}

/** Site-relative hosted paths (Hosting rewrite `/img/covers-dyn/**` to coverImageV1). */
export const dynamicCoverImagePath = (key: string): string => `/img/covers-dyn/${key}.webp`;
export const dynamicCoverJpegPath = (key: string): string => `/img/covers-dyn/jpg/${key}.jpg`;

/** Object paths in the default Storage bucket (server-only). */
export function dynamicStoragePaths(key: string): { webp: string; jpeg: string } {
  return { webp: `covers-dynamic/${key}.webp`, jpeg: `covers-dynamic/jpg/${key}.jpg` };
}

/** The shortlist index entry of a stored dynamic cover. */
export function toIndexEntry(doc: Pick<DynamicCoverDoc, "key" | "themes" | "tags" | "label" | "alt">): CoverIndexEntry {
  return {
    key: doc.key, url: dynamicCoverURL(doc.key), kind: "photo", themes: doc.themes, tags: doc.tags, mood: [], season: ["any"],
    orientation: "landscape", label: doc.label, alt: doc.alt, hasJpeg: true,
  };
}

/** Pixabay ids already in the static library (trailing `-<digits>` of a key), so live results never duplicate them. */
export function staticPixabayIds(index: readonly CoverIndexEntry[]): Set<number> {
  const ids = new Set<number>();
  for (const { key } of index) {
    const match = /-([1-9][0-9]{0,11})$/.exec(key);
    if (match) ids.add(Number(match[1]));
  }
  return ids;
}
