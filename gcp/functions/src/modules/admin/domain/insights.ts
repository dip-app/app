import type { InsightsActivityDay } from "../../../generated/models";

/** Pure helpers for the company insights summary (docs/contracts/admin.md, getCompanyInsightsV1). */

export const WINDOW_DAYS = 30;
/** A cached summary newer than this is served as is. */
export const CACHE_TTL_MS = 10 * 60_000;
/** `refresh: true` is honored only when the cached summary is at least this old. */
export const REFRESH_MIN_AGE_MS = 60_000;
/** Distinct-member sampling cap: reads are billed per document, so activity counts stop here (and say so). */
export const ACTIVE_SAMPLE_LIMIT = 1000;
/** Completed events considered for the attendance rate (one count query each). */
export const ATTENDANCE_SAMPLE_EVENTS = 25;
/** Recent challenges read to find the current weekly theme and the pending-review queue. */
export const RECENT_CHALLENGES = 6;

const DAY_MS = 86_400_000;

export interface DayBucket { date: string; from: Date; to: Date }

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The last `WINDOW_DAYS` UTC days, oldest first, the last one being today (so far). */
export function dayBuckets(now: Date): DayBucket[] {
  const today = utcDayStart(now).getTime();
  return Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const from = new Date(today - (WINDOW_DAYS - 1 - i) * DAY_MS);
    return { date: from.toISOString().slice(0, 10), from, to: new Date(from.getTime() + DAY_MS) };
  });
}

export function monthBounds(now: Date): { from: Date; to: Date } {
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/** Checked in over going, across the sample; null when nobody was going. Rounded to 3 digits. */
export function attendanceRate(samples: ReadonlyArray<{ going: number; checkedIn: number }>): number | null {
  const going = samples.reduce((n, s) => n + s.going, 0);
  if (going <= 0) return null;
  const checked = samples.reduce((n, s) => n + Math.min(s.checkedIn, s.going), 0);
  return Math.round((checked / going) * 1000) / 1000;
}

export function distinctStrings(values: ReadonlyArray<unknown>): number {
  return new Set(values.filter((v): v is string => typeof v === "string" && v !== "")).size;
}

export const toCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export const isDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

export function totalOf(activity: ReadonlyArray<InsightsActivityDay>, key: "rsvps" | "photos"): number {
  return activity.reduce((n, d) => n + d[key], 0);
}

/** Cache age in ms, or null when the stored cache is unusable (wrong shape, from the future). */
export function cacheAge(generatedAt: unknown, now: Date): number | null {
  if (!isDate(generatedAt)) return null;
  const age = now.getTime() - generatedAt.getTime();
  return age >= 0 ? age : null;
}

/** True when the cache can be served for this request. */
export function cacheUsable(age: number | null, refresh: boolean): boolean {
  if (age === null || age >= CACHE_TTL_MS) return false;
  return !(refresh && age >= REFRESH_MIN_AGE_MS);
}
