// @i18n-migrated
// Pure logic for the Dipbot flow (AI drafts): steps, answers, labels, request id reuse, and the hand-off from a
// generated draft to the event form. No React and no network, so it is unit tested directly. Every user-facing
// string comes from aiStrings.ts.

import type {
  AiBudget, AiDaypart, AiEventChoices, AiGoal, AiGroupSize, AiSetting, AiTiming, AiVenueType, GeneratedEventDraft,
} from "./adminTypes";
import { type AiStringKey, t as tAi, tn } from "./aiStrings";
import { type MessageKey, t } from "./i18n";
import { TAG_IDS } from "./catalog";
import { MAX_CONSIDERATIONS, isConsiderationId } from "./considerations";
import { coverByURL } from "./covers";
import type { EventDraft } from "./contract";

export const MAX_FOCUS = 3;
export const MAX_PROMPT = 500;

export type StepId = "interests" | "goal" | "group" | "budget" | "note";
const STEP_IDS: StepId[] = ["interests", "goal", "group", "budget", "note"];
/** `label` is the short stepper text; `full` is the whole wording for names, tooltips and the summary. */
/** The texts are getters, so they follow the current language each time they are read. */
export const STEPS: { id: StepId; label: string; full: string; heading: string }[] = STEP_IDS.map((id) => ({
  id,
  get label() { return tAi(`step.${id}.label` as AiStringKey); },
  get full() { return tAi(`step.${id}.full` as AiStringKey); },
  get heading() { return tAi(`step.${id}.heading` as AiStringKey); },
}));

interface Option<T extends string> { value: T; label: string; hint: string }
function options<T extends string>(group: "goal" | "size" | "setting" | "budget" | "timing", values: readonly T[]): Option<T>[] {
  return values.map((value) => ({
    value,
    get label() { return tAi(`${group}.${value}` as AiStringKey); },
    get hint() { return tAi(`${group}.${value}.hint` as AiStringKey); },
  }));
}
export const GOALS = options<AiGoal>("goal", ["team_bonding", "wellness", "learning", "give_back", "celebrate", "competition"]);
export const GROUP_SIZES = options<AiGroupSize>("size", ["small", "team", "company"]);
export const SETTINGS = options<AiSetting>("setting", ["indoors", "outdoors", "offsite"]);
export const BUDGETS = options<AiBudget>("budget", ["free", "under_15", "from_15_to_50", "over_50"]);
export const TIMINGS = options<AiTiming>("timing", ["weekday_lunch", "after_work", "weekend"]);


export interface Answers {
  /** Empty means any interest can fit (the server treats no focus tags that way). */
  focusTagIds: string[];
  goal: AiGoal | null;
  groupSize: AiGroupSize | null;
  setting: AiSetting | null;
  budget: AiBudget | null;
  timing: AiTiming | null;
  prompt: string;
  /** Chosen consideration ids (catalog in considerations.ts). They stay when steps change and when the ranking refreshes. */
  considerations: string[];
  count: 1 | 2 | 3;
}

export function emptyAnswers(): Answers {
  return { focusTagIds: [], goal: null, groupSize: null, setting: null, budget: null, timing: null, prompt: "", considerations: [], count: 3 };
}

/** Toggles one consideration: at most MAX_CONSIDERATIONS, and only catalog ids. Removing is always allowed. */
export function toggleConsideration(answers: Answers, id: string): Answers {
  if (answers.considerations.includes(id)) return { ...answers, considerations: answers.considerations.filter((c) => c !== id) };
  if (!isConsiderationId(id) || answers.considerations.length >= MAX_CONSIDERATIONS) return answers;
  return { ...answers, considerations: [...answers.considerations, id] };
}

/** Toggles one interest: at most MAX_FOCUS; extra picks are ignored. */
export function toggleInterest(answers: Answers, tagId: string): Answers {
  if (answers.focusTagIds.includes(tagId)) return { ...answers, focusTagIds: answers.focusTagIds.filter((id) => id !== tagId) };
  if (answers.focusTagIds.length >= MAX_FOCUS) return answers;
  return { ...answers, focusTagIds: [...answers.focusTagIds, tagId] };
}

export function stepValid(step: StepId, a: Answers): boolean {
  switch (step) {
    case "interests": return true;
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
  if (!a.goal || !a.groupSize || !a.setting || !a.budget || !a.timing) return null;
  return { focusTagIds: [...a.focusTagIds], goal: a.goal, groupSize: a.groupSize, setting: a.setting, budget: a.budget, timing: a.timing };
}

const labelOf = <T extends string>(options: Option<T>[], value: T | null) => options.find((o) => o.value === value)?.label ?? "";

/** `empty` is true for a line that reads "Not set" or "None" (the display text is never compared). */
export interface SummaryLine { step: number; label: string; value: string; empty: boolean }
/** The "Your choices" list. Unanswered lines read "Not set". */
export function summaryLines(a: Answers, tagName: (id: string) => string): SummaryLine[] {
  const interests = a.focusTagIds.map(tagName).join(", ") || tAi("interests.any");
  const group = [labelOf(GROUP_SIZES, a.groupSize), labelOf(SETTINGS, a.setting)].filter(Boolean).join(", ");
  const budget = [labelOf(BUDGETS, a.budget), labelOf(TIMINGS, a.timing)].filter(Boolean).join(", ");
  const note = a.prompt.trim();
  const prefs = a.considerations.length > 0 ? tn("consider.rail", a.considerations.length) : "";
  const notSet = tAi("rail.notSet");
  const goal = labelOf(GOALS, a.goal);
  const extra = [prefs, note ? (note.length > 60 ? `${note.slice(0, 57)}...` : note) : ""].filter(Boolean).join(", ");
  return [
    { step: 0, label: STEPS[0].full, value: interests, empty: false },
    { step: 1, label: STEPS[1].full, value: goal || notSet, empty: !goal },
    { step: 2, label: STEPS[2].full, value: group || notSet, empty: !group },
    { step: 3, label: STEPS[3].full, value: budget || notSet, empty: !budget },
    { step: 4, label: STEPS[4].full, value: extra || tAi("rail.none"), empty: !extra },
  ];
}

export type Bucket = "5-9" | "10-19" | "20+";
export const bucketText = (bucket: Bucket) => tAi(`bucket.${bucket}`);
export const bucketLevel = (bucket: Bucket) => (bucket === "20+" ? 3 : bucket === "10-19" ? 2 : 1);

// ---------- Request ids

/** What a request is: the same choices, note and count produce the same signature. */
export function signatureOf(choices: AiEventChoices, prompt: string, count: number, considerations: readonly string[] = []): string {
  return JSON.stringify([choices.focusTagIds, choices.goal, choices.groupSize, choices.setting, choices.budget, choices.timing, prompt.trim(), count, [...considerations].sort()]);
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

const DAYPART_KEY: Record<AiDaypart, MessageKey> = {
  weekday_morning: "dipbot.draft.daypart.weekdayMorning", weekday_lunch: "dipbot.draft.daypart.weekdayLunch",
  weekday_afternoon: "dipbot.draft.daypart.weekdayAfternoon", after_work: "dipbot.draft.daypart.afterWork",
  weekend_daytime: "dipbot.draft.daypart.weekendDaytime", weekend_evening: "dipbot.draft.daypart.weekendEvening",
};
export const daypartLabel = (value: AiDaypart) => t(DAYPART_KEY[value] ?? "dipbot.draft.daypart.flexible");

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("dipbot.draft.duration.minutes", { minutes: rest });
  return rest === 0 ? t("dipbot.draft.duration.hours", { hours }) : t("dipbot.draft.duration.hoursMinutes", { hours, minutes: rest });
}
export const capacityLabel = (capacity: number) => t("dipbot.draft.capacity", { capacity });
export function costLabel(costCents: number): string {
  if (costCents <= 0) return t("dipbot.draft.free");
  const dollars = costCents / 100;
  return t("dipbot.draft.costPerPerson", { amount: Number.isInteger(dollars) ? dollars : dollars.toFixed(2) });
}
const VENUE_KEY: Record<AiVenueType, MessageKey> = {
  office: "dipbot.draft.venue.office", park_or_outdoors: "dipbot.draft.venue.park", restaurant_or_cafe: "dipbot.draft.venue.restaurant",
  activity_venue: "dipbot.draft.venue.activity", community_site: "dipbot.draft.venue.community",
};
/** "Venue idea: bowling alley" (the hint when the model gave one, otherwise the venue type). */
export function venueLabel(draft: Pick<GeneratedEventDraft, "venueType" | "venueSearchHint">): string {
  return t("dipbot.draft.venue.idea", { venue: draft.venueSearchHint.trim() || t(VENUE_KEY[draft.venueType] ?? "dipbot.draft.venue.tbd") });
}

/** Plain text for "Copy text". */
export function draftText(d: GeneratedEventDraft, tagName: (id: string) => string): string {
  const cost = costLabel(d.costCents);
  return [
    d.title, "", d.description, "",
    t("dipbot.draft.copy.when", { daypart: daypartLabel(d.suggestedDaypart), duration: durationLabel(d.durationMinutes) }),
    t("dipbot.draft.copy.capacity", { capacity: capacityLabel(d.capacity) }),
    d.costNote ? t("dipbot.draft.copy.costNote", { cost, note: d.costNote }) : t("dipbot.draft.copy.cost", { cost }),
    t("dipbot.draft.copy.setting", { setting: tAi(d.isOutdoor ? "draft.outdoors" : "draft.indoors") }),
    venueLabel(d),
    d.tagIds.length ? t("dipbot.draft.copy.tags", { tags: d.tagIds.map(tagName).join(", ") }) : "",
  ].filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== "")).join("\n").trim();
}

// ---------- Hand-off to the event form

export const AI_DRAFT_KEY = "dip.aiDraft.v1";
export const AI_DRAFT_TTL_MS = 60 * 60 * 1000;

/** The fields an AI draft may fill. Venue, start and end stay empty: the admin picks a real venue and time. */
export type FormPrefill = Pick<EventDraft, "title" | "description" | "tagIds" | "coverImageURL" | "costCents" | "costNote" | "capacity" | "isOutdoor">;

/** `knownTagIds` is the loaded catalog's IDs (opaque in production); tags outside it are dropped. Without it, the bundled mock IDs apply. */
export function draftToPrefill(d: GeneratedEventDraft, knownTagIds: readonly string[] = TAG_IDS): FormPrefill {
  return {
    title: d.title,
    description: d.description,
    tagIds: d.tagIds.filter((id) => knownTagIds.includes(id)),
    coverImageURL: coverByURL(d.coverImageURL) ? d.coverImageURL : "",
    costCents: Math.max(0, Math.round(d.costCents)),
    costNote: d.costNote,
    capacity: d.capacity,
    isOutdoor: d.isOutdoor,
  };
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A draft handed to the editor. `coverBy` says whether the cover is still Dipbot's own pick (the editor then shows "Dipbot picked this"). */
export type HandedAiDraft = GeneratedEventDraft & { coverBy?: "dipbot" | "admin" };

export function saveAiDraft(store: Store, draft: GeneratedEventDraft, now: number = Date.now(), coverBy: "dipbot" | "admin" = "dipbot"): void {
  store.setItem(AI_DRAFT_KEY, JSON.stringify({ draft: { ...draft, coverBy }, savedAt: now }));
}

/** Reads the hand-off once: the entry is removed whatever it holds. Entries older than an hour or malformed ones are ignored. */
export function takeAiDraft(store: Store, now: number = Date.now()): HandedAiDraft | null {
  let raw: string | null = null;
  try { raw = store.getItem(AI_DRAFT_KEY); store.removeItem(AI_DRAFT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { draft?: Partial<GeneratedEventDraft>; savedAt?: unknown };
    const d = parsed.draft;
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > AI_DRAFT_TTL_MS || parsed.savedAt > now + 60_000) return null;
    if (!d || typeof d.title !== "string" || typeof d.description !== "string" || !Array.isArray(d.tagIds)) return null;
    return d as HandedAiDraft;
  } catch { return null; }
}

// ---------- Screenshot presets (mock only)

export function presetAnswers(): Answers {
  return {
    focusTagIds: ["tag-fitness", "tag-games"], goal: "team_bonding", groupSize: "team", setting: "indoors",
    budget: "under_15", timing: "after_work", prompt: "", considerations: ["something_new", "vegetarian"], count: 3,
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
