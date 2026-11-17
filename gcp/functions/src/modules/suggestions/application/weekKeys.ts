import { weekKey as weekKeyOf } from "../domain/signals";

const DAY_MS = 86_400_000;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

/** The ISO week key `weeks` weeks before (negative: after) the given one, for example `shiftWeekKey("2026-W02", 3)` = "2025-W51". */
export function shiftWeekKey(weekKey: string, weeks: number): string {
  const match = WEEK_KEY.exec(weekKey);
  if (!match) throw new Error("invalid week key");
  const year = Number(match[1]);
  const week = Number(match[2]);
  // January 4th is always in ISO week 1; step back to that week's Monday, then forward to the requested week.
  const jan4 = Date.UTC(year, 0, 4, 12);
  const isoWeekday = new Date(jan4).getUTCDay() === 0 ? 7 : new Date(jan4).getUTCDay();
  const monday = jan4 - (isoWeekday - 1) * DAY_MS + (week - 1) * 7 * DAY_MS;
  return weekKeyOf(new Date(monday - weeks * 7 * DAY_MS), "UTC");
}

/** Week keys of the six weeks before this one, newest first. */
export const previousSixWeeks = (weekKey: string): string[] => [1, 2, 3, 4, 5, 6].map(n => shiftWeekKey(weekKey, n));

/** Candidates for the interest snapshot "about four weeks ago", nearest first (4, then 3, then 5 weeks back). */
export const aboutFourWeeksBack = (weekKey: string): string[] => [4, 3, 5].map(n => shiftWeekKey(weekKey, n));
