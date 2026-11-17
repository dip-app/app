import { describe, expect, it } from "vitest";
import { AI_NAME, AI_STRINGS, t, tMaybe, tn } from "../aiStrings";
import { STEPS, summaryLines, emptyAnswers } from "../ideas";

describe("AI strings", () => {
  it("names the assistant from one constant", () => {
    expect(AI_NAME).toBe("Dipbot");
    expect(t("nav.label")).toBe("Dipbot");
    expect(t("page.subtitle")).toMatch(/^Work with Dipbot to plan your next event/);
    expect(t("suggest.feature")).toBe("Dipbot Suggest");
    expect(t("step.note.label")).toBe("Ask Dipbot");
    expect(t("results.label")).toBe("Dipbot’s drafts");
    expect(t("interests.surprise")).toBe("Let Dipbot choose");
    expect(STEPS[4].label).toBe("Ask Dipbot");
    expect(summaryLines({ ...emptyAnswers(), surprise: true }, (id) => id)[0].value).toBe("Let Dipbot choose");
  });

  it("fills slots and plurals, and leaves unknown slots as written", () => {
    expect(tn("suggest.count", 6)).toBe("Dipbot suggests 6 choices.");
    expect(tn("suggest.count", 1)).toBe("Dipbot suggests 1 choice.");
    expect(t("rail.monthly", { used: 3, limit: 30 })).toBe("Monthly: 3 of 30 used");
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
});
