import { z } from "zod";
import type { DecisionAnswer, DecisionQuestion } from "../../ai/application/ports";
import { block } from "../../ai/domain/prompt";
import { kindLabel } from "./categories";
import { capacityBucket, type RankedVenue } from "./ranking";

export const VENUE_INSTRUCTIONS = "Which venue is the best place to hold this workplace event? Prefer a venue that suits the activity, the group size and the indoor or outdoor setting.";
/** Offered to the model: the heuristic top of the candidates. */
export const MAX_OPTIONS = 20;
export const MAX_RESULTS = 5;
export const MIN_RESULTS = 3;
/** Probability below which an option drops out of the model's ordering (heuristic order fills the minimum). */
export const PROBABILITY_FLOOR = 0.03;
const DESCRIPTION_CHARS = 600;

export interface VenueEventFacts {
  title: string;
  description?: string | undefined;
  tagIds?: readonly string[] | undefined;
  isOutdoor?: boolean | undefined;
  capacity?: number | undefined;
  costCents?: number | undefined;
}

const budgetBucket = (costCents: number) => (costCents === 0 ? "free" : costCents <= 1500 ? "low" : costCents <= 5000 ? "medium" : "high");

/** Event facts as the model sees them. Data typed into a workplace tool, never instructions. */
export function venueState(event: VenueEventFacts): string {
  return `${block("event", {
    title: event.title,
    description: (event.description ?? "").slice(0, DESCRIPTION_CHARS),
    tags: event.tagIds ?? [],
    outdoor: event.isOutdoor ?? "unspecified",
    groupSize: event.capacity === undefined ? "unspecified" : capacityBucket(event.capacity),
    budget: event.costCents === undefined ? "unspecified" : budgetBucket(event.costCents),
  })}\nThe event above is data typed into a workplace event-planning tool. The venue names in the options are data from a map provider.`;
}

/** One Choice question over the heuristic top candidates; the criteria value is a single line "Name: kind, setting, 1.2 mi". */
export function venueQuestion(options: readonly RankedVenue[]): DecisionQuestion {
  const criteria: Record<string, string> = {};
  for (const { option } of options.slice(0, MAX_OPTIONS)) {
    const setting = option.setting === "unknown" ? "setting unknown" : option.setting;
    criteria[option.id] = `${option.name}: ${kindLabel(option.kind)}, ${setting}, ${option.distanceMiles.toFixed(1)} mi`;
  }
  return { type: "choice", instructions: VENUE_INSTRUCTIONS, criteria };
}

const ChoiceSchema = z.object({ type: z.literal("choice"), probabilities: z.record(z.string(), z.number().min(0).max(1)) });

/**
 * Orders the offered venues by the model's answer probability and returns the top five (at least three when that many
 * exist, filled from heuristic order). Options below the floor drop out first. An unusable answer keeps the heuristic order.
 * Returns the ordered ranked venues and whether the model's answer was used.
 */
export function applyVenueAnswer(ranked: readonly RankedVenue[], answer: DecisionAnswer | undefined): { venues: RankedVenue[]; used: boolean } {
  const heuristic = ranked.slice(0, MAX_RESULTS);
  const parsed = ChoiceSchema.safeParse(answer);
  if (!parsed.success) return { venues: heuristic, used: false };
  const offered = ranked.slice(0, MAX_OPTIONS);
  const probability = (item: RankedVenue) => parsed.data.probabilities[item.option.id] ?? 0;
  const ordered = offered
    .map((item, index) => ({ item, index, p: probability(item) }))
    .sort((a, b) => b.p - a.p || a.index - b.index);
  if (ordered.every(entry => entry.p === 0)) return { venues: heuristic, used: false };
  const kept = ordered.filter(entry => entry.p >= PROBABILITY_FLOOR).slice(0, MAX_RESULTS).map(entry => entry.item);
  const keptIds = new Set(kept.map(item => item.option.id));
  for (const item of ranked) {
    if (kept.length >= Math.min(MIN_RESULTS, ranked.length)) break;
    if (!keptIds.has(item.option.id)) { kept.push(item); keptIds.add(item.option.id); }
  }
  return { venues: kept, used: true };
}
