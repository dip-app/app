import type { PixabayHit } from "../application/livePorts";
import { COVER_INDEX, type CoverIndexEntry } from "./catalog.generated";
import { COVER_THEMES, isCoverTheme } from "./coverCatalog";

/**
 * Pixabay candidate rules shared by the offline cover tooling (scripts/covers) and the live fallback: one source for
 * what is acceptable, how relevant a hit is and which license text it gets. Pure; no network, no filesystem.
 */

/** The fields the rules read. Cached live hits carry no counters (popularity is then 0); script hits carry all of them. */
export type RuleHit = Pick<PixabayHit, "id" | "pageURL" | "tags" | "user" | "user_id" | "imageWidth" | "imageHeight"> & {
  likes?: number; downloads?: number; views?: number;
};

/** Tags that rule a candidate out: minors, gore, adult content, obvious logos and signage. */
export const BLOCKED_TAGS = [
  "child", "children", "kid", "kids", "baby", "babies", "toddler", "infant", "boy", "girl", "teen", "teenager", "schoolgirl", "schoolboy", "student",
  "nude", "naked", "bikini", "lingerie", "erotic", "sexy", "blood", "gun", "weapon", "gore", "cigarette", "smoking", "smoke", "drug", "cannabis",
  "logo", "brand", "advertising", "poster", "billboard", "sign", "text", "typography", "watermark",
];
const FILLER = new Set(["friends", "friend", "group", "people", "team", "together", "of", "a", "the", "with", "by", "in", "on", "at"]);
const BLOCKED = new Set(BLOCKED_TAGS);

/** Lowercased, trimmed tags of a hit in the order Pixabay returned them. */
export function hitTags(h: Pick<RuleHit, "tags">): string[] {
  return h.tags.toLowerCase().split(",").map(t => t.trim()).filter(Boolean);
}

const tagWords = (tag: string) => tag.split(/[\s-]+/);
const isBlockedTag = (tag: string) => tagWords(tag).some(word => BLOCKED.has(word));

/** Wide enough (>= minWidth), landscape ratio 1.5..2.1 and no blocked word in any tag. */
export function acceptable(h: RuleHit, minWidth = 1280): boolean {
  const ratio = h.imageWidth / h.imageHeight;
  if (h.imageWidth < minWidth || !(ratio >= 1.5 && ratio <= 2.1)) return false;
  return !hitTags(h).some(isBlockedTag);
}

export function popularity(h: RuleHit): number {
  return Math.log10(1 + (h.likes ?? 0) * 5 + (h.downloads ?? 0) / 20 + (h.views ?? 0) / 500);
}

const stem4 = (w: string) => w.replace(/(ing|es|s)$/, "").slice(0, 6);

/** Share (0..1) of the content words that appear, lightly stemmed, in the hit's tags. */
export function relevance(h: Pick<RuleHit, "tags">, words: readonly string[]): number {
  const wanted = words.map(w => w.toLowerCase()).filter(w => w && !FILLER.has(w)).map(stem4);
  if (!wanted.length) return 0;
  const have = new Set(hitTags(h).flatMap(tagWords).map(stem4));
  return wanted.filter(w => have.has(w)).length / wanted.length;
}

export function pixabayLicense(hit: RuleHit) {
  const notes = `Pixabay Content License (free commercial use, no attribution required); pixabay id ${hit.id}; tags: ${hit.tags}`;
  return {
    type: "pixabay" as const, source: "Pixabay" as const, sourceURL: hit.pageURL, creator: hit.user,
    creatorURL: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
    notes: notes.length <= 300 ? notes : notes.slice(0, 299) + "…",
  };
}

const MAX_TAGS = 12;
const MAX_LABEL = 40;
const MAX_ALT = 160;
const tagThemes = new WeakMap<readonly CoverIndexEntry[], Map<string, Map<string, number>>>();

/** tag -> theme -> count over the static index (a tag's themes by majority). */
function themeVotes(index: readonly CoverIndexEntry[]): Map<string, Map<string, number>> {
  let votes = tagThemes.get(index);
  if (!votes) {
    votes = new Map();
    for (const entry of index) {
      for (const tag of entry.tags) {
        const perTheme = votes.get(tag) ?? new Map<string, number>();
        for (const theme of entry.themes) perTheme.set(theme, (perTheme.get(theme) ?? 0) + 1);
        votes.set(tag, perTheme);
      }
    }
    tagThemes.set(index, votes);
  }
  return votes;
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Searchable fields of a dynamic cover document derived from a hit: tags (<= 12, blocked removed), label (<= 40), alt (<= 160), themes (1..3). */
export function docFieldsFromHit(
  hit: Pick<RuleHit, "tags">, queryThemes: readonly string[] = [], index: readonly CoverIndexEntry[] = COVER_INDEX,
): { tags: string[]; label: string; alt: string; themes: string[] } {
  const tags = [...new Set(hitTags(hit).filter(tag => !isBlockedTag(tag)))].slice(0, MAX_TAGS);

  const votes = themeVotes(index);
  const counts = new Map<string, number>();
  for (const tag of tags) for (const [theme, n] of votes.get(tag) ?? []) counts.set(theme, (counts.get(theme) ?? 0) + n);
  let themes: string[] = COVER_THEMES.filter(theme => counts.has(theme))
    .sort((a, b) => counts.get(b)! - counts.get(a)! || COVER_THEMES.indexOf(a) - COVER_THEMES.indexOf(b)).slice(0, 3);
  if (themes.length === 0) themes = [...new Set(queryThemes.filter(isCoverTheme))].slice(0, 3);
  if (themes.length === 0) themes = ["outdoors"];

  let head = tags.slice(0, 3);
  while (head.length > 1 && head.join(", ").length > MAX_LABEL) head = head.slice(0, -1);
  const label = head.length ? sentenceCase(head.join(", ")).slice(0, MAX_LABEL).trimEnd() : "Photo";
  const alt = (tags.length ? `Photo of ${list(tags.slice(0, 3))}` : "Photo").slice(0, MAX_ALT);
  return { tags, label, alt, themes };
}
