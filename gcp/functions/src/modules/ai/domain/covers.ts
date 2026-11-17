import { APPROVED_COVER_URLS } from "../../organizer/domain/eventDraft";
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

const FALLBACK = "catalog://default/games";

/** Cover URL for a draft: the model's category when valid, else the first mapped tag, else a neutral default. */
export function coverURLFor(category: unknown, tagIds: readonly string[]): string {
  if (typeof category === "string" && (COVER_CATEGORIES as readonly string[]).includes(category)) {
    const url = `catalog://default/${category}`;
    if (APPROVED_COVER_URLS.has(url)) return url;
  }
  for (const id of tagIds) {
    const mapped = Object.hasOwn(TAG_COVER, id) ? TAG_COVER[id] : undefined;
    if (mapped) return `catalog://default/${mapped}`;
  }
  return FALLBACK;
}
