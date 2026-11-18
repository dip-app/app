import { describe, expect, it } from "vitest";
import {
  type RangeState, type WhenModel, addDays, addMonths, angleToFaceMinutes, calendarKey, clickDay, defaultWhen, describeDuration, dragMinutes,
  dstNote, durationMinutes, formatDuration, formatTime, isoToLocal, localToIso, minutesToAngle, modelFromIso, modelToIso, monthGrid,
  parseTime, pointToAngle, previewRange, resolveLocal, settle, sliderKey, withPeriod, zoneAbbreviation,
} from "../when";


const done = (start: string, end: string): RangeState => ({ start, end, phase: "done" });
const picking = (day: string): RangeState => ({ start: day, end: day, phase: "picking" });

describe("two-click range", () => {
  it("a click outside a finished range starts a fresh range", () => {
    expect(clickDay(done("2026-11-10", "2026-11-12"), "2026-11-20")).toEqual(picking("2026-11-20"));
    expect(clickDay(done("2026-11-10", "2026-11-12"), "2026-11-02")).toEqual(picking("2026-11-02"));
  });
  it("second click after the start sets the end", () => {
    expect(clickDay(picking("2026-11-10"), "2026-11-14")).toEqual(done("2026-11-10", "2026-11-14"));
  });
  it("the same day twice is a one-day event", () => {
    expect(clickDay(picking("2026-11-10"), "2026-11-10")).toEqual(done("2026-11-10", "2026-11-10"));
  });
  it("a click before the start moves the start and keeps the first day as the end", () => {
    expect(clickDay(picking("2026-11-10"), "2026-11-06")).toEqual(done("2026-11-06", "2026-11-10"));
  });
  it("inside a finished range the nearer endpoint moves (ties move the end)", () => {
    const range = done("2026-11-10", "2026-11-20");
    expect(clickDay(range, "2026-11-12")).toEqual(done("2026-11-12", "2026-11-20"));
    expect(clickDay(range, "2026-11-18")).toEqual(done("2026-11-10", "2026-11-18"));
    expect(clickDay(range, "2026-11-15")).toEqual(done("2026-11-10", "2026-11-15"));
    expect(clickDay(range, "2026-11-10")).toEqual(range);
  });
  it("previews the hovered end only while picking", () => {
    expect(previewRange(picking("2026-11-10"), "2026-11-13")).toEqual({ start: "2026-11-10", end: "2026-11-13" });
    expect(previewRange(picking("2026-11-10"), "2026-11-07")).toEqual({ start: "2026-11-07", end: "2026-11-10" });
    expect(previewRange(picking("2026-11-10"), null)).toEqual({ start: "2026-11-10", end: "2026-11-10" });
    expect(previewRange(done("2026-11-10", "2026-11-12"), "2026-11-30")).toEqual({ start: "2026-11-10", end: "2026-11-12" });
  });
});

describe("calendar", () => {
  it("builds Sunday-first weeks", () => {
    const grid = monthGrid("2026-11-01"); // a Sunday
    expect(grid[0][0]).toBe("2026-11-01");
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid.at(-1)!.includes("2026-11-30")).toBe(true);
    expect(monthGrid("2026-10-01")[0][0]).toBe("2026-09-27");
  });
  it("adds days across DST and months with clamping", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
  it("keyboard moves focus", () => {
    const day = "2026-11-18"; // a Wednesday
    expect(calendarKey("ArrowLeft", day)).toBe("2026-11-17");
    expect(calendarKey("ArrowRight", day)).toBe("2026-11-19");
    expect(calendarKey("ArrowUp", day)).toBe("2026-11-11");
    expect(calendarKey("ArrowDown", day)).toBe("2026-11-25");
    expect(calendarKey("PageUp", day)).toBe("2026-10-18");
    expect(calendarKey("PageDown", day)).toBe("2026-12-18");
    expect(calendarKey("PageDown", day, true)).toBe("2027-11-18");
    expect(calendarKey("Home", day)).toBe("2026-11-15");
    expect(calendarKey("End", day)).toBe("2026-11-21");
    expect(calendarKey("a", day)).toBeNull();
  });
});

describe("dial math", () => {
  it("maps time to angle and back with 15 minute snapping", () => {
    expect(minutesToAngle(0)).toBe(0);
    expect(minutesToAngle(180)).toBe(90);
    expect(minutesToAngle(12 * 60 + 360)).toBe(180);
    expect(angleToFaceMinutes(90)).toBe(180);
    expect(angleToFaceMinutes(91)).toBe(180);
    expect(angleToFaceMinutes(97.4)).toBe(195); // 3:15 sits at 97.5 degrees
    expect(angleToFaceMinutes(359.9)).toBe(0);
    expect(angleToFaceMinutes(-90)).toBe(540);
  });
  it("turns a pointer offset into a clock angle", () => {
    expect(pointToAngle(0, -10)).toBeCloseTo(0);
    expect(pointToAngle(10, 0)).toBeCloseTo(90);
    expect(pointToAngle(0, 10)).toBeCloseTo(180);
    expect(pointToAngle(-10, 0)).toBeCloseTo(270);
  });
  it("keeps the period while dragging and flips AM/PM when passing 12", () => {
    expect(dragMinutes(100, 18 * 60)).toBe(12 * 60 + angleToFaceMinutes(100));
    expect(dragMinutes(1, 11 * 60 + 45)).toBe(12 * 60); // 11:45 AM clockwise past 12 is 12:00 PM
    expect(dragMinutes(1, 23 * 60 + 45)).toBe(0); // 11:45 PM to 12:00 AM
    expect(dragMinutes(353, 12 * 60)).toBe(11 * 60 + 45); // 12:00 PM back past 12 is 11:45 AM
    expect(dragMinutes(353, 0)).toBe(23 * 60 + 45); // 12:00 AM back is 11:45 PM
    expect(dragMinutes(180, 6 * 60)).toBe(6 * 60);
  });
  it("keyboard on a handle", () => {
    expect(sliderKey("ArrowRight", 18 * 60 + 30)).toBe(18 * 60 + 45);
    expect(sliderKey("ArrowUp", 18 * 60 + 30)).toBe(18 * 60 + 45);
    expect(sliderKey("ArrowLeft", 18 * 60 + 30)).toBe(18 * 60 + 15);
    expect(sliderKey("ArrowDown", 18 * 60 + 30)).toBe(18 * 60 + 15);
    expect(sliderKey("PageUp", 18 * 60 + 30)).toBe(19 * 60 + 30);
    expect(sliderKey("PageDown", 18 * 60 + 30)).toBe(17 * 60 + 30);
    expect(sliderKey("Home", 600)).toBe(0);
    expect(sliderKey("End", 600)).toBe(23 * 60 + 45);
    expect(sliderKey("ArrowLeft", 0)).toBe(0);
    expect(sliderKey("ArrowRight", 23 * 60 + 45)).toBe(23 * 60 + 45);
    expect(sliderKey("x", 0)).toBeNull();
  });
});

describe("12-hour text", () => {
  it("formats and flips periods", () => {
    expect(formatTime(0)).toBe("12:00 AM");
    expect(formatTime(12 * 60)).toBe("12:00 PM");
    expect(formatTime(18 * 60 + 30)).toBe("6:30 PM");
    expect(withPeriod(6 * 60 + 30, true)).toBe(18 * 60 + 30);
    expect(withPeriod(18 * 60 + 30, false)).toBe(6 * 60 + 30);
    expect(withPeriod(0, true)).toBe(12 * 60);
  });
  it("parses typed times", () => {
    expect(parseTime("6:30 pm")).toBe(18 * 60 + 30);
    expect(parseTime("6pm")).toBe(18 * 60);
    expect(parseTime("630p")).toBe(18 * 60 + 30);
    expect(parseTime("12:15 AM")).toBe(15);
    expect(parseTime("12 pm")).toBe(12 * 60);
    expect(parseTime("18:30")).toBe(18 * 60 + 30);
    expect(parseTime("6:30", true)).toBe(18 * 60 + 30);
    expect(parseTime("6:30", false)).toBe(6 * 60 + 30);
    expect(parseTime("13 pm")).toBeNull();
    expect(parseTime("6:75 pm")).toBeNull();
    expect(parseTime("soon")).toBeNull();
  });
  it("formats durations", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(26 * 60)).toBe("1d 2h");
    expect(describeDuration(90)).toBe("1 hour 30 minutes");
    expect(describeDuration(15)).toBe("15 minutes");
  });
});

describe("local time, ISO and DST", () => {
  it("round trips through the same ISO the editor stores", () => {
    const iso = localToIso("2026-11-20", 18 * 60 + 30);
    expect(iso).toBe(new Date("2026-11-20T18:30").toISOString());
    expect(isoToLocal(iso)).toEqual({ day: "2026-11-20", minutes: 18 * 60 + 30 });
    expect(isoToLocal("nope")).toBeNull();
  });
  it("detects the spring-forward gap and the fall-back overlap", () => {
    expect(resolveLocal("2026-03-08", 2 * 60 + 30).shifted).toBe(true);
    expect(dstNote("2026-03-08", 2 * 60 + 30)).toMatch(/doesn’t exist.*3:30 AM/);
    expect(resolveLocal("2026-11-01", 60 + 30).ambiguous).toBe(true);
    expect(dstNote("2026-11-01", 60 + 30)).toMatch(/happens twice/);
    expect(dstNote("2026-11-20", 18 * 60)).toBeNull();
  });
  it("measures real elapsed time across a DST change", () => {
    const model = modelFromIso(localToIso("2026-03-07", 22 * 60), localToIso("2026-03-08", 6 * 60));
    expect(durationMinutes(model)).toBe(7 * 60); // 8 wall-clock hours, one skipped
  });
  it("names the zone", () => {
    expect(zoneAbbreviation(new Date("2026-11-20T12:00:00Z"))).toBe("EST");
    expect(zoneAbbreviation(new Date("2026-07-20T12:00:00Z"))).toBe("EDT");
  });
  it("defaults to the next full hour for one hour", () => {
    const d = defaultWhen(new Date("2026-11-20T10:20:00"));
    expect(isoToLocal(d.startTime)).toEqual({ day: "2026-11-20", minutes: 11 * 60 });
    expect(Date.parse(d.endTime) - Date.parse(d.startTime)).toBe(3_600_000);
    expect(isoToLocal(defaultWhen(new Date("2026-11-20T10:00:00")).startTime)!.minutes).toBe(11 * 60);
  });
  it("builds a model from ISO and back, falling back to defaults on bad input", () => {
    const start = localToIso("2026-11-20", 17 * 60 + 30), end = localToIso("2026-11-22", 11 * 60);
    const model = modelFromIso(start, end);
    expect(model.range).toEqual({ start: "2026-11-20", end: "2026-11-22", phase: "done" });
    expect(modelToIso(model)).toEqual({ startTime: start, endTime: end });
    expect(modelFromIso("", "", new Date("2026-11-20T10:20:00")).startMin).toBe(11 * 60);
  });
});

describe("settle (end after start)", () => {
  const base = (over: Partial<WhenModel>): WhenModel => ({
    range: { start: "2026-11-20", end: "2026-11-20", phase: "done" }, startMin: 18 * 60, endMin: 20 * 60, rolled: false, pinnedSingle: false, ...over,
  });
  it("leaves a valid single day alone", () => {
    expect(settle(base({}))).toEqual({ model: base({}), issue: null });
  });
  it("moves the end to the next day when the range allows it, and back again", () => {
    const rolled = settle(base({ endMin: 60 })).model;
    expect(rolled.range.end).toBe("2026-11-21");
    expect(rolled.rolled).toBe(true);
    const back = settle({ ...rolled, endMin: 22 * 60 }).model;
    expect(back.range.end).toBe("2026-11-20");
    expect(back.rolled).toBe(false);
  });
  it("blocks on a deliberate one-day range and snaps to 15 minutes", () => {
    const result = settle(base({ pinnedSingle: true, endMin: 17 * 60 }));
    expect(result.issue).toBe("end-before-start");
    expect(result.model.endMin).toBe(18 * 60 + 15);
    const late = settle(base({ pinnedSingle: true, startMin: 23 * 60 + 45, endMin: 23 * 60 + 45 }));
    expect(late.model.endMin - late.model.startMin).toBe(15);
    expect(late.model.endMin).toBeLessThan(24 * 60);
  });
  it("never touches multi-day ranges", () => {
    const m = base({ range: { start: "2026-11-20", end: "2026-11-22", phase: "done" }, endMin: 60 });
    expect(settle(m)).toEqual({ model: m, issue: null });
  });
});
