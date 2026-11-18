// @i18n-migrated
import { t } from "./i18n";
import { COVER_LIBRARY, type CoverEntry, coverByURL, coverImage } from "./covers";
// Event covers come from the cover library (lib/covers.ts, manifest in public/img/covers). COVERS and coverFor stay
// for older callers; `id` is the key, or the category for the five legacy `catalog://default/*` photos.
export interface CoverOption {
  id: string;
  label: string;
  url: string;
  image: string;
}

const option = (c: CoverEntry): CoverOption => ({ id: c.key.replace(/^default-/, ""), label: c.label, url: c.url, image: coverImage(c) });

export const COVERS: CoverOption[] = COVER_LIBRARY.map(option);

export function coverFor(url: string): CoverOption | undefined {
  const entry = coverByURL(url);
  return entry ? option(entry) : undefined;
}

/** Mirrors tags/{tagId}: events store IDs, never labels. The portal reads the same catalog the app uses. */
export interface Tag { id: string; name: string; /** Optional one-line description on the tag document; Dipbot cards show it instead of the built-in blurb. */ description?: string }

export const TAGS: Tag[] = [
  { id: "tag-fitness", name: "Fitness" }, { id: "tag-energetic", name: "Energetic" }, { id: "tag-hype", name: "Hype" },
  { id: "tag-outdoors", name: "Outdoors" }, { id: "tag-social", name: "Social" }, { id: "tag-cooking", name: "Cooking" },
  { id: "tag-games", name: "Games" }, { id: "tag-chill", name: "Chill" },
  { id: "tag-food", name: "Food & Drink" }, { id: "tag-arts", name: "Arts & Crafts" }, { id: "tag-music", name: "Music" },
  { id: "tag-learning", name: "Learning" }, { id: "tag-volunteering", name: "Volunteering" }, { id: "tag-wellness", name: "Wellness" },
];

export const TAG_IDS = TAGS.map((tag) => tag.id);

/** Shown for a tag ID the catalog doesn't know. Raw IDs are opaque Firestore IDs and never go on screen. */
export const UNKNOWN_TAG_NAME = "Unknown tag";
/** The same fallback in the current language; prefer this at render time. */
export const unknownTagName = (): string => t("overview.tag.unknown");

/** Name from the bundled (mock) catalog only. Live screens resolve through `useTagCatalog`, which reads `tags/{tagId}`. */
export function tagName(id: string): string {
  return TAGS.find((tag) => tag.id === id)?.name ?? unknownTagName();
}

/**
 * Mock only, for design review: `?tags=opaque` serves the catalog with opaque 20-character IDs like production's,
 * so a screen that shows an ID instead of a name is visible in the preview.
 */
export const opaqueTagsPreview = (): boolean => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tags") === "opaque";

export function opaqueTagId(id: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let seed = 2166136261;
  for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < 20; i += 1) {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + i) >>> 0;
    out += alphabet[seed % alphabet.length];
  }
  return out;
}

/** Maps a bundled tag ID to the preview's opaque one when `?tags=opaque` is on; other IDs pass through. */
export const previewTagId = (id: string): string => (opaqueTagsPreview() && TAG_IDS.includes(id) ? opaqueTagId(id) : id);

/** The reverse of `previewTagId`, for requests the mock receives. */
export const bundledTagId = (id: string): string => (opaqueTagsPreview() ? TAG_IDS.find((own) => opaqueTagId(own) === id) ?? id : id);

/** Production-like tag names for `?tags=live` (mock only): real catalogs hold names that match none of our theme keys. */
export const LIVE_TAG_NAMES = [
  "Fitness", "Water Sport", "Bonding", "Energetic", "Hype", "Weekly Activity", "Cooking", "Outdoors", "Carpentry", "Social",
  "Food", "Games", "Volunteering", "Creative", "Pottery", "Trivia Night", "Rooftop Happy Hour",
];
export const liveTagsPreview = (): boolean => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tags") === "live";
