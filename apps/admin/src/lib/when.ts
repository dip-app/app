// @i18n-migrated
import { intlLocale, t } from "@/lib/i18n";

/**
 * Pure logic behind the event "When" picker: day keys, the two-click range machine, the clock-dial math,
 * 12-hour text, DST helpers and the ISO round trip. No React, no DOM.
 *
 * Times are local wall-clock time in the viewer's zone; the contract stores RFC 3339 UTC, so the conversion is the
 * same `new Date(local).toISOString()` the editor always used (`localInputToIso`).
 */

/** "YYYY-MM-DD" in local time. Lexicographic order is chronological order. */
export type DayKey = string;

export const STEP = 15; // minutes
export const DAY_MIN = 24 * 60;
export const HALF_DAY = 12 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(key: DayKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m: m - 1, d };
}

/** Whole calendar days added to a day key (DST-safe: works on the calendar, not on 24h blocks). */
export function addDays(key: DayKey, days: number): DayKey {
  const { y, m, d } = parseDay(key);
  return dayKey(new Date(y, m, d + days));
}

/** Adds months and clamps the day (Jan 31 + 1 month = Feb 28). */
export function addMonths(key: DayKey, months: number): DayKey {
  const { y, m, d } = parseDay(key);
  const first = new Date(y, m + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return dayKey(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}

export function dayDiff(a: DayKey, b: DayKey): number {
  const pa = parseDay(a), pb = parseDay(b);
  return Math.round((Date.UTC(pb.y, pb.m, pb.d) - Date.UTC(pa.y, pa.m, pa.d)) / 86_400_000);
}

export function dayOfWeek(key: DayKey): number {
  const { y, m, d } = parseDay(key);
  return new Date(y, m, d).getDay(); // 0 = Sunday
}

/** The cells of a month grid, Sunday first, padded with neighbouring days to whole weeks. */
export function monthGrid(month: DayKey): DayKey[][] {
  const { y, m } = parseDay(month);
  const first = dayKey(new Date(y, m, 1));
  const start = addDays(first, -dayOfWeek(first));
  const count = Math.ceil((dayOfWeek(first) + new Date(y, m + 1, 0).getDate()) / 7);
  return Array.from({ length: count }, (_, week) => Array.from({ length: 7 }, (_, i) => addDays(start, week * 7 + i)));
}

// ---------------------------------------------------------------- range selection (two clicks)

export interface RangeState {
  start: DayKey;
  end: DayKey;
  /** "picking": the first click was made and the next click chooses the end. "done": both ends are set. */
  phase: "picking" | "done";
}

/**
 * One click on a day.
 * - done, click outside the range: a fresh range starts there (phase picking).
 * - done, click inside the range: the nearer endpoint moves to that day (ties move the end).
 * - picking, same day: a single-day event.
 * - picking, before the start: the start moves to the click and the first day becomes the end.
 * - picking, after the start: the click is the end.
 */
export function clickDay(state: RangeState, day: DayKey): RangeState {
  if (state.phase === "done") {
    if (day < state.start || day > state.end) return { start: day, end: day, phase: "picking" };
    const toStart = dayDiff(state.start, day);
    const toEnd = dayDiff(day, state.end);
    return toStart < toEnd ? { ...state, start: day } : { ...state, end: day };
  }
  if (day < state.start) return { start: day, end: state.start, phase: "done" };
  return { start: state.start, end: day, phase: "done" };
}

/** The range to paint: while picking, the hovered day previews the end. */
export function previewRange(state: RangeState, hover: DayKey | null): { start: DayKey; end: DayKey } {
  if (state.phase !== "picking" || !hover) return { start: state.start, end: state.end };
  return hover < state.start ? { start: hover, end: state.start } : { start: state.start, end: hover };
}

/** Where a key moves the calendar focus; null for keys that do not navigate. */
export function calendarKey(key: string, focus: DayKey, shift = false): DayKey | null {
  switch (key) {
    case "ArrowLeft": return addDays(focus, -1);
    case "ArrowRight": return addDays(focus, 1);
    case "ArrowUp": return addDays(focus, -7);
    case "ArrowDown": return addDays(focus, 7);
    case "PageUp": return addMonths(focus, shift ? -12 : -1);
    case "PageDown": return addMonths(focus, shift ? 12 : 1);
    case "Home": return addDays(focus, -dayOfWeek(focus));
    case "End": return addDays(focus, 6 - dayOfWeek(focus));
    default: return null;
  }
}

// ---------------------------------------------------------------- clock dial

/** Clock angle in degrees, 0 at 12 o'clock, clockwise, for a time of day on the 12-hour face. */
export function minutesToAngle(minutes: number): number {
  return ((((minutes % HALF_DAY) + HALF_DAY) % HALF_DAY) / HALF_DAY) * 360;
}

/** Minutes on the 12-hour face (0 to 719) for a clock angle, snapped to 15 minutes. */
export function angleToFaceMinutes(angle: number): number {
  const wrapped = ((angle % 360) + 360) % 360;
  return (Math.round((wrapped / 360) * HALF_DAY / STEP) * STEP) % HALF_DAY;
}

/** Pointer position relative to the dial centre to a clock angle (0 = up, clockwise). */
export function pointToAngle(dx: number, dy: number): number {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Dragging a handle: the new time of day from a pointer angle and the handle's previous time of day. Passing 12 on the
 * face (11:45 to 12:00 either way) flips AM/PM, so one lap of the dial reads like a clock.
 */
export function dragMinutes(angle: number, previous: number): number {
  const face = angleToFaceMinutes(angle);
  const before = previous % HALF_DAY;
  const pm = previous >= HALF_DAY;
  // A jump from the last three hours of the face to the first three (or back) is the pointer passing 12.
  const crossed = (before >= 540 && face < 180) || (before < 180 && face >= 540);
  return (crossed ? (pm ? 0 : 1) : (pm ? 1 : 0)) * HALF_DAY + face;
}

/** Keyboard on a handle: arrows 15 minutes, PageUp/PageDown an hour, Home/End the day edges. Null when not handled. */
export function sliderKey(key: string, minutes: number): number | null {
  const clamp = (n: number) => Math.min(DAY_MIN - STEP, Math.max(0, n));
  switch (key) {
    case "ArrowLeft": case "ArrowDown": return clamp(minutes - STEP);
    case "ArrowRight": case "ArrowUp": return clamp(minutes + STEP);
    case "PageDown": return clamp(minutes - 60);
    case "PageUp": return clamp(minutes + 60);
    case "Home": return 0;
    case "End": return DAY_MIN - STEP;
    default: return null;
  }
}

export function snap(minutes: number): number {
  return Math.min(DAY_MIN - STEP, Math.max(0, Math.round(minutes / STEP) * STEP));
}

// ---------------------------------------------------------------- 12-hour text

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${h % 12 || 12}:${pad(minutes % 60)} ${h >= 12 ? "PM" : "AM"}`;
}

export function isPm(minutes: number): boolean {
  return minutes >= HALF_DAY;
}

/** Switches AM/PM keeping the clock reading ("6:30 AM" to "6:30 PM"). */
export function withPeriod(minutes: number, pm: boolean): number {
  return (minutes % HALF_DAY) + (pm ? HALF_DAY : 0);
}

/**
 * Typed time to minutes after midnight. Accepts "6:30 pm", "6pm", "630p", "18:30" and "6:30" (the latter takes the
 * period of `fallbackPm`). Null when it is not a time.
 */
export function parseTime(text: string, fallbackPm = false): number | null {
  const match = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (minute > 59) return null;
  const suffix = match[3]?.toLowerCase();
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (suffix === "p" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  } else if (hour >= 1 && hour <= 12) {
    hour = (hour % 12) + (fallbackPm ? 12 : 0); // no AM/PM typed: keep the field's current period
  }
  return hour * 60 + minute;
}

/** Short units ("1d 2h 5m") for every part that is not zero. */
export function durationParts(minutes: number): string[] {
  const days = Math.floor(minutes / DAY_MIN);
  const hours = Math.floor((minutes % DAY_MIN) / 60);
  const mins = minutes % 60;
  return [days && t("editor.when.dayShort", { n: days }), hours && t("editor.when.hourShort", { n: hours }), mins && t("editor.when.minuteShort", { n: mins })].filter(Boolean) as string[];
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return t("editor.when.minuteShort", { n: 0 });
  return durationParts(minutes).join(" ");
}

export function describeDuration(minutes: number): string {
  const days = Math.floor(minutes / DAY_MIN);
  const hours = Math.floor((minutes % DAY_MIN) / 60);
  const mins = minutes % 60;
  return [
    days && t("editor.when.days", { count: days }),
    hours && t("editor.when.hours", { count: hours }),
    mins && t("editor.when.minutes", { count: mins }),
  ].filter(Boolean).join(" ") || t("editor.when.minutes", { count: 0 });
}

// ---------------------------------------------------------------- local time, ISO and DST

/** A local wall-clock moment as a Date, and whether the zone had to move it (a DST gap) or it happens twice. */
export function resolveLocal(day: DayKey, minutes: number): { date: Date; shifted: boolean; ambiguous: boolean } {
  const { y, m, d } = parseDay(day);
  const date = new Date(y, m, d, Math.floor(minutes / 60), minutes % 60);
  const shifted = date.getHours() * 60 + date.getMinutes() !== minutes || dayKey(date) !== day;
  // Fall back: the same wall-clock time again one hour later.
  const later = new Date(date.getTime() + 3_600_000);
  const ambiguous = !shifted && later.getHours() * 60 + later.getMinutes() === minutes && dayKey(later) === day;
  return { date, shifted, ambiguous };
}

export function localToIso(day: DayKey, minutes: number): string {
  return resolveLocal(day, minutes).date.toISOString();
}

export function isoToLocal(iso: string): { day: DayKey; minutes: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { day: dayKey(date), minutes: date.getHours() * 60 + date.getMinutes() };
}

/** Local time zone abbreviation for a moment, e.g. "EST". */
export function zoneAbbreviation(date: Date): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(), { timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Plain-language DST note for a chosen wall-clock time, or null. */
export function dstNote(day: DayKey, minutes: number): string | null {
  const { date, shifted, ambiguous } = resolveLocal(day, minutes);
  if (shifted) {
    const used = date.getHours() * 60 + date.getMinutes();
    return t("editor.when.dstGap", { time: formatTime(minutes), used: formatTime(used) });
  }
  if (ambiguous) return t("editor.when.dstRepeat", { time: formatTime(minutes) });
  return null;
}

// ---------------------------------------------------------------- the picker model

export interface WhenModel {
  range: RangeState;
  /** Time of day (minutes after midnight) on the start date and on the end date. */
  startMin: number;
  endMin: number;
  /** The end date was moved to the next day automatically (an evening event ending after midnight). */
  rolled: boolean;
  /** The organizer chose a one-day range with two clicks, so the end never rolls to the next day on its own. */
  pinnedSingle: boolean;
}

export type WhenIssue = "end-before-start" | null;

/** The next full hour after `now`, for one hour. */
export function defaultWhen(now: Date = new Date()): { startTime: string; endTime: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  return { startTime: start.toISOString(), endTime: new Date(start.getTime() + 3_600_000).toISOString() };
}

export function modelFromIso(startIso: string, endIso: string, now: Date = new Date()): WhenModel {
  let start = isoToLocal(startIso);
  let end = isoToLocal(endIso);
  if (!start || !end) {
    const d = defaultWhen(now);
    start = isoToLocal(d.startTime)!;
    end = isoToLocal(d.endTime)!;
  }
  const rolled = dayDiff(start.day, end.day) === 1 && end.minutes < start.minutes;
  return { range: { start: start.day, end: end.day, phase: "done" }, startMin: start.minutes, endMin: end.minutes, rolled, pinnedSingle: false };
}

export function modelToIso(model: WhenModel): { startTime: string; endTime: string } {
  return { startTime: localToIso(model.range.start, model.startMin), endTime: localToIso(model.range.end, model.endMin) };
}

/** Real elapsed minutes (DST aware). */
export function durationMinutes(model: WhenModel): number {
  const { startTime, endTime } = modelToIso(model);
  return Math.round((Date.parse(endTime) - Date.parse(startTime)) / 60_000);
}

/**
 * Keeps the model valid after any edit. On a single day, an end at or before the start moves to the next day when
 * that is allowed (not after a deliberate one-day pick) and goes back when the end is later again; otherwise the end
 * snaps to 15 minutes after the start and `issue` says why.
 */
export function settle(model: WhenModel): { model: WhenModel; issue: WhenIssue } {
  let next = { ...model, range: { ...model.range } };
  const same = next.range.start === next.range.end;
  if (next.rolled && next.range.end === addDays(next.range.start, 1) && next.endMin > next.startMin) {
    next = { ...next, range: { ...next.range, end: next.range.start }, rolled: false };
  } else if (same && next.endMin <= next.startMin) {
    if (!next.pinnedSingle) {
      next = { ...next, range: { ...next.range, end: addDays(next.range.start, 1) }, rolled: true };
    } else {
      const start = Math.min(next.startMin, DAY_MIN - 2 * STEP);
      return { model: { ...next, startMin: start, endMin: start + STEP }, issue: "end-before-start" };
    }
  }
  return { model: next, issue: null };
}
