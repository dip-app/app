import type { DecisionQuestion } from "../../ai/application/ports";
import type { LiveCoverConfig, PixabayHit } from "../application/livePorts";
import { dynamicKeyFor } from "./dynamicCovers";
import { coverMentions } from "./liveQuery";
import { acceptable, hitTags, popularity, relevance, type RuleHit } from "./pixabayRules";
import type { ScoredCover } from "./shortlist";

/** Decisions of the live fallback: when to look beyond the library, which hits qualify, and the question about them. */
export type LiveTriggerReason = "low_score" | "few_matches" | "uncovered_terms";
export interface LiveTrigger { trigger: boolean; reason: LiveTriggerReason | null; bestScore: number; matchedCount: number }

/**
 * Fallback triggers when the best lexical score is below minScore, when fewer than minMatches covers matched the text,
 * or when the event has distinctive terms (distinctiveTerms in liveQuery.ts) and the best library cover mentions none
 * of them: "Crazy insane clown show" must not settle for a stage photo because "show" matched, however many covers the
 * theme has.
 */
export function liveTrigger(
  ranked: readonly ScoredCover[], config: Pick<LiveCoverConfig, "minScore" | "minMatches">, terms: readonly string[] = [],
): LiveTrigger {
  const bestScore = ranked.reduce((best, item) => Math.max(best, item.score), 0);
  const matchedCount = ranked.filter(item => item.matched && item.score > 0).length;
  const best = ranked[0];
  const uncovered = terms.length > 0 && (best === undefined || !terms.some(term => coverMentions(best.entry, term)));
  const reason: LiveTriggerReason | null = bestScore < config.minScore ? "low_score"
    : matchedCount < config.minMatches ? "few_matches" : uncovered ? "uncovered_terms" : null;
  return { trigger: reason !== null, reason, bestScore, matchedCount };
}

const RELEVANCE_WEIGHT = 4;
const POPULARITY_WEIGHT = 0.5;
export const MIN_PICK_RELEVANCE = 0.5;
const MAX_OPTION_TAGS = 8;
const MAX_STATIC_OPTIONS = 3;

/** Acceptable hits not excluded, deduplicated by id, ranked relevance*4 + popularity*0.5 (stable), at most `max`. */
export function liveCandidates<H extends RuleHit>(
  hits: readonly H[], words: readonly string[], opts: { excludeIds: ReadonlySet<number>; max: number },
): H[] {
  const seen = new Set<number>();
  const kept: Array<{ hit: H; score: number }> = [];
  for (const hit of hits) {
    if (seen.has(hit.id) || opts.excludeIds.has(hit.id) || !acceptable(hit)) continue;
    seen.add(hit.id);
    kept.push({ hit, score: relevance(hit, words) * RELEVANCE_WEIGHT + popularity(hit) * POPULARITY_WEIGHT });
  }
  return kept.sort((a, b) => b.score - a.score).slice(0, Math.max(0, opts.max)).map(item => item.hit);
}

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The Choice question over Pixabay candidates (described by tags only) plus the best static covers. */
export function liveQuestion(candidates: readonly Pick<PixabayHit, "id" | "tags">[], staticTop: readonly ScoredCover[]): DecisionQuestion {
  const criteria: Record<string, string> = {};
  for (const hit of candidates) criteria[dynamicKeyFor(hit.id)] = hitTags(hit).slice(0, MAX_OPTION_TAGS).join(", ") || "photo";
  for (const { entry } of staticTop.slice(0, MAX_STATIC_OPTIONS)) {
    if (!Object.hasOwn(criteria, entry.key)) criteria[entry.key] = `${entry.themes.join("/")} | ${entry.tags.slice(0, 6).join(", ")} | ${truncate(entry.alt, 60)}`;
  }
  return { type: "choice", instructions: "Which photo best fits this event? Each option is a photo described only by its tags.", criteria };
}

/** Without a model: the first candidate with the best tag overlap, when at least half of the query words match; else null. */
export function deterministicLivePick<H extends RuleHit>(candidates: readonly H[], words: readonly string[]): H | null {
  let best: H | null = null;
  let bestScore = 0;
  for (const hit of candidates) {
    const score = relevance(hit, words);
    if (score >= MIN_PICK_RELEVANCE && score > bestScore) { best = hit; bestScore = score; }
  }
  return best;
}
