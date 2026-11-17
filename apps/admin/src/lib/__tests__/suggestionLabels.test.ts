import { describe, expect, it } from "vitest";
import type { AiStepSuggestion } from "../adminTypes";
import { emptyAnswers } from "../ideas";
import { mockSuggestions } from "../ideasMock";
import {
  PROVIDER_CAP, SUGGESTION_LEVELS, applySuggestions, labeledSuggestions, levelFor, spokenSuggestion, suggestedBy, suggestionsApplied,
} from "../suggestionLabels";

const any = () => true;
const s = (question: AiStepSuggestion["question"], value: string, probability: number): AiStepSuggestion => ({ question, value, probability, reason: "r" });

describe("suggestion labels", () => {
  it("maps Jev probabilities to three labels at the boundaries", () => {
    expect(SUGGESTION_LEVELS.map((l) => [l.label, l.min])).toEqual([["Perfect fit", 0.85], ["Great choice", 0.7], ["Good match", 0.55]]);
    expect(levelFor(1, "jev")).toBe("perfect");
    expect(levelFor(0.85, "jev")).toBe("perfect");
    expect(levelFor(0.8499, "jev")).toBe("great");
    expect(levelFor(0.7, "jev")).toBe("great");
    expect(levelFor(0.6999, "jev")).toBe("good");
    expect(levelFor(0.55, "jev")).toBe("good");
    expect(levelFor(0.5499, "jev")).toBeNull();
    expect(levelFor(0, "jev")).toBeNull();
  });

  it("shows nothing for missing or malformed values", () => {
    for (const bad of [undefined, null, Number.NaN, Infinity, 1.2]) expect(levelFor(bad as number, "jev")).toBeNull();
    expect(levelFor(0.99, "none")).toBeNull();
  });

  it("caps the fallback providers at Good match and never raises a weak one", () => {
    expect(PROVIDER_CAP).toEqual({ jev: "perfect", openai: "good", heuristic: "good", none: null });
    for (const provider of ["openai", "heuristic"] as const) {
      expect(levelFor(0.97, provider)).toBe("good");
      expect(levelFor(0.72, provider)).toBe("good");
      expect(levelFor(0.55, provider)).toBe("good");
      expect(levelFor(0.54, provider)).toBeNull();
    }
  });

  it("keeps one suggestion per question, highest first and the earlier entry on a tie", () => {
    const out = labeledSuggestions([s("goal", "wellness", 0.7), s("goal", "learning", 0.9), s("timing", "weekend", 0.6), s("timing", "after_work", 0.6), s("budget", "free", 0.3)], "jev", any);
    expect(out.goal).toMatchObject({ value: "learning", level: "perfect" });
    expect(out.timing).toMatchObject({ value: "weekend", level: "good" });
    expect(out.budget).toBeUndefined();
  });

  it("drops values that are not options any more", () => {
    const out = labeledSuggestions([s("interest", "tag-gone", 0.95)], "jev", (_q, v) => v !== "tag-gone");
    expect(out.interest).toBeUndefined();
  });

  it("Use suggestions fills only labeled choices and keeps the note", () => {
    const labeled = labeledSuggestions([s("interest", "tag-games", 0.9), s("goal", "competition", 0.75), s("setting", "outdoors", 0.4)], "jev", any);
    const start = { ...emptyAnswers(), prompt: "Quiet please", surprise: true, setting: "indoors" as const };
    const next = applySuggestions(start, labeled);
    expect(next).toMatchObject({ focusTagIds: ["tag-games"], surprise: false, goal: "competition", setting: "indoors", groupSize: null, prompt: "Quiet please" });
    expect(suggestionsApplied(next, labeled)).toBe(true);
    expect(suggestionsApplied(start, labeled)).toBe(false);
  });

  it("adds the suggested interest to the admin's own picks instead of replacing them", () => {
    const labeled = labeledSuggestions([s("interest", "tag-food", 0.9)], "jev", any);
    expect(applySuggestions({ ...emptyAnswers(), focusTagIds: ["tag-games"] }, labeled).focusTagIds).toEqual(["tag-games", "tag-food"]);
    expect(applySuggestions({ ...emptyAnswers(), focusTagIds: ["tag-food"] }, labeled).focusTagIds).toEqual(["tag-food"]);
    expect(applySuggestions({ ...emptyAnswers(), focusTagIds: ["a", "b", "c"] }, labeled).focusTagIds).toEqual(["a", "b", "tag-food"]);
  });

  it("names Jev only when Jev answered", () => {
    expect(suggestedBy("jev")).toBe("Suggested by Jev");
    expect(suggestedBy("openai")).toBe("Suggested");
    expect(spokenSuggestion("perfect", "jev")).toBe("Jev suggests this: perfect fit");
    expect(spokenSuggestion("good", "heuristic")).toBe("Suggested: good match");
  });

  it("the mock covers every label level by default and none for the empty scenario", () => {
    const def = mockSuggestions("default");
    const levels = new Set(Object.values(labeledSuggestions(def.suggestions, def.provider, any)).map((x) => x!.level));
    expect([...levels].sort()).toEqual(["good", "great", "perfect"]);
    expect(mockSuggestions("none")).toEqual({ provider: "none", suggestions: [] });
    expect(Object.keys(labeledSuggestions(mockSuggestions("low").suggestions, "jev", any))).toEqual([]);
    expect(applySuggestions(emptyAnswers(), labeledSuggestions(def.suggestions, def.provider, any))).toMatchObject({
      focusTagIds: ["tag-fitness"], goal: "competition", groupSize: "team", setting: "outdoors", budget: "free", timing: "after_work", prompt: "",
    });
  });
});
