// Pure logic for the "Event ideas" flow (AI drafts): steps, answers, labels, request id reuse, and the hand-off
// from a generated draft to the event form. No React and no network, so it is unit tested directly.

import type {
  AiBudget, AiDaypart, AiEventChoices, AiGoal, AiGroupSize, AiSetting, AiTiming, AiVenueType, GeneratedEventDraft,
} from "./adminTypes";
import { COVERS, TAG_IDS } from "./catalog";
import type { EventDraft } from "./contract";

export const MAX_FOCUS = 3;
export const MAX_PROMPT = 500;

export type StepId = "interests" | "goal" | "group" | "budget" | "note";
export const STEPS: { id: StepId; label: string; heading: string }[] = [
  { id: "interests", label: "Interests", heading: "What people like" },
  { id: "goal", label: "Goal", heading: "What is the goal?" },
  { id: "group", label: "Group and setting", heading: "Who is it for, and where?" },
  { id: "budget", label: "Budget and timing", heading: "What budget, and when?" },
  { id: "note", label: "Note", heading: "Anything else?" },
];

interface Option<T extends string> { value: T; label: string; hint: string }
export const GOALS: Option<AiGoal>[] = [
  { value: "team_bonding", label: "Team bonding", hint: "Get to know each other" },
  { value: "wellness", label: "Wellness", hint: "Move, relax, recharge" },
  { value: "learning", label: "Learning", hint: "Try or teach something new" },
  { value: "give_back", label: "Give back", hint: "Help the community" },
  { value: "celebrate", label: "Celebrate", hint: "Mark a win or a milestone" },
  { value: "competition", label: "Friendly competition", hint: "Teams, scores, bragging rights" },
];
export const GROUP_SIZES: Option<AiGroupSize>[] = [
  { value: "small", label: "Small", hint: "Under 10 people" },
  { value: "team", label: "Team", hint: "10 to 30 people" },
  { value: "company", label: "Company-wide", hint: "Everyone is welcome" },
];
export const SETTINGS: Option<AiSetting>[] = [
  { value: "indoors", label: "Indoors", hint: "At the office or a venue" },
  { value: "outdoors", label: "Outdoors", hint: "Parks, trails, open air" },
  { value: "offsite", label: "Nearby offsite", hint: "Somewhere close to the office" },
];
export const BUDGETS: Option<AiBudget>[] = [
  { value: "free", label: "Free", hint: "No cost per person" },
  { value: "under_15", label: "Under $15", hint: "Per person" },
  { value: "from_15_to_50", label: "$15 to $50", hint: "Per person" },
  { value: "over_50", label: "Over $50", hint: "Per person" },
];
export const TIMINGS: Option<AiTiming>[] = [
  { value: "weekday_lunch", label: "Weekday lunch", hint: "Around noon" },
  { value: "after_work", label: "After work", hint: "Weekday evening" },
  { value: "weekend", label: "Weekend", hint: "Saturday or Sunday" },
];

export const NOTE_SUGGESTIONS = [
  "Something new for the team",
  "Vegetarian food options",
  "Easy for people who use a wheelchair",
  "Quiet and low pressure",
];

export interface Answers {
  focusTagIds: string[];
  /** "Surprise me": answers step 1 without picking interests. */
  surprise: boolean;
  goal: AiGoal | null;
  groupSize: AiGroupSize | null;
  setting: AiSetting | null;
  budget: AiBudget | null;
  timing: AiTiming | null;
  prompt: string;
  count: 1 | 2 | 3;
}

export function emptyAnswers(): Answers {
  return { focusTagIds: [], surprise: false, goal: null, groupSize: null, setting: null, budget: null, timing: null, prompt: "", count: 3 };
}

/** Toggles one interest: at most MAX_FOCUS; picking one cancels "Surprise me". Unknown extra picks are ignored. */
export function toggleInterest(answers: Answers, tagId: string): Answers {
  if (answers.focusTagIds.includes(tagId)) return { ...answers, focusTagIds: answers.focusTagIds.filter((id) => id !== tagId) };
  if (answers.focusTagIds.length >= MAX_FOCUS) return answers;
  return { ...answers, surprise: false, focusTagIds: [...answers.focusTagIds, tagId] };
}
export function chooseSurprise(answers: Answers): Answers {
  return { ...answers, surprise: true, focusTagIds: [] };
}

export function stepValid(step: StepId, a: Answers): boolean {
  switch (step) {
    case "interests": return a.surprise || a.focusTagIds.length > 0;
    case "goal": return a.goal !== null;
    case "group": return a.groupSize !== null && a.setting !== null;
    case "budget": return a.budget !== null && a.timing !== null;
    case "note": return a.prompt.length <= MAX_PROMPT;
  }
}

/** Steps 1 to 4 answered (the note is optional). */
export function readyToGenerate(a: Answers): boolean {
  return STEPS.slice(0, 4).every((s) => stepValid(s.id, a)) && stepValid("note", a);
}

/** Index of the first step that still needs an answer, or the last step when everything is answered. */
export function firstOpenStep(a: Answers): number {
  const index = STEPS.findIndex((s) => !stepValid(s.id, a));
  return index === -1 ? STEPS.length - 1 : index;
}

export function choicesOf(a: Answers): AiEventChoices | null {
  if (!a.goal || !a.groupSize || !a.setting || !a.budget || !a.timing || !(a.surprise || a.focusTagIds.length)) return null;
  return { focusTagIds: a.surprise ? [] : [...a.focusTagIds], goal: a.goal, groupSize: a.groupSize, setting: a.setting, budget: a.budget, timing: a.timing };
}

const labelOf = <T extends string>(options: Option<T>[], value: T | null) => options.find((o) => o.value === value)?.label ?? "";

export interface SummaryLine { step: number; label: string; value: string }
/** The "Your choices" list. Unanswered lines read "Not set". */
export function summaryLines(a: Answers, tagName: (id: string) => string): SummaryLine[] {
  const interests = a.surprise ? "Surprise me" : a.focusTagIds.map(tagName).join(", ");
  const group = [labelOf(GROUP_SIZES, a.groupSize), labelOf(SETTINGS, a.setting)].filter(Boolean).join(", ");
  const budget = [labelOf(BUDGETS, a.budget), labelOf(TIMINGS, a.timing)].filter(Boolean).join(", ");
  const note = a.prompt.trim();
  return [
    { step: 0, label: "Interests", value: interests || "Not set" },
    { step: 1, label: "Goal", value: labelOf(GOALS, a.goal) || "Not set" },
    { step: 2, label: "Group and setting", value: group || "Not set" },
    { step: 3, label: "Budget and timing", value: budget || "Not set" },
    { step: 4, label: "Note", value: note ? (note.length > 60 ? `${note.slice(0, 57)}...` : note) : "None" },
  ];
}

export type Bucket = "5-9" | "10-19" | "20+";
export const bucketText = (bucket: Bucket) => (bucket === "20+" ? "20+ members" : bucket === "10-19" ? "10 to 19 members" : "5 to 9 members");
export const bucketLevel = (bucket: Bucket) => (bucket === "20+" ? 3 : bucket === "10-19" ? 2 : 1);

// ---------- Request ids

/** What a request is: the same choices, note and count produce the same signature. */
export function signatureOf(choices: AiEventChoices, prompt: string, count: number): string {
  return JSON.stringify([choices.focusTagIds, choices.goal, choices.groupSize, choices.setting, choices.budget, choices.timing, prompt.trim(), count]);
}

/** Failures where the server may or may not have done the work, so retrying the same request is safe and free. */
export const RETRYABLE_REASONS: readonly string[] = ["AI_UNAVAILABLE", "AI_OUTPUT_INVALID", "REQUEST_IN_PROGRESS"];

export interface Attempt { requestId: string; signature: string; /** Failed with a reason that is safe to retry unchanged. */ retryable: boolean }

/** Reuse the previous requestId only when the request is unchanged, it failed retryably, and this is not "Regenerate". */
export function requestIdFor(previous: Attempt | null, signature: string, regenerate: boolean, make: () => string): string {
  if (!regenerate && previous && previous.retryable && previous.signature === signature) return previous.requestId;
  return make();
}

// ---------- Draft labels

const DAYPART: Record<AiDaypart, string> = {
  weekday_morning: "Weekday morning", weekday_lunch: "Weekday lunch", weekday_afternoon: "Weekday afternoon",
  after_work: "After work", weekend_daytime: "Weekend daytime", weekend_evening: "Weekend evening",
};
export const daypartLabel = (value: AiDaypart) => DAYPART[value] ?? "Flexible";

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
export const capacityLabel = (capacity: number) => `Up to ${capacity}`;
export function costLabel(costCents: number): string {
  if (costCents <= 0) return "Free";
  const dollars = costCents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)} per person`;
}
const VENUE: Record<AiVenueType, string> = {
  office: "the office", park_or_outdoors: "a park or outdoor space", restaurant_or_cafe: "a restaurant or cafe",
  activity_venue: "an activity venue", community_site: "a community site",
};
/** "Venue idea: bowling alley" (the hint when the model gave one, otherwise the venue type). */
export function venueLabel(draft: Pick<GeneratedEventDraft, "venueType" | "venueSearchHint">): string {
  return `Venue idea: ${draft.venueSearchHint.trim() || VENUE[draft.venueType] || "to be chosen"}`;
}

/** Plain text for "Copy text". */
export function draftText(d: GeneratedEventDraft, tagName: (id: string) => string): string {
  return [
    d.title, "", d.description, "",
    `When: ${daypartLabel(d.suggestedDaypart)}, ${durationLabel(d.durationMinutes)}`,
    `Capacity: ${capacityLabel(d.capacity)}`,
    `Cost: ${costLabel(d.costCents)}${d.costNote ? ` (${d.costNote})` : ""}`,
    `Setting: ${d.isOutdoor ? "Outdoors" : "Indoors"}`,
    venueLabel(d),
    d.tagIds.length ? `Tags: ${d.tagIds.map(tagName).join(", ")}` : "",
  ].filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== "")).join("\n").trim();
}

// ---------- Hand-off to the event form

export const AI_DRAFT_KEY = "dip.aiDraft.v1";
export const AI_DRAFT_TTL_MS = 60 * 60 * 1000;

/** The fields an AI draft may fill. Venue, start and end stay empty: the admin picks a real venue and time. */
export type FormPrefill = Pick<EventDraft, "title" | "description" | "tagIds" | "coverImageURL" | "costCents" | "costNote" | "capacity" | "isOutdoor">;

export function draftToPrefill(d: GeneratedEventDraft): FormPrefill {
  return {
    title: d.title,
    description: d.description,
    tagIds: d.tagIds.filter((id) => TAG_IDS.includes(id)),
    coverImageURL: COVERS.some((c) => c.url === d.coverImageURL) ? d.coverImageURL : "",
    costCents: Math.max(0, Math.round(d.costCents)),
    costNote: d.costNote,
    capacity: d.capacity,
    isOutdoor: d.isOutdoor,
  };
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveAiDraft(store: Store, draft: GeneratedEventDraft, now: number = Date.now()): void {
  store.setItem(AI_DRAFT_KEY, JSON.stringify({ draft, savedAt: now }));
}

/** Reads the hand-off once: the entry is removed whatever it holds. Entries older than an hour or malformed ones are ignored. */
export function takeAiDraft(store: Store, now: number = Date.now()): GeneratedEventDraft | null {
  let raw: string | null = null;
  try { raw = store.getItem(AI_DRAFT_KEY); store.removeItem(AI_DRAFT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { draft?: Partial<GeneratedEventDraft>; savedAt?: unknown };
    const d = parsed.draft;
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > AI_DRAFT_TTL_MS || parsed.savedAt > now + 60_000) return null;
    if (!d || typeof d.title !== "string" || typeof d.description !== "string" || !Array.isArray(d.tagIds)) return null;
    return d as GeneratedEventDraft;
  } catch { return null; }
}

// ---------- Screenshot presets (mock only)

export function presetAnswers(): Answers {
  return {
    focusTagIds: ["tag-fitness", "tag-games"], surprise: false, goal: "team_bonding", groupSize: "team", setting: "indoors",
    budget: "under_15", timing: "after_work", prompt: "Something new for the team", count: 3,
  };
}
/** Answers filled up to (not including) the given 0-based step, so the step shows its own empty state. */
export function presetFor(stepIndex: number): Answers {
  const full = presetAnswers();
  const a = emptyAnswers();
  if (stepIndex > 0) { a.focusTagIds = full.focusTagIds; }
  if (stepIndex > 1) a.goal = full.goal;
  if (stepIndex > 2) { a.groupSize = full.groupSize; a.setting = full.setting; }
  if (stepIndex > 3) { a.budget = full.budget; a.timing = full.timing; }
  return a;
}
