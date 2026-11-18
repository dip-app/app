import { COVER_INDEX, THEME_DEFAULT_KEYS, type CoverIndexEntry } from "./catalog.generated";
// Circular with dynamicCovers.ts (it needs parseCoverKey); both only call each other inside functions.
import { dynamicCoverJpegPath, isDynamicCoverKey } from "./dynamicCovers";

/**
 * Cover URL schemes (docs/contracts/callables.md, Event covers):
 * - `catalog://default/<category>`: the five legacy images (kept working everywhere);
 * - `catalog://cover/<key>`: a hosted cover library image, valid only when the key exists in the generated index.
 * The index is text only; the pictures are static files on the site, so nothing here reads a file.
 */
export const LEGACY_COVER_URLS: ReadonlySet<string> = new Set([
  "catalog://default/fitness",
  "catalog://default/outdoors",
  "catalog://default/hiking",
  "catalog://default/games",
  "catalog://default/cooking",
]);

export const COVER_THEMES = ["outdoors", "food", "arts", "games", "music", "learning", "volunteering", "wellness", "fitness"] as const;
export type CoverTheme = (typeof COVER_THEMES)[number];

/** Neutral fallback when nothing matches and no theme is known. */
export const DEFAULT_COVER_URL = "catalog://default/outdoors";

export const COVER_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const COVER_KEY_MAX = 64;
const COVER_PREFIX = "catalog://cover/";

/** Weekly-theme themes a catalog tag points at. */
const TAG_THEMES: Readonly<Record<string, CoverTheme>> = {
  "tag-outdoors": "outdoors",
  "tag-food": "food",
  "tag-cooking": "food",
  "tag-arts": "arts",
  "tag-games": "games",
  "tag-hype": "games",
  "tag-social": "games",
  "tag-music": "music",
  "tag-learning": "learning",
  "tag-volunteering": "volunteering",
  "tag-wellness": "wellness",
  "tag-chill": "wellness",
  "tag-fitness": "fitness",
  "tag-energetic": "fitness",
};

/** Themes for a draft's tag ids, in tag order without duplicates. */
export function themesFromTagIds(tagIds: readonly string[] | undefined): CoverTheme[] {
  const themes: CoverTheme[] = [];
  for (const id of tagIds ?? []) {
    const theme = Object.hasOwn(TAG_THEMES, id) ? TAG_THEMES[id] : undefined;
    if (theme && !themes.includes(theme)) themes.push(theme);
  }
  return themes;
}

export function isCoverTheme(value: unknown): value is CoverTheme {
  return typeof value === "string" && (COVER_THEMES as readonly string[]).includes(value);
}

interface Lookup { byKey: Map<string, CoverIndexEntry>; byURL: Map<string, CoverIndexEntry> }
const lookups = new WeakMap<readonly CoverIndexEntry[], Lookup>();

function lookupOf(index: readonly CoverIndexEntry[]): Lookup {
  let found = lookups.get(index);
  if (!found) {
    found = { byKey: new Map(index.map(entry => [entry.key, entry])), byURL: new Map(index.map(entry => [entry.url, entry])) };
    lookups.set(index, found);
  }
  return found;
}

export function coverByKey(key: string, index: readonly CoverIndexEntry[] = COVER_INDEX): CoverIndexEntry | null {
  return lookupOf(index).byKey.get(key) ?? null;
}

/** The index entry for a stored cover URL (legacy or library), or null when it is not in the index. */
export function coverByURL(url: unknown, index: readonly CoverIndexEntry[] = COVER_INDEX): CoverIndexEntry | null {
  return typeof url === "string" ? lookupOf(index).byURL.get(url) ?? null : null;
}

/** The key inside a `catalog://cover/<key>` URL when it is well formed (not checked against the index), else null. */
export function parseCoverKey(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(COVER_PREFIX)) return null;
  const key = url.slice(COVER_PREFIX.length);
  return key.length <= COVER_KEY_MAX && COVER_KEY_PATTERN.test(key) ? key : null;
}

/** Index key of any approved cover URL (library or legacy), or null. */
export function coverKeyFromURL(url: unknown, index: readonly CoverIndexEntry[] = COVER_INDEX): string | null {
  const entry = coverByURL(url, index);
  if (entry) return entry.key;
  const key = parseCoverKey(url);
  return key !== null && coverByKey(key, index) ? key : null;
}

/** True for the legacy images and for library covers whose key is in the index. */
export function isApprovedCoverURL(url: unknown, index: readonly CoverIndexEntry[] = COVER_INDEX): boolean {
  if (typeof url !== "string") return false;
  if (LEGACY_COVER_URLS.has(url)) return true;
  const key = parseCoverKey(url);
  return key !== null && coverByKey(key, index) !== null;
}

/**
 * A source of valid `catalog://cover/<key>` keys. The generated index is the first one (`indexKeySource`); a later
 * Firestore-backed list of dynamically added covers can be a second one without changing callers of `isApprovedCoverURLFrom`.
 */
export interface CoverKeySource { has(key: string): boolean | Promise<boolean> }

export function indexKeySource(index: readonly CoverIndexEntry[] = COVER_INDEX): CoverKeySource {
  return { has: key => coverByKey(key, index) !== null };
}

/** Like `isApprovedCoverURL`, but accepts a key known to any of the given sources (legacy URLs always pass). */
export async function isApprovedCoverURLFrom(url: unknown, sources: readonly CoverKeySource[]): Promise<boolean> {
  if (typeof url !== "string") return false;
  if (LEGACY_COVER_URLS.has(url)) return true;
  const key = parseCoverKey(url);
  if (key === null) return false;
  for (const source of sources) if (await source.has(key)) return true;
  return false;
}

/** Entry of a theme's default cover, or null for an unknown theme. */
export function themeDefault(theme: string | undefined, index: readonly CoverIndexEntry[] = COVER_INDEX): CoverIndexEntry | null {
  if (theme === undefined || !Object.hasOwn(THEME_DEFAULT_KEYS, theme)) return null;
  return coverByKey(THEME_DEFAULT_KEYS[theme]!, index);
}

/**
 * Hosted JPEG of a library cover (emails and the share page; Outlook has no WebP), or null when the key is unknown.
 * A dynamic Pixabay cover maps statelessly by its key (`/img/covers-dyn/jpg/<key>.jpg`, served by coverImageV1).
 */
export function coverJpegURL(origin: string, url: unknown, index: readonly CoverIndexEntry[] = COVER_INDEX): string | null {
  const key = parseCoverKey(url);
  if (isDynamicCoverKey(key)) return `${origin}${dynamicCoverJpegPath(key)}`;
  const entry = key !== null ? coverByKey(key, index) : null;
  return entry?.hasJpeg ? `${origin}/img/covers/jpg/${entry.key}.jpg` : null;
}
