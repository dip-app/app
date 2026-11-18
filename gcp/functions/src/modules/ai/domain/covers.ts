import { isApprovedCoverURL } from "../../covers/domain/coverCatalog";
import { COVER_CATEGORIES, type CoverCategory } from "./vocabulary";

/** Closest approved cover for each catalog tag. */
export const TAG_COVER: Readonly<Record<string, CoverCategory>> = {
  "tag-fitness": "fitness",
  "tag-energetic": "fitness",
  "tag-hype": "games",
  "tag-outdoors": "outdoors",
  "tag-social": "games",
  "tag-cooking": "cooking",
  "tag-games": "games",
  "tag-chill": "outdoors",
  "tag-food": "cooking",
  "tag-arts": "games",
  "tag-music": "games",
  "tag-learning": "games",
  "tag-volunteering": "outdoors",
  "tag-wellness": "hiking",
};

/** Words a model may use instead of a cover category; mapped to the closest approved picture. */
export const COVER_ALIASES: Readonly<Record<string, CoverCategory>> = {
  food: "cooking", meal: "cooking", lunch: "cooking", baking: "cooking", tasting: "cooking", picnic: "cooking",
  sport: "fitness", sports: "fitness", exercise: "fitness", yoga: "fitness", movement: "fitness",
  outdoor: "outdoors", park: "outdoors", water: "outdoors", garden: "outdoors",
  hike: "hiking", walk: "hiking", walking: "hiking", nature: "hiking", trail: "hiking",
  game: "games", trivia: "games", puzzle: "games", puzzles: "games",
};
// Catalog tag words (wellness, social, music, ...) are mapped through TAG_COVER, so they are not repeated here.

/** A model's cover word as an approved category: the category itself, a known alias, or a catalog tag's cover. */
export function normalizeCoverCategory(raw: unknown): CoverCategory | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/^tag-/, "");
  if ((COVER_CATEGORIES as readonly string[]).includes(key)) return key as CoverCategory;
  if (Object.hasOwn(COVER_ALIASES, key)) return COVER_ALIASES[key]!;
  const tag = `tag-${key}`;
  return Object.hasOwn(TAG_COVER, tag) ? TAG_COVER[tag]! : null;
}

const FALLBACK = "catalog://default/games";

/** Cover URL for a draft: the model's category when valid, else the first mapped tag, else a neutral default. */
export function coverURLFor(category: unknown, tagIds: readonly string[]): string {
  const normalized = normalizeCoverCategory(category);
  if (normalized) {
    const url = `catalog://default/${normalized}`;
    if (isApprovedCoverURL(url)) return url;
  }
  for (const id of tagIds) {
    const mapped = Object.hasOwn(TAG_COVER, id) ? TAG_COVER[id] : undefined;
    if (mapped) return `catalog://default/${mapped}`;
  }
  return FALLBACK;
}
