import { describe, expect, it } from "vitest";
import { AI_NAME, AI_STRINGS, t, tMaybe, tn } from "../aiStrings";
import { STEPS, summaryLines, emptyAnswers } from "../ideas";

describe("AI strings", () => {
  it("names the assistant from one constant", () => {
    expect(AI_NAME).toBe("Dipbot");
    expect(t("nav.label")).toBe("Dipbot");
    expect(t("page.subtitle")).toMatch(/^Work with Dipbot to plan your next event/);
    expect(t("suggest.feature")).toBe("Dipbot Suggest");
    expect(t("step.note.full")).toBe("Ask Dipbot");
    expect(t("results.label")).toBe("Dipbot’s drafts");
    expect(t("suggest.use")).toBe("Let Dipbot pick for me");
    // One line per stepper label, full wording kept for names and tooltips.
    expect(STEPS.map((s) => s.label)).toEqual(["Interests", "Goal", "Group", "Budget", "Ask"]);
    expect(STEPS.map((s) => s.full)).toEqual(["Interests", "Goal", "Group and setting", "Budget and timing", "Ask Dipbot"]);
    expect(summaryLines(emptyAnswers(), (id) => id)[0].value).toBe("Any interest");
  });

  it("fills slots and plurals, and leaves unknown slots as written", () => {
    expect(tn("suggest.count", 6)).toBe("Dipbot suggests 6 choices.");
    expect(tn("suggest.count", 1)).toBe("Dipbot suggests 1 choice.");
    expect(t("credits.meter", { left: 412, total: 500 })).toBe("Credits: 412 of 500 this month");
    expect(tn("credits.unit", 1)).toBe("1 credit");
    expect(tn("credits.unit", 10)).toBe("10 credits");
    expect(t("interests.pick")).toBe("Pick up to {n}");
    expect(tMaybe("limit.AI_FLAG_LIMIT")).toMatch(/paused/);
    expect(tMaybe("limit.NOPE")).toBeNull();
  });

  it("keeps the copy free of em dashes and raw AI wording", () => {
    for (const [key, value] of Object.entries(AI_STRINGS)) {
      expect(value, key).not.toMatch(/—/);
      expect(value, key).not.toMatch(/\bthe AI\b/i);
    }
  });

  it("never shows money for AI use: no dollar sign, cost or budget wording outside the event budget options", () => {
    for (const [key, value] of Object.entries(AI_STRINGS)) {
      if (key.startsWith("budget.") || key === "legend.budget" || key === "step.budget.label" || key === "step.budget.heading" || key === "step.budget.full") continue;
      expect(value, key).not.toMatch(/\$|\busd\b|dollar|\bcents?\b|\bspend|\bbudget\b|\bprice/i);
    }
  });
});
