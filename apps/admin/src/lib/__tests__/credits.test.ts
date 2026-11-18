import { describe, expect, it } from "vitest";
import { type KeyValueStore, createMockApi } from "../api";
import type { AiCredits, AiEventChoices } from "../adminTypes";
import { creditsText, creditsView, priceLabel, resetDate } from "../credits";
import { AI_STRINGS } from "../aiStrings";

const NOW = new Date("2026-11-17T12:00:00Z");
const store = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
async function admin() {
  const api = createMockApi(store(), () => NOW);
  await api.signIn("admin");
  return api;
}
const choices: AiEventChoices = { focusTagIds: ["tag-fitness"], goal: "wellness", groupSize: "team", setting: "outdoors", budget: "under_15", timing: "weekday_lunch" };
const credits = (left: number, over: Partial<AiCredits> = {}): AiCredits => ({
  creditsAllowance: 500, creditsUsed: 500 - left, creditsRemaining: left, resetsAt: "2026-12-01T08:00:00.000Z",
  creditCost: { suggest: 1, generate: 10, regenerate: 10, weeklyEmail: 3, coverPick: 1 }, ...over,
});

describe("credits view", () => {
  it("is ok above 20%, low under 20%, out when a run no longer fits", () => {
    expect(creditsView(credits(412), "UTC")).toMatchObject({ left: 412, total: 500, pct: 82, level: "ok", out: false, date: "Dec 1" });
    expect(creditsView(credits(100), "UTC").level).toBe("ok");
    expect(creditsView(credits(99), "UTC").level).toBe("low");
    expect(creditsView(credits(10), "UTC")).toMatchObject({ level: "low", out: false });
    expect(creditsView(credits(9), "UTC")).toMatchObject({ level: "out", out: true });
    expect(creditsView(credits(0), "UTC")).toMatchObject({ level: "out", pct: 0 });
    expect(creditsView(credits(0, { creditsAllowance: 0 }), "UTC")).toMatchObject({ level: "out", pct: 0 });
  });

  it("formats the reset day and the per-action prices", () => {
    expect(resetDate("2026-12-01T08:00:00.000Z", "UTC")).toBe("Dec 1");
    expect(resetDate("garbage")).toBe("the first of next month");
    expect(creditsText(1)).toBe("1 credit");
    expect(priceLabel("action.generateCost", credits(400))).toBe("Generate drafts, 10 credits");
    expect(priceLabel("results.regenerateCost", credits(400))).toBe("Regenerate, 10 credits");
  });
});

describe("credits in the mock API", () => {
  it("returns credits with the context and charges a generation, replays free", async () => {
    const api = await admin();
    expect((await api.eventIdeaContext()).credits).toMatchObject({ creditsAllowance: 500, creditsUsed: 88, creditsRemaining: 412, creditCost: { generate: 10 } });
    const first = await api.generateEventDrafts({ requestId: "c1", choices, prompt: "", count: 3 });
    expect(first.credits.creditsRemaining).toBe(402);
    const again = await api.generateEventDrafts({ requestId: "c1", choices, prompt: "", count: 3 });
    expect(again.replay).toBe(true);
    expect((await api.eventIdeaContext()).credits.creditsRemaining).toBe(402);
    expect((await api.eventIdeaSuggestions()).credits?.creditsRemaining).toBe(402);
  });

  it("carries no money in any AI payload", async () => {
    const api = await admin();
    const context = await api.eventIdeaContext();
    const generated = await api.generateEventDrafts({ requestId: "c2", choices, prompt: "", count: 1 });
    const text = JSON.stringify({ usage: context.usage, credits: context.credits, usage2: generated.usage, credits2: generated.credits });
    expect(text).not.toMatch(/\$|usd|dollar|cents|micros|spend|budget/i);
  });
});

describe("credit copy", () => {
  it("names the reset date and the price in the visible strings", () => {
    expect(AI_STRINGS["credits.out"]).toContain("{ai}");
    expect(AI_STRINGS["limit.AI_CREDITS_EXHAUSTED"]).toContain("{date}");
    expect(AI_STRINGS["action.generateCost"]).toContain("{cost}");
    expect(AI_STRINGS["results.regenerateCost"]).toContain("{cost}");
  });
});
