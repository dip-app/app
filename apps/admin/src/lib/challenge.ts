// Weekly themes: a theme IS a `Challenge` document (contracts/v1/models.schema.json) at
// companies/{companyId}/challenges/{challengeId} with `type: "weekly"` and a `catalog://theme/<key>` cover.
// Mirrors the createChallengeV1/updateChallengeV1 drafts from the weekly theme spec (T1). The server stays
// the authority; this validation only shows errors before submitting.

import type { FieldErrors } from "./contract";
import { THEME_URLS } from "./themes";
import {
  type CivilDate, addDays, civilDateIn, formatDay, formatWindow, lastDayOfIso, mondayOf, mondayOfIso, mondays, weekEndIso,
  weekStartIso,
} from "./weeks";

export interface ThemeDraft {
  title: string;
  description: string;
  tagIds: string[];
  type: "weekly";
  goal: number;
  goalUnit: string;
  coverImageURL: string;
  startDate: string; // RFC 3339 UTC
  endDate: string;
  pointsReward: number;
}

export interface WeeklyTheme extends ThemeDraft {
  id: string;
  companyId: string;
  /** Server-owned; never part of a draft. */
  participantCount: number;
  completedCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** createChallengeV1 / updateChallengeV1 answers (the portal keeps the id and revision). */
export interface ThemeCommandResult {
  challengeId: string;
  revision: number;
  /** createChallengeV1 only: true when a retry returned the theme an earlier attempt created. */
  replayed?: boolean;
}

export const THEME_LIMITS = {
  titleMax: 60,
  descriptionMax: 1000,
  goalMax: 10000,
  goalUnitMax: 24,
  pointsMax: 1000,
  maxSpanDays: 14,
  maxTags: 10,
} as const;

/** The server's window lock (WINDOW_CHANGE_BLOCKED) applies once anyone has joined or completed. */
export function windowLocked(theme: { participantCount: number; completedCount: number }): boolean {
  return theme.participantCount > 0 || theme.completedCount > 0;
}

/** Stable server reasons (HttpsError details.reason) the theme screens react to. */
export const THEME_REASONS = {
  overlap: "CHALLENGE_WINDOW_OVERLAP",
  notFound: "CHALLENGE_NOT_FOUND",
  windowLocked: "WINDOW_CHANGE_BLOCKED",
  revisionConflict: "REVISION_CONFLICT",
  requestReused: "REQUEST_REUSED",
} as const;

const SPAN_MS = THEME_LIMITS.maxSpanDays * 86_400_000;

/**
 * The wire payload: exactly the ThemeDraft fields, trimmed. Forms hold a full theme (id, counts, revision);
 * the server rejects unknown keys and owns the counts, so the projection is explicit.
 */
export function normalizeThemeDraft(draft: ThemeDraft): ThemeDraft {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    tagIds: [...draft.tagIds],
    type: "weekly",
    goal: draft.goal,
    goalUnit: draft.goalUnit.trim(),
    coverImageURL: draft.coverImageURL,
    startDate: draft.startDate,
    endDate: draft.endDate,
    pointsReward: draft.pointsReward,
  };
}

/** `now` (create only): the server refuses a new theme whose window has already ended. */
export function validateThemeDraft(draft: ThemeDraft, options: { knownTagIds?: string[]; now?: Date } = {}): FieldErrors {
  const errors: FieldErrors = {};
  const title = draft.title.trim();
  if (title.length < 1 || title.length > THEME_LIMITS.titleMax) errors.title = `Title must be 1–${THEME_LIMITS.titleMax} characters.`;
  const description = draft.description.trim();
  if (description.length < 1 || description.length > THEME_LIMITS.descriptionMax) {
    errors.description = `Description must be 1–${THEME_LIMITS.descriptionMax} characters.`;
  }
  if (!THEME_URLS.includes(draft.coverImageURL)) errors.coverImageURL = "Pick a theme from the catalog.";
  if (!(Number.isFinite(draft.goal) && draft.goal > 0 && draft.goal <= THEME_LIMITS.goalMax)) {
    errors.goal = `Goal must be more than 0 and at most ${THEME_LIMITS.goalMax.toLocaleString("en-US")}.`;
  }
  const unit = draft.goalUnit.trim();
  if (unit.length < 1 || unit.length > THEME_LIMITS.goalUnitMax) errors.goalUnit = `Unit must be 1–${THEME_LIMITS.goalUnitMax} characters.`;
  if (!Number.isInteger(draft.pointsReward) || draft.pointsReward < 0 || draft.pointsReward > THEME_LIMITS.pointsMax) {
    errors.pointsReward = `Points must be a whole number from 0 to ${THEME_LIMITS.pointsMax}.`;
  }
  const start = Date.parse(draft.startDate);
  const end = Date.parse(draft.endDate);
  if (Number.isNaN(start)) errors.startDate = "Choose the first week.";
  if (Number.isNaN(end)) errors.endDate = "Choose the last week.";
  if (!errors.startDate && !errors.endDate) {
    if (end <= start) errors.endDate = "The last week can’t end before the first week starts.";
    else if (end - start > SPAN_MS) errors.endDate = `A theme can run for at most ${THEME_LIMITS.maxSpanDays} days (two weeks).`;
    else if (options.now && end <= options.now.getTime()) errors.endDate = "These weeks have already passed. Pick this week or a later one.";
  }
  if (options.knownTagIds && draft.tagIds.some((id) => !options.knownTagIds!.includes(id))) errors.tagIds = "Choose tags from the list.";
  if (new Set(draft.tagIds).size !== draft.tagIds.length) errors.tagIds = "Choose each tag once.";
  if (draft.tagIds.length > THEME_LIMITS.maxTags) errors.tagIds = `Choose at most ${THEME_LIMITS.maxTags} tags.`;
  return errors;
}

/** Windows are inclusive (the end is Sunday 23:59:59), so touching weeks never overlap. */
export function windowsOverlap(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean {
  return Date.parse(a.startDate) <= Date.parse(b.endDate) && Date.parse(b.startDate) <= Date.parse(a.endDate);
}

/** The first other weekly theme whose window overlaps `window` (one current theme per company). */
export function findOverlap(
  window: { startDate: string; endDate: string },
  themes: WeeklyTheme[],
  excludeId?: string,
): WeeklyTheme | undefined {
  return themes.find((theme) => theme.id !== excludeId && theme.type === "weekly" && windowsOverlap(window, theme));
}

/** "Overlaps “Fitness” (Nov 9 – Nov 15, 2026). Pick a free week." */
export function overlapMessage(conflict: WeeklyTheme): string {
  return `Overlaps “${conflict.title}” (${formatWindow(conflict.startDate, conflict.endDate)}). Pick a week without a theme.`;
}

export interface WeekOption {
  /** Monday (start picker) or Sunday (end picker), "YYYY-MM-DD". */
  value: CivilDate;
  label: string;
  /** The theme already running then, when the option would overlap it. */
  takenBy?: WeeklyTheme;
}

/** How many Mondays the start picker offers, from the current week on. */
export const WEEKS_AHEAD = 26;

/**
 * Start picker: Mondays from this Eastern week on (plus the theme's own, older start when editing), each
 * marked when a one-week theme starting then would overlap another theme. Dropdowns instead of
 * `<input type="week">`, which Safari and Firefox don't support.
 */
export function startWeekOptions(themes: WeeklyTheme[], now: Date, options: { excludeId?: string; currentStart?: string } = {}): WeekOption[] {
  const values = mondays(mondayOf(civilDateIn(now)), WEEKS_AHEAD + 1);
  if (options.currentStart && !Number.isNaN(Date.parse(options.currentStart))) {
    const own = mondayOfIso(options.currentStart);
    if (!values.includes(own)) values.unshift(own);
  }
  return values.map((monday) => ({
    value: monday,
    label: `Week of Mon, ${formatDay(monday, true)}`,
    takenBy: findOverlap({ startDate: weekStartIso(monday), endDate: weekEndIso(addDays(monday, 6)) }, themes, options.excludeId),
  }));
}

/** End picker: the Sunday of the first week or of the next one (at most 14 days), plus a non-aligned stored end. */
export function endWeekOptions(themes: WeeklyTheme[], startDate: string, options: { excludeId?: string; currentEnd?: string } = {}): WeekOption[] {
  if (Number.isNaN(Date.parse(startDate))) return [];
  const monday = mondayOfIso(startDate);
  const values = [addDays(monday, 6), addDays(monday, 13)];
  const own = options.currentEnd && !Number.isNaN(Date.parse(options.currentEnd)) ? lastDayOfIso(options.currentEnd) : undefined;
  if (own && !values.includes(own)) values.push(own);
  return values.map((sunday, index) => ({
    value: sunday,
    label: `Sun, ${formatDay(sunday, true)}${index === 0 ? " (1 week)" : index === 1 ? " (2 weeks)" : ""}`,
    takenBy: findOverlap({ startDate, endDate: weekEndIso(sunday) }, themes, options.excludeId),
  }));
}

/** The first Monday from `from` whose one-week window is free: the default week for a new theme. */
export function firstFreeMonday(themes: WeeklyTheme[], from: CivilDate): CivilDate {
  for (let week = 0; week <= WEEKS_AHEAD; week += 1) {
    const monday = addDays(from, week * 7);
    if (!findOverlap({ startDate: weekStartIso(monday), endDate: weekEndIso(addDays(monday, 6)) }, themes)) return monday;
  }
  return from;
}

export type ThemePhase = "current" | "upcoming" | "past";

/** Classified from the window only. */
export function themePhase(theme: { startDate: string; endDate: string }, now: Date = new Date()): ThemePhase {
  const at = now.getTime();
  if (Date.parse(theme.endDate) < at) return "past";
  return Date.parse(theme.startDate) > at ? "upcoming" : "current";
}

/** Upcoming soonest first; current and past newest first. */
export function sortThemes(themes: WeeklyTheme[], phase: ThemePhase): WeeklyTheme[] {
  const sign = phase === "upcoming" ? 1 : -1;
  return [...themes].sort((a, b) => sign * (Date.parse(a.startDate) - Date.parse(b.startDate)));
}

/** "3 workouts" (the unit is stored as typed, so singular goals read as written). */
export function formatGoal(goal: number, unit: string): string {
  if (!Number.isFinite(goal)) return unit.trim();
  return `${goal.toLocaleString("en-US")} ${unit.trim()}`.trim();
}

export function formatReward(points: number): string {
  return Number.isInteger(points) ? `+${points} points` : "";
}
