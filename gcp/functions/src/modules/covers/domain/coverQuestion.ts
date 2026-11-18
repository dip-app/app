import { z } from "zod";
import type { DecisionAnswer, DecisionQuestion } from "../../ai/application/ports";
import type { ScoredCover } from "./shortlist";

/**
 * The typed "Choice" question Jev (or the OpenAI fallback) answers over a lexical shortlist. Criteria keys are the cover
 * keys; each value is the human label plus its tags and themes, which is all the model ever sees of a picture (text only).
 */
export const COVER_INSTRUCTIONS = "Which cover picture best fits this event? Prefer the picture of the specific activity over a generic one.";

/** Below the standard confident-choice threshold, an argmax answer is still accepted when the lexical match has no clear winner. */
export const ARGMAX_MIN_PROBABILITY = 0.35;
/** A lexical winner is clear when it scores at least this much and leads the runner-up by at least CLEAR_MARGIN. */
export const CLEAR_MIN_SCORE = 3;
export const CLEAR_MARGIN = 3;

const ALT_CHARS = 60;
const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** First choice of the two-call path: which theme group the cover belongs to (descriptions list a few tags of the group). */
export function groupQuestion(groups: ReadonlyMap<string, readonly ScoredCover[]>): DecisionQuestion {
  const criteria: Record<string, string> = {};
  for (const [id, items] of groups) {
    const tags = [...new Set(items.flatMap(item => item.entry.tags))].slice(0, 8).join(", ");
    criteria[id] = `${id.replace(/#\d+$/, "")} | ${items.length} covers | ${tags}`;
  }
  return { type: "choice", instructions: "Which group of cover pictures best fits this event?", criteria };
}

export function coverQuestion(candidates: readonly ScoredCover[]): DecisionQuestion {
  const criteria: Record<string, string> = {};
  for (const { entry } of candidates) {
    criteria[entry.key] = `${entry.themes.join("/")} | ${entry.tags.slice(0, 6).join(", ")} | ${truncate(entry.alt, ALT_CHARS)}`;
  }
  return { type: "choice", instructions: COVER_INSTRUCTIONS, criteria };
}

/** True when the best lexical candidate stands clearly above the rest (so a vague model answer should not override it). */
export function hasClearLexicalWinner(candidates: readonly ScoredCover[]): boolean {
  const [top, second] = candidates;
  return top !== undefined && top.score >= CLEAR_MIN_SCORE && top.score - (second?.score ?? 0) >= CLEAR_MARGIN;
}

/**
 * The cover key a Choice answer picked, or null when the answer is not usable: wrong type, a key outside the shortlist
 * (checked with zod against the shortlist keys), or not confident enough. `minProbability` is the standard
 * confident-choice threshold; `lexicalIsClear` raises the bar to it for vague answers.
 */
export function chosenCoverKey(
  answer: DecisionAnswer | undefined, keys: readonly string[], minProbability: number, lexicalIsClear: boolean,
): string | null {
  if (keys.length === 0) return null;
  const schema = z.object({
    type: z.literal("choice"),
    choice: z.enum(keys as [string, ...string[]]),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  });
  const parsed = schema.safeParse(answer);
  if (!parsed.success) return null;
  const { choice, probabilities } = parsed.data;
  const probability = probabilities[choice];
  if (probability === undefined) return null;
  if (probability >= minProbability) return choice;
  const isArgmax = Object.values(probabilities).every(value => value <= probability);
  return !lexicalIsClear && isArgmax && probability >= ARGMAX_MIN_PROBABILITY ? choice : null;
}
