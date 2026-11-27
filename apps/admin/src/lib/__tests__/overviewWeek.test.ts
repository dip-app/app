import { describe, expect, it } from "vitest";
import type { InsightsDay } from "../adminTypes";
import { changeText, comingUp, heldLastWeek, lastSevenDays } from "../insights";
import { relativeTime } from "@/components/kit/RelativeTime";

const now = new Date("2026-11-26T15:00:00Z");
const series = (values: number[]): InsightsDay[] => values.map((v, i) => {
  const d = new Date(Date.UTC(2026, 10, 26) - (values.length - 1 - i) * 86_400_000);
  return { date: d.toISOString().slice(0, 10), rsvps: v, photos: v * 2 };
});

describe("lastSevenDays", () => {
  it("compares the last 7 complete days with the 7 before and leaves today out", () => {
    // 15 values: 7 before (1 each), 7 last (2 each), then today (99, partial).
    const days = series([...Array(7).fill(1), ...Array(7).fill(2), 99]);
    expect(lastSevenDays(days, "rsvps", now)).toEqual({ current: 14, previous: 7, spark: [...Array(7).fill(1), ...Array(7).fill(2)] });
    expect(lastSevenDays(days, "photos", now).current).toBe(28);
  });
  it("has no comparison when the series is shorter than two weeks", () => {
    const days = series([3, 3, 3, 3, 3, 3, 3, 3, 0]);
    expect(lastSevenDays(days, "rsvps", now).previous).toBeNull();
    expect(changeText(5, null)).toBeNull();
  });
});

describe("changeText", () => {
  it("states absolute changes with a real minus sign, or Same", () => {
    expect(changeText(14, 7)).toBe("+7 vs the 7 days before");
    expect(changeText(3, 15)).toBe("−12 vs the 7 days before");
    expect(changeText(4, 4)).toBe("Same as the 7 days before");
  });
});

describe("events this week", () => {
  const ev = (id: string, startDays: number, endDays: number, going: number, status = "scheduled") => ({
    id, title: id, startTime: new Date(now.getTime() + startDays * 86_400_000).toISOString(), endTime: new Date(now.getTime() + endDays * 86_400_000).toISOString(),
    attendeeCount: going, capacity: 30, status,
  });
  const events = [ev("held", -3, -2.9, 20), ev("old", -10, -9.9, 5), ev("canceled", -2, -1.9, 9, "cancelled"), ev("soon", 2, 2.1, 7), ev("later", 20, 20.1, 1), ev("next", 1, 1.1, 3)];
  it("counts events that ended in the last 7 days, without canceled ones", () => {
    expect(heldLastWeek(events, now)).toEqual({ count: 1, going: 20 });
  });
  it("lists what starts in the next two weeks, soonest first", () => {
    expect(comingUp(events, now).map((e) => e.id)).toEqual(["next", "soon"]);
  });
});

describe("relativeTime", () => {
  it("reads recent and upcoming times in words, older ones as a date", () => {
    expect(relativeTime(new Date(now.getTime() - 20_000), now)).toBe("just now");
    expect(relativeTime(new Date(now.getTime() - 12 * 60_000), now)).toBe("12 min. ago");
    expect(relativeTime(new Date(now.getTime() + 10 * 86_400_000), now)).toBe("in 10 days");
    expect(relativeTime(new Date(now.getTime() - 20 * 86_400_000), now)).toBe("Nov 6");
  });
});
