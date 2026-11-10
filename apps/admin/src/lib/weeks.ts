// Week arithmetic for weekly themes. A theme runs from Monday 00:00 to Sunday 23:59:59 in Eastern Time
// (the shared spec: "Monday 00:00 America/New_York to the following Monday 00:00 minus 1 s"), whatever
// time zone the organizer's browser is in, so the portal, the seed script and the app agree on "this week".
// No date library: Intl gives the zone offset, and civil dates ("YYYY-MM-DD") are handled in UTC.

export const THEME_TIME_ZONE = "America/New_York";
export const THEME_TIME_ZONE_LABEL = "Eastern Time";

const DAY_MS = 86_400_000;

/** A calendar date with no time or zone, "YYYY-MM-DD". */
export type CivilDate = string;

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(instant: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Milliseconds the zone is ahead of UTC at `instant` (Eastern: -4 h in summer, -5 h in winter). */
function zoneOffset(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function parseCivil(date: CivilDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatCivil(utcMidnight: number): CivilDate {
  return new Date(utcMidnight).toISOString().slice(0, 10);
}

/** The calendar date of `instant` in the zone. */
export function civilDateIn(instant: Date | number, timeZone = THEME_TIME_ZONE): CivilDate {
  const p = zonedParts(typeof instant === "number" ? instant : instant.getTime(), timeZone);
  return formatCivil(Date.UTC(p.year, p.month - 1, p.day));
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return formatCivil(parseCivil(date) + days * DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: CivilDate): number {
  return new Date(parseCivil(date)).getUTCDay();
}

/** The Monday on or before `date`. */
export function mondayOf(date: CivilDate): CivilDate {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** The UTC instant of 00:00 on `date` in the zone, DST-aware. */
export function startOfDay(date: CivilDate, timeZone = THEME_TIME_ZONE): Date {
  const guess = parseCivil(date);
  let instant = guess - zoneOffset(guess, timeZone);
  // Re-check at the result: the offset can differ when a DST change falls between the guess and midnight.
  instant = guess - zoneOffset(instant, timeZone);
  return new Date(instant);
}

/** Window start for a theme that begins in the week of `monday`: Monday 00:00 Eastern, as RFC 3339 UTC. */
export function weekStartIso(monday: CivilDate): string {
  return startOfDay(monday).toISOString();
}

/** Window end for a theme whose last day is `sunday`: Sunday 23:59:59 Eastern (next Monday minus 1 s). */
export function weekEndIso(sunday: CivilDate): string {
  return new Date(startOfDay(addDays(sunday, 1)).getTime() - 1000).toISOString();
}

/** The Monday that starts the Eastern week containing `iso` (the window's first day for a start time). */
export function mondayOfIso(iso: string): CivilDate {
  return mondayOf(civilDateIn(Date.parse(iso)));
}

/** The calendar day (Eastern) a window end falls on. */
export function lastDayOfIso(iso: string): CivilDate {
  return civilDateIn(Date.parse(iso));
}

/** Monday of the week after the current Eastern week: the default for a new theme. */
export function nextMonday(now: Date = new Date()): CivilDate {
  return addDays(mondayOf(civilDateIn(now)), 7);
}

/** `count` consecutive Mondays starting at `first`. */
export function mondays(first: CivilDate, count: number): CivilDate[] {
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

/** "Nov 9" (with the year when `withYear`), read as a calendar date, not converted. */
export function formatDay(date: CivilDate, withYear = false): string {
  return new Date(parseCivil(date)).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "Nov 9 – Nov 15, 2026": the window's first and last day in Eastern Time. */
export function formatWindow(startIso: string, endIso: string): string {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end)) return "";
  const first = civilDateIn(start);
  const last = civilDateIn(end);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${formatDay(first, !sameYear)} – ${formatDay(last, true)}`;
}

/** True when the window is exactly whole Eastern weeks (Monday 00:00 to Sunday 23:59:59). */
export function isWeekAligned(startIso: string, endIso: string): boolean {
  const monday = mondayOfIso(startIso);
  const last = lastDayOfIso(endIso);
  return weekStartIso(monday) === new Date(Date.parse(startIso)).toISOString()
    && weekday(last) === 0
    && weekEndIso(last) === new Date(Date.parse(endIso)).toISOString();
}
