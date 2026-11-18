import { describe, expect, it } from "vitest";
import { CONSIDERATIONS, CONSIDERATION_IDS, MAX_CONSIDERATIONS, rankConsiderationsByRules } from "../considerations";
import { frontRow, groupedConsiderations } from "../considerationsView";
import { emptyAnswers, presetAnswers, signatureOf, summaryLines, toggleConsideration } from "../ideas";
import { freshnessLine, relativeAgo } from "../suggestCache";
import type { EventIdeaSuggestions } from "../adminTypes";

const base = rankConsiderationsByRules({ tagIds: ["tag-fitness"], goal: "wellness" });

describe("consideration chips: front row and grouping", () => {
  it("shows the top six up front, plus anything chosen, and never drops a chosen chip", () => {
    const answers = { ...emptyAnswers(), considerations: ["halal", "vegetarian"] };
    const row = frontRow(base, answers, "jev");
    expect(row.top).toHaveLength(6);
    expect(row.shown.slice(0, 6)).toEqual(row.top);
    expect(row.shown).toContain("halal");
    expect(new Set(row.shown).size).toBe(row.shown.length);
    expect(row.ranked).toHaveLength(CONSIDERATIONS.length);
  });

  it("emphasizes only ranked suggestions: no emphasis when nothing was ranked by a provider", () => {
    expect(frontRow(base, emptyAnswers(), "jev").suggested.size).toBe(6);
    expect(frontRow(base, emptyAnswers(), "none").suggested.size).toBe(0);
    expect(frontRow([], emptyAnswers(), "none").shown).toHaveLength(6);
  });

  it("reorders locally by the choices so far, with no request", () => {
    const outdoors = frontRow(base, { ...emptyAnswers(), setting: "outdoors", budget: "free", goal: "competition" }, "jev");
    const plain = frontRow(base, emptyAnswers(), "jev");
    expect(outdoors.ranked.indexOf("rain_plan")).toBeLessThan(plain.ranked.indexOf("rain_plan"));
    expect(outdoors.ranked.indexOf("competitive")).toBeLessThan(plain.ranked.indexOf("competitive"));
  });

  it("lists the rest grouped by category and keeps every accommodation and dietary option reachable", () => {
    const row = frontRow(base, emptyAnswers(), "jev");
    const groups = groupedConsiderations(row.ranked, "", new Set(row.top));
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set([...ids, ...row.top])).toEqual(new Set(CONSIDERATION_IDS));
    expect(groups.map((g) => g.group)).toEqual(["accessibility", "dietary", "vibe", "logistics", "inclusion", "safety"].filter((g) => groups.some((x) => x.group === g)));
    // Whatever the ranking is (even a hostile one), the accommodations are still in the full list.
    const reversed = [...row.ranked].reverse();
    const all = groupedConsiderations(reversed, "").flatMap((g) => g.items.map((i) => i.id));
    for (const id of ["wheelchair_accessible", "step_free", "sensory_friendly", "vegan", "gluten_free", "nut_free", "halal", "kosher"]) expect(all).toContain(id);
  });

  it("searches label, hint and category across everything, including what is up front", () => {
    const search = (q: string) => groupedConsiderations(base.map((r) => r.id), q, new Set(["wheelchair_accessible"])).flatMap((g) => g.items.map((i) => i.id));
    expect(search("wheelchair")).toContain("wheelchair_accessible");
    expect(search("VEGAN")).toContain("vegan");
    expect(search("food")).toContain("gluten_free");
    expect(search("gluten free")).toEqual(["gluten_free"]);
    expect(search("zzzz")).toEqual([]);
  });
});

describe("consideration selection persists", () => {
  it("toggles, caps at the maximum, ignores unknown ids and survives a ranking refresh", () => {
    let a = toggleConsideration(emptyAnswers(), "vegan");
    expect(a.considerations).toEqual(["vegan"]);
    expect(toggleConsideration(a, "not_in_catalog").considerations).toEqual(["vegan"]);
    expect(toggleConsideration(a, "vegan").considerations).toEqual([]);
    for (const id of CONSIDERATION_IDS.slice(0, 20)) a = toggleConsideration(a, id);
    expect(a.considerations).toHaveLength(MAX_CONSIDERATIONS);
    expect(toggleConsideration(a, a.considerations[0]!).considerations).toHaveLength(MAX_CONSIDERATIONS - 1);
    // A new ranking (the admin pressed Refresh) changes the front row but not the selection.
    const before = frontRow(base, a, "jev");
    const after = frontRow([...base].reverse(), a, "jev");
    expect(after.top).not.toEqual(before.top);
    for (const id of a.considerations) expect(after.shown).toContain(id);
  });

  it("is part of the request signature, the summary and the preset", () => {
    const choices = { focusTagIds: [] as string[], goal: "wellness" as const, groupSize: "team" as const, setting: "indoors" as const, budget: "free" as const, timing: "weekday_lunch" as const };
    expect(signatureOf(choices, "", 3, ["vegan"])).not.toBe(signatureOf(choices, "", 3, []));
    expect(signatureOf(choices, "", 3, ["a", "b"])).toBe(signatureOf(choices, "", 3, ["b", "a"]));
    expect(summaryLines({ ...emptyAnswers(), considerations: ["vegan"], prompt: "Park" }, (id) => id)[4]!.value).toBe("1 preference, Park");
    expect(presetAnswers().considerations.every((id) => CONSIDERATION_IDS.includes(id))).toBe(true);
  });
});

describe("saved suggestions line", () => {
  const NOW = new Date("2026-11-18T12:00:00Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const answer = (patch: Partial<EventIdeaSuggestions>): EventIdeaSuggestions => ({ provider: "jev", suggestions: [], cacheStatus: "fresh", creditsCharged: 0, considerations: [], ...patch });

  it("reads relative times", () => {
    expect(relativeAgo(ago(20_000), NOW)).toBe("just now");
    expect(relativeAgo(ago(60_000), NOW)).toBe("1 minute ago");
    expect(relativeAgo(ago(5 * 60_000), NOW)).toBe("5 minutes ago");
    expect(relativeAgo(ago(2 * 3_600_000), NOW)).toBe("2 hours ago");
    expect(relativeAgo(ago(3 * 86_400_000), NOW)).toBe("3 days ago");
    expect(relativeAgo(undefined, NOW)).toBe("just now");
  });

  it("says new data is available only for data-stale answers, and nothing for a free heuristic answer", () => {
    expect(freshnessLine(answer({ computedAt: ago(7_200_000) }), NOW)).toEqual({ text: "Updated 2 hours ago", stale: false });
    expect(freshnessLine(answer({ cacheStatus: "stale", staleReason: "data", computedAt: ago(3 * 86_400_000) }), NOW)).toEqual({ text: "Updated 3 days ago", stale: true, hint: "New data available" });
    expect(freshnessLine(answer({ cacheStatus: "stale", staleReason: "age", computedAt: ago(9 * 86_400_000) }), NOW)).toEqual({ text: "Updated 9 days ago", stale: true });
    expect(freshnessLine(answer({ provider: "heuristic", cacheStatus: "computed", computedAt: NOW.toISOString() }), NOW)).toBeNull();
    expect(freshnessLine(answer({ cacheStatus: "computed", computedAt: NOW.toISOString() }), NOW)?.stale).toBe(false);
  });

  it("uses no em dashes anywhere in the new copy", async () => {
    const { AI_STRINGS } = await import("../aiStrings");
    for (const [key, value] of Object.entries(AI_STRINGS)) expect(value, key).not.toMatch(/—/);
  });
});
