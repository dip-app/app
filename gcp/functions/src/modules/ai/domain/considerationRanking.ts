import type { DecisionAnswer, DecisionQuestion } from "../application/ports";
import {
  CONSIDERATIONS, considerationRelevance, rankConsiderationsByRules, type ConsiderationContext, type ConsiderationRank,
} from "./considerations";
import type { PastEventStats, SuggestionFacts } from "./suggestions";

/**
 * Which considerations to surface first for a company. The decision model answers one yes/no question per
 * consideration in the same single call as the step suggestions; a missing or malformed answer, or no model at all,
 * falls back to the deterministic rule ranking. Ranking never removes anything: the portal lists every consideration.
 */

const questionKey = (id: string) => `consider_${id}`;

/** One yes/no question per catalog consideration, over the same shared company state. */
export function considerationQuestions(): Record<string, DecisionQuestion> {
  return Object.fromEntries(CONSIDERATIONS.map(entry => [
    questionKey(entry.id),
    {
      type: "noul" as const,
      instructions: `When planning the next event for this company, would "${entry.label}" matter to a good share of its members?`,
      criteria: { true: `Many members would value this: ${entry.hint}.`, false: "Few members would notice either way." },
    },
  ]));
}

function leader(record: Record<string, number>): string | null {
  let best: string | null = null;
  let top = 0;
  for (const [key, n] of Object.entries(record)) if (n > top) { best = key; top = n; }
  return best;
}

function pastContext(past: PastEventStats | null): Pick<ConsiderationContext, "groupSize" | "setting" | "budget" | "timing"> {
  if (!past || past.total === 0) return {};
  return {
    groupSize: leader(past.size), budget: leader(past.budget), timing: leader(past.timing),
    setting: past.outdoor * 2 > past.total ? "outdoors" : "indoors",
  };
}

/** The company-level context the rules can see: member interest tags, the weekly theme and the habits of past events. */
export function considerationContext(facts: SuggestionFacts): ConsiderationContext {
  const tagIds = [...facts.interests.map(i => i.tagId), ...(facts.theme?.tagIds ?? [])];
  return { tagIds, ...pastContext(facts.past) };
}

/** The rule-based ranking for a company (used when no model answered). */
export function rankConsiderationsForFacts(facts: SuggestionFacts): ConsiderationRank[] {
  return rankConsiderationsByRules(considerationContext(facts));
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Model answers to a full ranking; considerations without a valid answer keep their (halved) rule score. */
export function considerationsFromAnswers(answers: Record<string, DecisionAnswer>, facts: SuggestionFacts): ConsiderationRank[] {
  const context = considerationContext(facts);
  return CONSIDERATIONS
    .map((entry, index) => {
      const answer = answers[questionKey(entry.id)];
      const probability = answer && answer.type === "noul" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1
        ? answer.noul
        : considerationRelevance(entry, context) / 2;
      return { id: entry.id, probability: round3(probability), index };
    })
    .sort((a, b) => b.probability - a.probability || a.index - b.index)
    .map(({ id, probability }) => ({ id, probability }));
}

/** How many of the considerations got a usable model answer (zero means the ranking is only rules). */
export function answeredConsiderations(answers: Record<string, DecisionAnswer>): number {
  return CONSIDERATIONS.filter(entry => answers[questionKey(entry.id)]?.type === "noul").length;
}
