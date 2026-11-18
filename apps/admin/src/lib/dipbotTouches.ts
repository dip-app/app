// Pure helpers for the small Dipbot touches in the event editor: the one-time token behind "Generate suggestions"
// (quick mode on /ideas/), the answers quick mode fills in, the "Dipbot suggests" time presets and the draft kept
// while the admin visits Dipbot. No React and no network. All copy comes from aiStrings.ts.

import type { AiSuggestionQuestion, AiTiming } from "./adminTypes";
import { type Answers, emptyAnswers } from "./ideas";
import type { LabeledSuggestion } from "./suggestionLabels";
import { type DayKey, addDays, dayOfWeek, formatTime } from "./when";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// ---------- Quick mode token (a deliberate click, never a bookmark)

export const QUICK_KEY = "dip.dipbotQuick.v1";
/** The token only lives long enough to cover the navigation itself. */
export const QUICK_TTL_MS = 30_000;

/** Set by the "Generate suggestions" button right before it navigates. False when storage is blocked (the wizard then opens normally). */
export function armQuick(store: Store, now: number = Date.now()): boolean {
  try { store.setItem(QUICK_KEY, JSON.stringify({ at: now })); return true; } catch { return false; }
}

/** Reads the token once: it is removed whatever it holds. A missing, malformed, stale or future token means "not armed". */
export function takeQuick(store: Store, now: number = Date.now()): boolean {
  let raw: string | null = null;
  try { raw = store.getItem(QUICK_KEY); store.removeItem(QUICK_KEY); } catch { return false; }
  if (!raw) return false;
  try {
    const at = (JSON.parse(raw) as { at?: unknown }).at;
    return typeof at === "number" && now - at <= QUICK_TTL_MS && at <= now + 5_000;
  } catch { return false; }
}

/** Quick mode needs both the `?quick=1` link and the token from the button. */
export const quickRequested = (search: string) => new URLSearchParams(search).get("quick") === "1";

// ---------- Quick answers

/** What a step gets when Dipbot has no suggestion for it: safe, broad choices. No focus interests means "any". */
export const SAFE_DEFAULTS = {
  goal: "team_bonding", groupSize: "team", setting: "indoors", budget: "under_15", timing: "weekday_lunch",
} as const;

/** Every wizard step as Dipbot would choose it: suggested choices first, safe defaults for the rest. The note stays empty. */
export function quickAnswers(labeled: Partial<Record<AiSuggestionQuestion, LabeledSuggestion>>): Answers {
  const a = emptyAnswers();
  const pick = <K extends keyof typeof SAFE_DEFAULTS>(q: K) => (labeled[q]?.value ?? SAFE_DEFAULTS[q]) as Answers[K];
  a.focusTagIds = labeled.interest ? [labeled.interest.value] : [];
  a.goal = pick("goal");
  a.groupSize = pick("groupSize");
  a.setting = pick("setting");
  a.budget = pick("budget");
  a.timing = pick("timing");
  return a;
}

// ---------- "Dipbot suggests" time presets

export interface TimePreset {
  id: string;
  label: string;
  /** Minutes after midnight. */
  start: number;
  end: number;
  /** 0 = Sunday. When set, choosing the preset also moves the date to the next such day. */
  weekday?: number;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "12:00 to 1:00 PM": the period is written once when both ends share it. */
const range = (start: number, end: number) => {
  const a = formatTime(start), b = formatTime(end);
  return `${a.slice(-2) === b.slice(-2) ? a.slice(0, -3) : a} to ${b}`;
};

const LUNCH = { id: "lunch", label: `Lunch ${range(12 * 60, 13 * 60)}`, start: 12 * 60, end: 13 * 60 } satisfies TimePreset;
const AFTER_WORK = { id: "after-work", label: `After work ${range(17 * 60 + 30, 19 * 60 + 30)}`, start: 17 * 60 + 30, end: 19 * 60 + 30 } satisfies TimePreset;
const WEEKEND: TimePreset = { id: "weekend", label: `Sat ${range(10 * 60, 12 * 60)}`, start: 10 * 60, end: 12 * 60, weekday: 6 };

/** The two defaults, in the order the editor always showed them. */
export const DEFAULT_PRESETS: readonly TimePreset[] = [LUNCH, AFTER_WORK];

/** A best weekday and time bucket from the company's cached Dipbot data: `timing` is the Ideas bucket, `weekday` (0 to 6) is optional. */
export interface TimeHint { timing: AiTiming; weekday?: number }

/** The hint's bucket first (with its weekday when known), then a default, two chips at most. Without a hint: the defaults. */
export function timePresets(hint: TimeHint | null): readonly TimePreset[] {
  if (!hint) return DEFAULT_PRESETS;
  const base: TimePreset | null = hint.timing === "weekday_lunch" ? LUNCH : hint.timing === "after_work" ? AFTER_WORK : hint.timing === "weekend" ? WEEKEND : null;
  if (!base) return DEFAULT_PRESETS;
  const weekday = Number.isInteger(hint.weekday) && hint.weekday! >= 0 && hint.weekday! <= 6 ? hint.weekday : base.weekday;
  const first: TimePreset = weekday === undefined ? base : { ...base, weekday, label: `${WEEKDAY_SHORT[weekday]} ${range(base.start, base.end)}` };
  const rest = DEFAULT_PRESETS.filter((p) => p.id !== first.id);
  return [first, ...rest].slice(0, 2);
}

/** The first `weekday` strictly after `from`. */
export function nextWeekday(from: DayKey, weekday: number): DayKey {
  return addDays(from, ((weekday - dayOfWeek(from) + 6) % 7) + 1);
}

// The Dipbot page remembers the best timing bucket it saw in this tab, so the editor can offer it without a request.
export const TIMING_KEY = "dip.dipbotTiming.v1";
const TIMINGS: readonly string[] = ["weekday_lunch", "after_work", "weekend"];

export function rememberTimeHint(store: Store, hint: TimeHint | null): void {
  try { if (hint) store.setItem(TIMING_KEY, JSON.stringify(hint)); else store.removeItem(TIMING_KEY); } catch { /* storage blocked: the editor shows the defaults */ }
}

export function readTimeHint(store: Store): TimeHint | null {
  try {
    const raw = store.getItem(TIMING_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Partial<TimeHint>;
    if (typeof h.timing !== "string" || !TIMINGS.includes(h.timing)) return null;
    return { timing: h.timing as AiTiming, ...(typeof h.weekday === "number" ? { weekday: h.weekday } : {}) };
  } catch { return null; }
}

// ---------- The partly filled New event form, kept while the admin visits Dipbot

export const EDITOR_STASH_KEY = "dip.eventDraftStash.v1";
export const EDITOR_STASH_TTL_MS = 60 * 60 * 1000;

export function stashEditor(store: Store, value: unknown, now: number = Date.now()): void {
  try { store.setItem(EDITOR_STASH_KEY, JSON.stringify({ value, savedAt: now })); } catch { /* the form then starts fresh when the admin returns */ }
}

/** Reads the stash once. Entries older than an hour or malformed ones are ignored. */
export function takeEditorStash<T>(store: Store, now: number = Date.now()): T | null {
  let raw: string | null = null;
  try { raw = store.getItem(EDITOR_STASH_KEY); store.removeItem(EDITOR_STASH_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { value?: T; savedAt?: unknown };
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > EDITOR_STASH_TTL_MS || parsed.savedAt > now + 60_000) return null;
    return parsed.value ?? null;
  } catch { return null; }
}

// The New event form registers how to save itself; the "Generate suggestions" button calls it right before leaving.
let saveEditor: (() => void) | null = null;
export function registerEditorStash(save: (() => void) | null): void { saveEditor = save; }
export function saveEditorStash(): void { saveEditor?.(); }
