import { COVER_INDEX, type CoverIndexEntry } from "./catalog.generated";
import { coverByKey, coverKeyFromURL, themeDefault, themesFromTagIds, type CoverTheme } from "./coverCatalog";

/**
 * Deterministic lexical cover matching (no model). Tokens come from the title (weight 2) and the first
 * DESCRIPTION_CHARS of the description (weight 1), lowercased, stripped of punctuation and lightly stemmed, with
 * stopwords removed. Score per cover: +3 for each tag whose words all appear, +1 for each label or alt word that
 * appears (each scaled by the weight of the matching token), +2 per matching theme, -1 for an illustration, -4 when
 * the cover is excluded (already used by another draft). Ties break by key ascending, so the result is reproducible.
 */
export const DESCRIPTION_CHARS = 600;
/** Defaults of the cover pick limits (env AI_COVER_MAX_CANDIDATES and AI_COVER_MAX_OPTIONS, see aiConfig.ts). */
export const DEFAULT_MAX_CANDIDATES = 60;
export const DEFAULT_MAX_OPTIONS_PER_CALL = 60;

/** Limits of the cover pick: covers offered to the model, and options per single Choice call (more means two calls). */
export interface CoverPickLimits { maxCandidates: number; maxOptionsPerCall: number }
/** Share of the candidate budget filled by the best-ranked covers before diverse picks and the tail. */
const HEAD_SHARE = 0.5;

/** Hard exclusions only: portrait or square covers and covers flagged `autoPick: false` are never offered to a model or picked by text. */
export function isEligible(entry: CoverIndexEntry & { orientation?: string }): boolean {
  return entry.autoPick !== false && (entry.orientation === undefined || entry.orientation === "landscape");
}
const TAG_SCORE = 3;
const WORD_SCORE = 1;
const THEME_SCORE = 2;
const ILLUSTRATION_PENALTY = 1;
const EXCLUDED_PENALTY = 4;

const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "come", "do", "for", "from", "get", "has", "have", "how", "in", "into", "is", "it", "its",
  "join", "let", "make", "more", "new", "of", "on", "or", "our", "out", "so", "that", "the", "their", "them", "then", "there", "this", "to", "together",
  "up", "us", "we", "will", "with", "you", "your", "all", "any", "each", "every", "some", "other", "just", "bring", "day", "time", "week", "team",
  "event", "everyone", "anyone", "enjoy", "fun", "after", "before", "work", "no", "not", "one", "two",
]);

/** Lowercase, trailing "ing", "es" or "s" dropped when at least four letters remain. */
export function stem(word: string): string {
  for (const suffix of ["ing", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Stemmed tokens of a text in order (duplicates kept), stopwords and single characters removed. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    tokens.push(stem(raw));
  }
  return tokens;
}

export interface CoverQuery {
  title: string;
  description?: string;
  tagIds?: readonly string[];
  /** Explicit theme; added to the themes implied by the tag ids. */
  theme?: CoverTheme;
  /** Cover URLs or keys already used elsewhere in the batch (scored down, not removed). */
  exclude?: readonly string[];
}

/** `matched`: at least one tag or label/alt word matched the text (a theme match alone does not count). */
export interface ScoredCover { entry: CoverIndexEntry; score: number; matched: boolean }

/** Token weights of a query: title tokens count 2, description tokens 1, summed. */
function weights(query: CoverQuery): Map<string, number> {
  const found = new Map<string, number>();
  for (const token of tokenize(query.title)) found.set(token, (found.get(token) ?? 0) + 2);
  for (const token of tokenize((query.description ?? "").slice(0, DESCRIPTION_CHARS))) found.set(token, (found.get(token) ?? 0) + 1);
  return found;
}

function excludedKeys(query: CoverQuery, index: readonly CoverIndexEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const item of query.exclude ?? []) {
    const key = coverKeyFromURL(item, index) ?? (coverByKey(item, index) ? item : null);
    if (key) keys.add(key);
  }
  return keys;
}

export function queryThemes(query: CoverQuery): CoverTheme[] {
  const themes = themesFromTagIds(query.tagIds);
  if (query.theme && !themes.includes(query.theme)) themes.unshift(query.theme);
  return themes;
}

/** Every cover scored and ordered best first (score descending, then key ascending). */
export function rankCovers(query: CoverQuery, index: readonly CoverIndexEntry[] = COVER_INDEX): ScoredCover[] {
  const weight = weights(query);
  const themes = queryThemes(query);
  const excluded = excludedKeys(query, index);
  const scored = index.filter(isEligible).map(entry => {
    let score = 0;
    let matched = false;
    for (const tag of entry.tags) {
      const words = tokenize(tag);
      if (words.length > 0 && words.every(word => weight.has(word))) {
        score += TAG_SCORE * Math.min(...words.map(word => weight.get(word)!));
        matched = true;
      }
    }
    const words = new Set([...tokenize(entry.label), ...tokenize(entry.alt)]);
    for (const word of words) {
      if (!weight.has(word)) continue;
      score += WORD_SCORE * weight.get(word)!;
      matched = true;
    }
    for (const theme of themes) if (entry.themes.includes(theme)) score += THEME_SCORE;
    if (entry.kind === "illustration") score -= ILLUSTRATION_PENALTY;
    if (excluded.has(entry.key)) score -= EXCLUDED_PENALTY;
    return { entry, score, matched };
  });
  return scored.sort((a, b) => b.score - a.score || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0));
}

/**
 * The candidates put to the model. Narrowing is not eager: when the eligible library has at most `size` covers (default
 * 60) every one is offered, best lexical rank first. Beyond that: the top-ranked half, then the best cover of each theme
 * not yet represented (so a lexical miss can still be chosen), then the next best by rank up to `size`. Each involved
 * theme's default cover is always included.
 */
export function shortlist(query: CoverQuery, index: readonly CoverIndexEntry[] = COVER_INDEX, size: number = DEFAULT_MAX_CANDIDATES): ScoredCover[] {
  const ranked = rankCovers(query, index);
  let picked: ScoredCover[];
  if (ranked.length <= size) {
    picked = ranked.slice();
  } else {
    picked = ranked.slice(0, Math.max(1, Math.ceil(size * HEAD_SHARE)));
    const seen = new Set(picked.flatMap(item => item.entry.themes));
    for (const item of ranked) {
      if (picked.length >= size) break;
      if (picked.includes(item) || item.entry.themes.every(theme => seen.has(theme))) continue;
      picked.push(item);
      item.entry.themes.forEach(theme => seen.add(theme));
    }
    for (const item of ranked) {
      if (picked.length >= size) break;
      if (!picked.includes(item)) picked.push(item);
    }
    picked.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  }
  const defaults = new Set<string>();
  for (const theme of queryThemes(query)) {
    const fallback = themeDefault(theme, index);
    if (fallback) defaults.add(fallback.key);
  }
  for (const key of defaults) {
    if (picked.some(item => item.entry.key === key)) continue;
    const item = ranked.find(candidate => candidate.entry.key === key);
    if (!item) continue;
    // Replace the lowest-ranked pick that is not itself a theme default.
    let slot = picked.length - 1;
    while (slot >= 0 && defaults.has(picked[slot]!.entry.key)) slot -= 1;
    if (picked.length < size) picked.push(item);
    else if (slot >= 0) picked[slot] = item;
  }
  return picked;
}

/** Candidates grouped by primary theme (first listed), each group at most `maxPerGroup` covers (larger themes are split in rank order: `theme`, `theme#2`, ...). Nothing is dropped. */
export function themeGroups(candidates: readonly ScoredCover[], maxPerGroup: number): Map<string, ScoredCover[]> {
  const byTheme = new Map<string, ScoredCover[]>();
  for (const item of candidates) {
    const theme = item.entry.themes[0] ?? "other";
    byTheme.set(theme, [...(byTheme.get(theme) ?? []), item]);
  }
  const groups = new Map<string, ScoredCover[]>();
  for (const [theme, items] of byTheme) {
    for (let i = 0; i * maxPerGroup < items.length; i += 1) groups.set(i === 0 ? theme : `${theme}#${i + 1}`, items.slice(i * maxPerGroup, (i + 1) * maxPerGroup));
  }
  return groups;
}

/**
 * Options for ONE decision call that must stay within `maxOptions` (the per-draft draftCheck call, which cannot afford a
 * second call): the covers sharing a theme with the draft first, then the rest by rank, cut at the limit. This is the
 * only place candidates are narrowed, and it applies only when the offered list exceeds the limit (never with the
 * current library). The pickEventCoverV1 path instead uses two Choice calls (theme group, then cover) and drops nothing.
 */
export function optionsForSingleCall(candidates: readonly ScoredCover[], query: CoverQuery, maxOptions: number): ScoredCover[] {
  if (candidates.length <= maxOptions) return candidates.slice();
  const themes = queryThemes(query);
  const own = candidates.filter(item => item.entry.themes.some(theme => themes.includes(theme as CoverTheme)));
  const rest = candidates.filter(item => !own.includes(item));
  return [...own, ...rest].slice(0, maxOptions).sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
}

/** 1-based lexical rank of a cover among the eligible covers, or null when it is not eligible. */
export function lexicalRank(query: CoverQuery, key: string, index: readonly CoverIndexEntry[] = COVER_INDEX): number | null {
  const position = rankCovers(query, index).findIndex(item => item.entry.key === key);
  return position === -1 ? null : position + 1;
}

/**
 * The best lexical match: the highest-ranked cover whose tags or words matched the text with a positive score, or null
 * (nothing matched the words, or every match was used up by exclusions), when the caller falls back to the theme default.
 */
export function lexicalTop(query: CoverQuery, index: readonly CoverIndexEntry[] = COVER_INDEX): ScoredCover | null {
  return rankCovers(query, index).find(item => item.matched && item.score > 0) ?? null;
}
