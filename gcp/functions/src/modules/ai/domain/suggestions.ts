import type { AiEventChoices, AiInterestTag } from "../../../generated/models";
import type { CatalogTag, CurrentTheme, DecisionAnswer, DecisionQuestion } from "../application/ports";
import { block } from "./prompt";
import { reasonWithBasis } from "./suggestionReasons";
import { BUDGETS, GOALS, GROUP_SIZES, SETTINGS, TIMINGS } from "./vocabulary";

/**
 * Per-step suggestions for the admin's card flow (getEventIdeaSuggestionsV1). The decision model (Jev, or the OpenAI
 * mini fallback) makes the judgments: which option of each step fits this company best, as a calibrated probability.
 * Code decides what to show: the portal maps probabilities to labels (apps/admin/src/lib/suggestionLabels.ts) and a
 * suggestion never selects anything by itself. Every question is answered over one shared state, so the whole flow is
 * one decision call. The state holds rounded interest buckets, the theme title and aggregate counts of past events
 * (no titles, descriptions, names or ids), so no personal data reaches the provider.
 */

export const SUGGESTION_QUESTIONS = ["interest", "goal", "groupSize", "setting", "budget", "timing"] as const;
export type SuggestionQuestion = (typeof SUGGESTION_QUESTIONS)[number];
export type SuggestionProvider = "jev" | "openai" | "heuristic";

export interface Suggestion {
  question: SuggestionQuestion;
  /** An option value of the question: a tag id for `interest`, else an AiEventChoices enum value. */
  value: string;
  /** Probability from 0 to 1 that this option is the best fit (argmax of the answer's distribution). */
  probability: number;
  /** One deterministic line built by code from the facts (never model text). */
  reason: string;
  /** "company_data" when the company's own data (above the privacy floor) drove it, else "generic" (never implies personalization). */
  reasonBasis: "company_data" | "generic";
}

/** Aggregates of the company's recent past events. Counts only: nothing that could identify a person or an event. */
export interface PastEventStats {
  total: number;
  outdoor: number;
  budget: Record<AiEventChoices["budget"], number>;
  timing: Record<AiEventChoices["timing"], number>;
  size: Record<AiEventChoices["groupSize"], number>;
  tags: Record<string, number>;
}

export interface SuggestionFacts {
  interests: AiInterestTag[];
  theme: CurrentTheme | null;
  past: PastEventStats | null;
  catalog: readonly CatalogTag[];
}

/** Candidate interests sent to the model: the top buckets only (already suppressed under 5 members). */
const INTEREST_CANDIDATES = 8;

const BUDGET_TEXT: Record<AiEventChoices["budget"], string> = {
  free: "Free: no cost per person", under_15: "Under $15 per person", from_15_to_50: "$15 to $50 per person", over_50: "Over $50 per person",
};
const GOAL_TEXT: Record<AiEventChoices["goal"], string> = {
  team_bonding: "Team bonding: coworkers get to know each other",
  wellness: "Wellness: movement, rest or mental health",
  learning: "Learning: people try or teach a new skill",
  give_back: "Give back: volunteering for a local cause",
  celebrate: "Celebrate: mark a win, a milestone or a season",
  competition: "Friendly competition: teams play for scores and bragging rights",
};
const SIZE_TEXT: Record<AiEventChoices["groupSize"], string> = {
  small: "A small group of under 10 people", team: "A team of 10 to 30 people", company: "Company-wide, open to everyone",
};
const SETTING_TEXT: Record<AiEventChoices["setting"], string> = {
  indoors: "Indoors at the office or a venue", outdoors: "Outdoors in a park or on a trail", offsite: "A nearby offsite location",
};
const TIMING_TEXT: Record<AiEventChoices["timing"], string> = {
  weekday_lunch: "A weekday lunch break", after_work: "A weekday evening after work", weekend: "On Saturday or Sunday",
};

function withReason(question: SuggestionQuestion, value: string, facts: SuggestionFacts) {
  const { reason, basis } = reasonWithBasis(question, value, facts);
  return { reason, reasonBasis: basis };
}

export function hasSignal(facts: SuggestionFacts): boolean {
  return facts.interests.length > 0 || (facts.past?.total ?? 0) > 0;
}

function nameOf(facts: SuggestionFacts, tagId: string): string {
  return facts.catalog.find(tag => tag.id === tagId)?.name ?? tagId;
}

const BUCKET_TEXT: Record<AiInterestTag["bucket"], string> = { "20+": "20 or more members", "10-19": "10 to 19 members", "5-9": "5 to 9 members" };

/** The state shared by every question: named fields, only what a person would look at to answer. */
export function suggestionState(facts: SuggestionFacts): string {
  const state: Record<string, unknown> = {
    purpose: "An HR admin is planning the next workplace social event for this company and wants a sensible default for each choice.",
  };
  if (facts.interests.length > 0) {
    state.memberInterests = facts.interests.slice(0, INTEREST_CANDIDATES).map(i => ({ interest: nameOf(facts, i.tagId), interestedMembers: BUCKET_TEXT[i.bucket] }));
  }
  if (facts.theme) state.thisWeeksTheme = facts.theme.title;
  const past = facts.past;
  if (past && past.total > 0) {
    const named = (record: Record<string, number>, text: Record<string, string>) =>
      Object.fromEntries(Object.entries(record).filter(([, n]) => n > 0).map(([key, n]) => [text[key] ?? key, n]));
    state.recentPastEvents = {
      count: past.total,
      outdoors: past.outdoor,
      byCostPerPerson: named(past.budget, BUDGET_TEXT),
      byTiming: named(past.timing, TIMING_TEXT),
      byCapacity: named(past.size, SIZE_TEXT),
      byInterest: Object.fromEntries(Object.entries(past.tags).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => [nameOf(facts, id), n])),
    };
  }
  return block("company_planning_facts", state);
}

/** Option values of a question, in display order (ties go to the earlier option). */
export function optionsOf(question: SuggestionQuestion, facts: SuggestionFacts): readonly string[] {
  switch (question) {
    case "interest": return facts.interests.slice(0, INTEREST_CANDIDATES).map(i => i.tagId);
    case "goal": return GOALS;
    case "groupSize": return GROUP_SIZES;
    case "setting": return SETTINGS;
    case "budget": return BUDGETS;
    case "timing": return TIMINGS;
  }
}

/**
 * One question per flow choice, all over `company_planning_facts`. Choices for categories, a Score for the ordered
 * budget levels. `interest` is left out when there are fewer than two candidates (nothing to choose between).
 */
export function suggestionQuestions(facts: SuggestionFacts): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {};
  const interests = optionsOf("interest", facts);
  if (interests.length >= 2) {
    questions.interest = {
      type: "choice",
      instructions: "Which interest in `company_planning_facts.memberInterests` would the most members enjoy as the focus of the next event?",
      criteria: Object.fromEntries(interests.map(id => [id, nameOf(facts, id)])),
    };
  }
  questions.goal = { type: "choice", instructions: "Which goal would suit the next event for this company's members?", criteria: GOAL_TEXT };
  questions.groupSize = { type: "choice", instructions: "Which group size suits the next event for this company?", criteria: SIZE_TEXT };
  questions.setting = { type: "choice", instructions: "Where would this company's members most enjoy the next event?", criteria: SETTING_TEXT };
  questions.budget = {
    type: "score",
    instructions: "What cost per person suits the next event for this company?",
    criteria: BUDGETS.map(b => BUDGET_TEXT[b]),
  };
  questions.timing = { type: "choice", instructions: "When would most of this company's members be able to join the next event?", criteria: TIMING_TEXT };
  return questions;
}

const isUnit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * The top option of an answer and its probability: the highest entry of the distribution (ties to the earlier option),
 * so a Score's position is never pulled toward the middle. A missing or malformed answer is null (no suggestion).
 */
export function topOption(answer: DecisionAnswer | undefined, options: readonly string[]): { value: string; probability: number } | null {
  if (!answer || options.length === 0) return null;
  if (answer.type === "noul") return null;
  const keyOf = (option: string, index: number) => (answer.type === "score" ? String(index) : option);
  let best: { value: string; probability: number } | null = null;
  options.forEach((option, index) => {
    const p = answer.probabilities[keyOf(option, index)];
    if (isUnit(p) && (best === null || p > best.probability)) best = { value: option, probability: p };
  });
  if (best) return best;
  // A provider without a distribution: fall back to the chosen option with its confidence.
  if (answer.type === "choice" && options.includes(answer.choice) && isUnit(answer.confidence)) return { value: answer.choice, probability: answer.confidence };
  if (answer.type === "score" && Number.isFinite(answer.score) && isUnit(answer.confidence)) {
    const index = Math.round(answer.score);
    if (index >= 0 && index < options.length) return { value: options[index]!, probability: answer.confidence };
  }
  return null;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Decision answers to suggestions (one per answered question). */
export function fromAnswers(answers: Record<string, DecisionAnswer>, facts: SuggestionFacts): Suggestion[] {
  const out: Suggestion[] = [];
  for (const question of SUGGESTION_QUESTIONS) {
    const top = topOption(answers[question], optionsOf(question, facts));
    if (top) out.push({ question, value: top.value, probability: round3(top.probability), ...withReason(question, top.value, facts) });
  }
  return out;
}

// ---------- Deterministic heuristic (no provider, or every provider failed)

const GOAL_OF_TAG: Record<string, AiEventChoices["goal"][]> = {
  "tag-fitness": ["wellness"], "tag-energetic": ["competition"], "tag-hype": ["celebrate"], "tag-outdoors": ["wellness", "team_bonding"],
  "tag-social": ["team_bonding"], "tag-cooking": ["team_bonding"], "tag-games": ["competition"], "tag-chill": ["wellness"],
  "tag-food": ["team_bonding"], "tag-arts": ["learning"], "tag-music": ["celebrate"], "tag-learning": ["learning"],
  "tag-volunteering": ["give_back"], "tag-wellness": ["wellness"],
};
const BUCKET_WEIGHT: Record<AiInterestTag["bucket"], number> = { "20+": 4, "10-19": 2, "5-9": 1 };

function normalized(options: readonly string[], weights: Record<string, number>): { value: string; probability: number } | null {
  const total = options.reduce((sum, o) => sum + Math.max(0, weights[o] ?? 0), 0);
  if (total <= 0) return null;
  let best: { value: string; probability: number } | null = null;
  for (const option of options) {
    const p = Math.max(0, weights[option] ?? 0) / total;
    if (best === null || p > best.probability) best = { value: option, probability: p };
  }
  return best;
}

function mostCommon<K extends string>(record: Record<K, number>, options: readonly K[]): { key: K; count: number } | null {
  let best: { key: K; count: number } | null = null;
  for (const key of options) if ((record[key] ?? 0) > 0 && (best === null || record[key] > best.count)) best = { key, count: record[key] };
  return best;
}

/**
 * Weights from interest buckets and past-event counts, normalized per question. Deliberately flat priors, so the
 * heuristic rarely clears the portal's label thresholds without real data; the portal also caps its label.
 */
export function heuristicSuggestions(facts: SuggestionFacts): Suggestion[] {
  if (!hasSignal(facts)) return [];
  const past = facts.past && facts.past.total > 0 ? facts.past : null;
  const weights: Record<SuggestionQuestion, Record<string, number>> = {
    interest: {}, goal: { team_bonding: 1 }, groupSize: { team: 1 }, setting: { indoors: 1 }, budget: { free: 1, under_15: 1 }, timing: { after_work: 1 },
  };
  for (const { tagId, bucket } of facts.interests.slice(0, INTEREST_CANDIDATES)) {
    const w = BUCKET_WEIGHT[bucket];
    weights.interest[tagId] = w + (facts.theme?.tagIds.includes(tagId) ? 1 : 0);
    for (const goal of GOAL_OF_TAG[tagId] ?? []) weights.goal[goal] = (weights.goal[goal] ?? 0) + w;
    if (tagId === "tag-outdoors") weights.setting.outdoors = (weights.setting.outdoors ?? 0) + w;
    if (bucket === "20+") weights.groupSize.company = (weights.groupSize.company ?? 0) + 1;
  }
  if (past) {
    const share = (n: number) => (4 * n) / past.total;
    for (const b of BUDGETS) weights.budget[b] = (weights.budget[b] ?? 0) + share(past.budget[b]);
    for (const t of TIMINGS) weights.timing[t] = (weights.timing[t] ?? 0) + share(past.timing[t]);
    for (const s of GROUP_SIZES) weights.groupSize[s] = (weights.groupSize[s] ?? 0) + share(past.size[s]);
    weights.setting.outdoors = (weights.setting.outdoors ?? 0) + share(past.outdoor);
    weights.setting.indoors = (weights.setting.indoors ?? 0) + share(past.total - past.outdoor);
  }
  const out: Suggestion[] = [];
  for (const question of SUGGESTION_QUESTIONS) {
    const options = optionsOf(question, facts);
    if (question === "interest" && options.length < 2) continue;
    const top = normalized(options, weights[question]);
    if (top) out.push({ question, value: top.value, probability: round3(top.probability), ...withReason(question, top.value, facts) });
  }
  return out;
}

// ---------- Reasons: one line built by code (domain/suggestionReasons.ts), honest about what drove it

// ---------- Past-event aggregation (pure; the Firestore adapter only reads the documents)

export interface PastEventInput { startTime: Date; costCents: number; capacity: number; isOutdoor: boolean; tagIds: readonly string[] }

/** Local weekday and hour in the company's time zone (Eastern by default, like the portal's weeks). */
function localParts(date: Date, timeZone: string): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  return { weekday: parts.find(p => p.type === "weekday")?.value ?? "", hour: Number(parts.find(p => p.type === "hour")?.value ?? 0) };
}

export function timingOf(date: Date, timeZone = "America/New_York"): AiEventChoices["timing"] | null {
  const { weekday, hour } = localParts(date, timeZone);
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  if (hour >= 11 && hour < 14) return "weekday_lunch";
  if (hour >= 16) return "after_work";
  return null;
}

export function budgetOf(costCents: number): AiEventChoices["budget"] {
  if (costCents <= 0) return "free";
  if (costCents < 1500) return "under_15";
  if (costCents <= 5000) return "from_15_to_50";
  return "over_50";
}

export function sizeOf(capacity: number): AiEventChoices["groupSize"] {
  if (capacity < 10) return "small";
  if (capacity <= 30) return "team";
  return "company";
}

export function aggregatePastEvents(events: readonly PastEventInput[], knownTags: ReadonlySet<string>): PastEventStats | null {
  if (events.length === 0) return null;
  const stats: PastEventStats = {
    total: 0, outdoor: 0,
    budget: { free: 0, under_15: 0, from_15_to_50: 0, over_50: 0 },
    timing: { weekday_lunch: 0, after_work: 0, weekend: 0 },
    size: { small: 0, team: 0, company: 0 },
    tags: {},
  };
  for (const event of events) {
    stats.total += 1;
    if (event.isOutdoor) stats.outdoor += 1;
    stats.budget[budgetOf(event.costCents)] += 1;
    stats.size[sizeOf(event.capacity)] += 1;
    const timing = timingOf(event.startTime);
    if (timing) stats.timing[timing] += 1;
    for (const id of event.tagIds) if (knownTags.has(id)) stats.tags[id] = (stats.tags[id] ?? 0) + 1;
  }
  return stats;
}
