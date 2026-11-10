import { strict as assert } from "node:assert";
import { test } from "node:test";
// @ts-expect-error plain ESM script without type declarations
import { planWindows, THEME } from "../../../scripts/seed-weekly-theme.mjs";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const show = (w: { id: string; startMs: number; endMs: number }) => [w.id, iso(w.startMs), iso(w.endMs)];

test("default window is the current America/New_York Monday..Sunday week", () => {
  // Tuesday Nov 10 2026, 10:30 EST.
  assert.deepEqual(planWindows({ nowMs: Date.parse("2026-11-10T15:30:00Z") }).map(show),
    [["weekly-fitness-20261109", "2026-11-09T05:00:00Z", "2026-11-16T04:59:59Z"]]);
  // Sunday 11 pm EST is still the same week; Monday 00:30 EST starts the next.
  assert.equal(planWindows({ nowMs: Date.parse("2026-11-16T04:00:00Z") })[0].id, "weekly-fitness-20261109");
  assert.equal(planWindows({ nowMs: Date.parse("2026-11-16T05:30:00Z") })[0].id, "weekly-fitness-20261116");
});

test("explicit start, --weeks and DST boundaries", () => {
  assert.deepEqual(planWindows({ start: "2026-11-16", weeks: 2 }).map(show), [
    ["weekly-fitness-20261116", "2026-11-16T05:00:00Z", "2026-11-23T04:59:59Z"],
    ["weekly-fitness-20261123", "2026-11-23T05:00:00Z", "2026-11-30T04:59:59Z"],
  ]);
  // DST starts Sunday Mar 8 2026: the week begins in EST and ends in EDT.
  assert.deepEqual(show(planWindows({ start: "2026-03-02" })[0]), ["weekly-fitness-20260302", "2026-03-02T05:00:00Z", "2026-03-09T03:59:59Z"]);
  // DST ends Sunday Nov 1 2026.
  assert.deepEqual(show(planWindows({ start: "2026-10-26" })[0]), ["weekly-fitness-20261026", "2026-10-26T04:00:00Z", "2026-11-02T04:59:59Z"]);
});

test("rejects invalid input and the theme values match the spec", () => {
  assert.throws(() => planWindows({ start: "2026-02-30" }));
  assert.throws(() => planWindows({ start: "2026-11-16", end: "2026-11-15" }));
  assert.throws(() => planWindows({ start: "2026-11-16", end: "2026-12-01" })); // > 14 days
  assert.throws(() => planWindows({ start: "2026-11-16", end: "2026-11-25", weeks: 2 })); // windows overlap
  assert.throws(() => planWindows({ weeks: 0 }));
  assert.deepEqual({ ...THEME }, {
    title: "Fitness", description: "Get moving with coworkers this week: try a class, a walk or a workout together and log it.",
    type: "weekly", goal: 3, goalUnit: "workouts", pointsReward: 50, coverImageURL: "catalog://theme/fitness", tagName: "Fitness",
  });
});
