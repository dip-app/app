// The one place that turns a suggestion's probability into what the admin sees. The interface never shows raw
// percentages: a probability becomes one of three positive labels, or nothing at all. Thresholds, labels and provider
// caps live here so they can be audited and changed together (unit tested in __tests__/suggestionLabels.test.ts).

import type { AiStepSuggestion, AiSuggestionProvider, AiSuggestionQuestion } from "./adminTypes";
import { t } from "./aiStrings";
import { type Answers, MAX_FOCUS, type StepId } from "./ideas";

export type SuggestionLevel = "perfect" | "great" | "good";

/** Highest first. A probability below the last `min` gets no label (and no highlight). */
export const SUGGESTION_LEVELS: readonly { level: SuggestionLevel; min: number; label: string }[] = [
  { level: "perfect", min: 0.85, label: t("level.perfect") },
  { level: "great", min: 0.7, label: t("level.great") },
  { level: "good", min: 0.55, label: t("level.good") },
];

/**
 * Strongest label each provider may earn. Jev's probabilities are calibrated; the OpenAI fallback reports its own
 * confidence and the heuristic is a rough estimate, so both stop at "Good match" until the owner raises the cap.
 */
export const PROVIDER_CAP: Readonly<Record<AiSuggestionProvider, SuggestionLevel | null>> = {
  jev: "perfect",
  openai: "good",
  heuristic: "good",
  none: null,
};

const ORDER: readonly SuggestionLevel[] = SUGGESTION_LEVELS.map((l) => l.level);

/** The label level for a probability, capped for the provider; null when too low, missing or not a number. */
export function levelFor(probability: number | null | undefined, provider: AiSuggestionProvider): SuggestionLevel | null {
  const cap = PROVIDER_CAP[provider];
  if (cap === null || typeof probability !== "number" || !Number.isFinite(probability) || probability > 1) return null;
  const hit = SUGGESTION_LEVELS.find((l) => probability >= l.min);
  if (!hit) return null;
  return ORDER.indexOf(hit.level) < ORDER.indexOf(cap) ? cap : hit.level;
}

export const labelOf = (level: SuggestionLevel) => SUGGESTION_LEVELS.find((l) => l.level === level)!.label;

export interface LabeledSuggestion extends AiStepSuggestion { level: SuggestionLevel }

/**
 * At most one labeled suggestion per question: the highest probability wins, ties go to the earlier entry. Values
 * that are not a current option of the question are dropped.
 */
export function labeledSuggestions(
  suggestions: readonly AiStepSuggestion[], provider: AiSuggestionProvider, isOption: (question: AiSuggestionQuestion, value: string) => boolean,
): Partial<Record<AiSuggestionQuestion, LabeledSuggestion>> {
  const out: Partial<Record<AiSuggestionQuestion, LabeledSuggestion>> = {};
  for (const s of suggestions) {
    if (!isOption(s.question, s.value)) continue;
    const level = levelFor(s.probability, provider);
    if (!level) continue;
    const current = out[s.question];
    if (!current || s.probability > current.probability) out[s.question] = { ...s, level };
  }
  return out;
}

/** Which flow step each question belongs to. */
export const QUESTION_STEP: Readonly<Record<AiSuggestionQuestion, StepId>> = {
  interest: "interests", goal: "goal", groupSize: "group", setting: "group", budget: "budget", timing: "budget",
};

/**
 * Fills every choice that has a labeled suggestion (only those) for the admin to review. The suggested interest is
 * added to the admin's own picks (it replaces the last one only when all three are taken). The note is never touched.
 */
export function applySuggestions(answers: Answers, labeled: Partial<Record<AiSuggestionQuestion, LabeledSuggestion>>): Answers {
  const next = { ...answers };
  if (labeled.interest) {
    const id = labeled.interest.value;
    const mine = answers.focusTagIds;
    next.focusTagIds = mine.includes(id) ? mine : mine.length < MAX_FOCUS ? [...mine, id] : [...mine.slice(0, MAX_FOCUS - 1), id];
  }
  if (labeled.goal) next.goal = labeled.goal.value as Answers["goal"];
  if (labeled.groupSize) next.groupSize = labeled.groupSize.value as Answers["groupSize"];
  if (labeled.setting) next.setting = labeled.setting.value as Answers["setting"];
  if (labeled.budget) next.budget = labeled.budget.value as Answers["budget"];
  if (labeled.timing) next.timing = labeled.timing.value as Answers["timing"];
  return next;
}

/** True when the answers already hold every labeled suggestion (the "Use suggestions" button then reads as done). */
export function suggestionsApplied(answers: Answers, labeled: Partial<Record<AiSuggestionQuestion, LabeledSuggestion>>): boolean {
  const applied = applySuggestions(answers, labeled);
  return JSON.stringify(applied) === JSON.stringify(answers);
}

/** Tooltip title: who suggested it. Always Dipbot: provider names never appear in the interface. */
export const suggestedBy = (provider: AiSuggestionProvider) => t(provider === "jev" ? "suggest.by.jev" : "suggest.by.other");

/** Screen reader text for a labeled option, for example "Dipbot suggests this: perfect fit". */
export function spokenSuggestion(level: SuggestionLevel, provider: AiSuggestionProvider): string {
  return t(provider === "jev" ? "suggest.spoken.jev" : "suggest.spoken.other", { label: labelOf(level).toLowerCase() });
}

/** The labeled suggestions that belong to one flow step (the banner and the pick button work per step). */
export function suggestionsForStep(
  labeled: Partial<Record<AiSuggestionQuestion, LabeledSuggestion>>, step: StepId,
): Partial<Record<AiSuggestionQuestion, LabeledSuggestion>> {
  const out: Partial<Record<AiSuggestionQuestion, LabeledSuggestion>> = {};
  for (const [question, suggestion] of Object.entries(labeled) as [AiSuggestionQuestion, LabeledSuggestion][]) {
    if (QUESTION_STEP[question] === step) out[question] = suggestion;
  }
  return out;
}
