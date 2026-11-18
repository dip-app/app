import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESETS, QUICK_KEY, QUICK_TTL_MS, SAFE_DEFAULTS, armQuick, nextWeekday, quickAnswers, quickRequested, readTimeHint, rememberTimeHint,
  stashEditor, takeEditorStash, takeQuick, timePresets,
} from "../dipbotTouches";
import type { LabeledSuggestion } from "../suggestionLabels";

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
};
const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };

describe("quick mode token", () => {
  it("is absent by default, so a bookmark never arms", () => {
    expect(takeQuick(memory())).toBe(false);
    expect(quickRequested("?quick=1")).toBe(true);
    expect(quickRequested("?quick=0")).toBe(false);
    expect(quickRequested("")).toBe(false);
  });

  it("is valid once: the button arms it and reading it removes it", () => {
    const store = memory();
    expect(armQuick(store, 1000)).toBe(true);
    expect(takeQuick(store, 2000)).toBe(true);
    expect(store.map.has(QUICK_KEY)).toBe(false);
    expect(takeQuick(store, 2000)).toBe(false);
  });

  it("expires, ignores garbage and is removed even when it does not count", () => {
    const store = memory();
    armQuick(store, 1000);
    expect(takeQuick(store, 1000 + QUICK_TTL_MS + 1)).toBe(false);
    expect(store.map.has(QUICK_KEY)).toBe(false);
    store.setItem(QUICK_KEY, "{nope");
    expect(takeQuick(store)).toBe(false);
    store.setItem(QUICK_KEY, JSON.stringify({ at: Date.now() + 10 * 60_000 }));
    expect(takeQuick(store)).toBe(false);
  });

  it("blocked storage never arms", () => {
    expect(armQuick(blocked)).toBe(false);
    expect(takeQuick(blocked)).toBe(false);
  });
});

describe("quick answers", () => {
  const sg = (question: LabeledSuggestion["question"], value: string): LabeledSuggestion => ({ question, value, probability: 0.9, reason: "r", reasonBasis: "generic", level: "perfect" });

  it("uses every suggested choice and the safe defaults for the rest", () => {
    const a = quickAnswers({ interest: sg("interest", "tag-games"), goal: sg("goal", "wellness"), timing: sg("timing", "after_work") });
    expect(a).toMatchObject({ focusTagIds: ["tag-games"], goal: "wellness", groupSize: SAFE_DEFAULTS.groupSize, setting: SAFE_DEFAULTS.setting, budget: SAFE_DEFAULTS.budget, timing: "after_work", prompt: "", count: 3 });
  });

  it("with no suggestions: any interest, defaults everywhere, and it is ready to generate", () => {
    const a = quickAnswers({});
    expect(a.focusTagIds).toEqual([]);
    expect([a.goal, a.groupSize, a.setting, a.budget, a.timing].every(Boolean)).toBe(true);
  });
});

describe("Dipbot's suggested times", () => {
  it("falls back to the two defaults without data", () => {
    expect(timePresets(null)).toEqual(DEFAULT_PRESETS);
    expect(DEFAULT_PRESETS.map((p) => p.label)).toEqual(["Lunch 12:00 to 1:00 PM", "After work 5:30 to 7:30 PM"]);
  });

  it("puts the company's best bucket first and keeps two chips", () => {
    expect(timePresets({ timing: "after_work" }).map((p) => p.label)).toEqual(["After work 5:30 to 7:30 PM", "Lunch 12:00 to 1:00 PM"]);
    expect(timePresets({ timing: "weekday_lunch" }).map((p) => p.label)).toEqual(["Lunch 12:00 to 1:00 PM", "After work 5:30 to 7:30 PM"]);
  });

  it("names the weekday when the data has one", () => {
    const [first] = timePresets({ timing: "weekday_lunch", weekday: 4 });
    expect(first).toMatchObject({ label: "Thu 12:00 to 1:00 PM", weekday: 4, start: 720, end: 780 });
    expect(timePresets({ timing: "weekend" })[0]).toMatchObject({ label: "Sat 10:00 AM to 12:00 PM", weekday: 6 });
    expect(timePresets({ timing: "weekday_lunch", weekday: 9 })[0].weekday).toBeUndefined();
  });

  it("finds the next such weekday, never today", () => {
    expect(nextWeekday("2026-11-18", 4)).toBe("2026-11-19"); // Wed -> Thu
    expect(nextWeekday("2026-11-19", 4)).toBe("2026-11-26");
    expect(nextWeekday("2026-11-18", 6)).toBe("2026-11-21");
  });

  it("remembers the hint in the tab and ignores anything unreadable", () => {
    const store = memory();
    expect(readTimeHint(store)).toBeNull();
    rememberTimeHint(store, { timing: "after_work" });
    expect(readTimeHint(store)).toEqual({ timing: "after_work" });
    rememberTimeHint(store, null);
    expect(readTimeHint(store)).toBeNull();
    store.setItem("dip.dipbotTiming.v1", JSON.stringify({ timing: "midnight" }));
    expect(readTimeHint(store)).toBeNull();
    expect(readTimeHint(blocked)).toBeNull();
  });
});

describe("form kept while visiting Dipbot", () => {
  it("returns once, then is gone", () => {
    const store = memory();
    stashEditor(store, { draft: { title: "x" } }, 1000);
    expect(takeEditorStash(store, 2000)).toEqual({ draft: { title: "x" } });
    expect(takeEditorStash(store, 2000)).toBeNull();
  });

  it("is dropped after an hour", () => {
    const store = memory();
    stashEditor(store, { a: 1 }, 1000);
    expect(takeEditorStash(store, 1000 + 61 * 60_000)).toBeNull();
  });
});
