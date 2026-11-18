import type { CoverIndexEntry } from "./catalog.generated";
import { queryThemes, STOPWORDS, type CoverQuery } from "./shortlist";

/**
 * The Pixabay search text for an event, built so no personal data can leave the system: emails, URLs, handles, phone
 * numbers and digits are removed; words before a possessive ('s) and capitalized mid-sentence words of the description
 * (probable names) are dropped; only 3..20 letter lowercase words that are not stopwords survive (at most 4).
 */
export const MAX_QUERY_WORDS = 4;
export const MAX_QUERY_CHARS = 100;
const MIN_WORD = 3;
const MAX_WORD = 20;

/** Words of the static library (tags and label words): title words found here lead the query. */
export function coverVocabulary(index: readonly CoverIndexEntry[]): Set<string> {
  const vocabulary = new Set<string>();
  for (const entry of index) {
    for (const text of [...entry.tags, entry.label]) for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) vocabulary.add(word);
  }
  return vocabulary;
}

const TLDS = "com|org|net|io|co|app|dev|work|edu|gov|info|biz|nl|uk|de|fr|us|ai";
/** Replaces emails, URLs, handles, phone-like runs and digits with spaces (length is not preserved). */
function scrub(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(new RegExp(`\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:${TLDS})\\b(?:/\\S*)?`, "gi"), " ")
    .replace(/@\w+/g, " ")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, " ")
    .replace(/\d+/g, " ");
}

/** Lowercase candidate words in order; `dropCapitalized` also drops capitalized words that do not start a sentence. */
function words(text: string, dropCapitalized: boolean): string[] {
  const clean = scrub(text);
  const found: string[] = [];
  let previousEnd = 0;
  let first = true;
  for (const match of clean.matchAll(/(\p{L}+)(['’]\p{L}+)?/gu)) {
    const [whole, core = "", suffix = ""] = match;
    const start = match.index ?? 0;
    const sentenceStart = first || /[.!?:\n]/.test(clean.slice(previousEnd, start));
    first = false;
    previousEnd = start + whole.length;
    if (/^['’]s$/i.test(suffix)) continue;
    if (dropCapitalized && !sentenceStart && /^\p{Lu}/u.test(core)) continue;
    const word = core.toLowerCase();
    if (word.length >= MIN_WORD && word.length <= MAX_WORD && !STOPWORDS.has(word)) found.push(word);
  }
  return found;
}

/** `{ q, words }` for the Pixabay API (`words` joined by single spaces is the normalized cache key), or null when nothing usable. */
export function buildPixabayQuery(query: CoverQuery, vocabulary: ReadonlySet<string>): { q: string; words: string[] } | null {
  const title = [...new Set(words(query.title, false))];
  const counts = new Map<string, number>();
  for (const word of words(query.description ?? "", true)) if (vocabulary.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const description = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
  let chosen = [...new Set([...title.filter(w => vocabulary.has(w)), ...title, ...description])].slice(0, MAX_QUERY_WORDS);
  if (chosen.length === 0) {
    const theme = queryThemes(query)[0];
    if (!theme) return null;
    chosen = [theme];
  }
  return { q: chosen.join(" ").slice(0, MAX_QUERY_CHARS), words: chosen };
}
