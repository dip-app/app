import { SUPPRESSION_THRESHOLD, bucketFor } from "../../ai/domain/interests";
import { THEME_KEYS, themeForTags, type AiDaypart, type ThemeKey } from "./catalog";

/** Company aggregates the ranking reads. Plain data in, no IO; the application layer builds this from Firestore. */
export interface PastEvent {
  title: string; tagIds: string[]; start: Date; end: Date; capacity: number; attendeeCount: number;
  status: string; isOutdoor: boolean; costCents: number;
}
export interface UpcomingEvent { start: Date; tagIds: string[] }
export interface WeeklyThemeInfo { title: string; tagIds: string[]; startDate: Date; endDate: Date }
export interface TagCount { tagId: string; memberCount: number }

export interface CompanySignals {
  now: Date;
  timeZone: string;
  memberCount: number | null;
  pastEvents: PastEvent[];
  upcomingEvents: UpcomingEvent[];
  interests: TagCount[] | null;
  interestsMonthAgo: TagCount[] | null;
  weeklyThemes: WeeklyThemeInfo[];
  /** Idea ids suggested in the previous 6 weeks. */
  recentlySuggested: string[];
  tagNames: Record<string, string>;
}

export const HISTORY_DAYS = 180;
export const PAST_EVENT_CAP = 200;
const DAY_MS = 86_400_000;
/** A past event this full counts as a standout example. */
export const BEST_FILL = 0.7;

export type Season = "winter" | "spring" | "summer" | "fall";
export type InterestBucket = "5-9" | "10-19" | "20+";

export interface LocalParts { isoWeekday: number; hour: number; year: number; month: number; day: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Calendar fields of an instant in the given IANA zone. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const out: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) out[part.type] = part.value;
  return {
    isoWeekday: WEEKDAY_INDEX[out.weekday!] ?? 1,
    hour: Number(out.hour) % 24,
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
  };
}

/** A calendar date as a Date at 00:00 UTC (a "civil date"; the time zone is already applied). */
export function civilDate(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

export function addDays(civil: Date, days: number): Date {
  return new Date(civil.getTime() + days * DAY_MS);
}

/** Monday (civil date) of the week containing the civil date. */
export function mondayOf(civil: Date): Date {
  const isoWeekday = civil.getUTCDay() === 0 ? 7 : civil.getUTCDay();
  return addDays(civil, 1 - isoWeekday);
}

/** ISO week string such as "2026-W48" for the instant in the zone. */
export function weekKey(now: Date, timeZone: string): string {
  const civil = civilDate(now, timeZone);
  const isoWeekday = civil.getUTCDay() === 0 ? 7 : civil.getUTCDay();
  const thursday = addDays(civil, 4 - isoWeekday);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function season(month: number): Season {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Week of Dec 1" for the Monday civil date. */
export function weekLabel(monday: Date): string {
  return `Week of ${MONTH_ABBR[monday.getUTCMonth()]} ${monday.getUTCDate()}`;
}

export function monthAbbr(month: number): string {
  return MONTH_ABBR[month - 1] ?? "";
}

/** The daypart an event start falls into, in the company zone. */
export function daypartOf(start: Date, timeZone: string): AiDaypart {
  const p = localParts(start, timeZone);
  if (p.isoWeekday >= 6) return p.hour < 17 ? "weekend_daytime" : "weekend_evening";
  if (p.hour < 11) return "weekday_morning";
  if (p.hour < 14) return "weekday_lunch";
  if (p.hour < 17) return "weekday_afternoon";
  return "after_work";
}

export interface ThemeStats {
  theme: ThemeKey;
  events: number;
  /** Mean of attendees / capacity (each capped at 1) over events with a capacity; null when none. */
  avgFill: number | null;
  avgAttendance: number | null;
  lastHeldDaysAgo: number | null;
  best: { title: string; attendeeCount: number; capacity: number } | null;
}

export interface InterestEntry {
  tagId: string;
  name: string;
  /** Exact members; stays on the server, only `bucket` is ever shown. */
  members: number;
  bucket: InterestBucket | null;
  /** Members now minus a month ago, when both are known. */
  growth: number | null;
}

export type DataLevel = "none" | "some" | "rich";

export interface CompanySummary {
  weekKey: string;
  timeZone: string;
  month: number;
  season: Season;
  memberCount: number | null;
  /** Eligible past events: ended, not canceled, last 180 days, newest first, at most 200. */
  eligible: PastEvent[];
  themes: Record<ThemeKey, ThemeStats>;
  weekdayFill: Record<number, number | null>;
  daypartFill: Record<AiDaypart, number | null>;
  /** First Monday after the current week (civil date). */
  nextMonday: Date;
  /** Event counts for the 4 weeks starting at next Monday. */
  busyWeeks: Array<{ weekStart: Date; events: number }>;
  /** Quietest of the first 3 busy weeks (ties go to the earliest). */
  quietestWeekStart: Date;
  /** Upcoming events starting within the next 14 days. */
  upcomingTwoWeeks: number;
  interests: InterestEntry[];
  interestsKnown: boolean;
  dataLevel: DataLevel;
}

function fillOf(e: PastEvent): number | null {
  return e.capacity > 0 ? Math.min(1, Math.max(0, e.attendeeCount / e.capacity)) : null;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function tagNameOf(signals: CompanySignals, tagId: string): string {
  const named = signals.tagNames[tagId];
  if (named) return named;
  const raw = tagId.replace(/^tag-/, "");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function eligibleEvents(signals: CompanySignals): PastEvent[] {
  const earliest = signals.now.getTime() - HISTORY_DAYS * DAY_MS;
  return signals.pastEvents
    .filter(e => e.status.toLowerCase() !== "canceled" && e.status.toLowerCase() !== "cancelled"
      && e.end.getTime() <= signals.now.getTime() && e.end.getTime() >= earliest)
    .sort((a, b) => b.end.getTime() - a.end.getTime())
    .slice(0, PAST_EVENT_CAP);
}

function themeStats(events: PastEvent[], theme: ThemeKey, now: Date): ThemeStats {
  const own = events.filter(e => themeForTags(e.tagIds) === theme);
  const fills = own.map(fillOf).filter((f): f is number => f !== null);
  const strong = own
    .filter(e => (fillOf(e) ?? 0) >= BEST_FILL)
    .sort((a, b) => (fillOf(b)! - fillOf(a)!) || b.attendeeCount - a.attendeeCount || b.end.getTime() - a.end.getTime())[0];
  const newest = own[0];
  return {
    theme,
    events: own.length,
    avgFill: mean(fills),
    avgAttendance: mean(own.map(e => e.attendeeCount)),
    lastHeldDaysAgo: newest ? Math.max(0, Math.floor((now.getTime() - newest.end.getTime()) / DAY_MS)) : null,
    best: strong ? { title: strong.title, attendeeCount: strong.attendeeCount, capacity: strong.capacity } : null,
  };
}

function summarizeInterests(signals: CompanySignals): InterestEntry[] {
  if (!signals.interests) return [];
  const before = signals.interestsMonthAgo
    ? new Map(signals.interestsMonthAgo.map(t => [t.tagId, t.memberCount]))
    : null;
  const now = new Map<string, number>();
  for (const t of signals.interests) {
    if (Number.isSafeInteger(t.memberCount) && t.memberCount >= 0) now.set(t.tagId, Math.max(now.get(t.tagId) ?? 0, t.memberCount));
  }
  return [...now.entries()]
    .map(([tagId, members]): InterestEntry => ({
      tagId,
      name: tagNameOf(signals, tagId),
      members,
      bucket: bucketFor(members),
      growth: before ? members - (before.get(tagId) ?? 0) : null,
    }))
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
}

/** Reduces raw company signals to the aggregates the ranking and the email read. */
export function summarize(signals: CompanySignals): CompanySummary {
  const { now, timeZone } = signals;
  const local = localParts(now, timeZone);
  const eligible = eligibleEvents(signals);
  const themes = Object.fromEntries(THEME_KEYS.map(k => [k, themeStats(eligible, k, now)])) as Record<ThemeKey, ThemeStats>;

  const weekdayFill: Record<number, number | null> = {};
  for (let d = 1; d <= 7; d++) {
    weekdayFill[d] = mean(eligible.filter(e => localParts(e.start, timeZone).isoWeekday === d).map(fillOf).filter((f): f is number => f !== null));
  }
  const dayparts: AiDaypart[] = ["weekday_morning", "weekday_lunch", "weekday_afternoon", "after_work", "weekend_daytime", "weekend_evening"];
  const daypartFill = Object.fromEntries(dayparts.map(dp => [
    dp, mean(eligible.filter(e => daypartOf(e.start, timeZone) === dp).map(fillOf).filter((f): f is number => f !== null)),
  ])) as Record<AiDaypart, number | null>;

  const nextMonday = addDays(mondayOf(civilDate(now, timeZone)), 7);
  const busyWeeks = [0, 1, 2, 3].map(i => {
    const weekStart = addDays(nextMonday, 7 * i);
    const end = addDays(weekStart, 7).getTime();
    const events = signals.upcomingEvents.filter(e => {
      const c = civilDate(e.start, timeZone).getTime();
      return c >= weekStart.getTime() && c < end;
    }).length;
    return { weekStart, events };
  });
  let quiet = busyWeeks[0]!;
  for (const w of busyWeeks.slice(1, 3)) if (w.events < quiet.events) quiet = w;

  const horizon = now.getTime() + 14 * DAY_MS;
  const upcomingTwoWeeks = signals.upcomingEvents.filter(e => e.start.getTime() >= now.getTime() && e.start.getTime() < horizon).length;

  const interests = summarizeInterests(signals);
  const hasInterests = interests.some(i => i.members > 0);
  const dataLevel: DataLevel = eligible.length >= 8 && hasInterests ? "rich"
    : eligible.length < 3 && !hasInterests ? "none" : "some";

  return {
    weekKey: weekKey(now, timeZone),
    timeZone,
    month: local.month,
    season: season(local.month),
    memberCount: signals.memberCount,
    eligible,
    themes,
    weekdayFill,
    daypartFill,
    nextMonday,
    busyWeeks,
    quietestWeekStart: quiet.weekStart,
    upcomingTwoWeeks,
    interests,
    interestsKnown: signals.interests !== null,
    dataLevel,
  };
}

export { SUPPRESSION_THRESHOLD, tagNameOf };
