import { describe, expect, it } from "vitest";
import { createMockApi, type KeyValueStore } from "../api";
import { TAGS } from "../catalog";
import { tagStatFromDoc } from "../adminLive";
import { type TagStat, countsByTag, hasStats, interestLabel, interestRows } from "../tagStats";
import { mockTagStats } from "../tagStatsMock";

const stat = (tagId: string, memberCount: number): TagStat => ({ tagId, memberCount, updatedAt: "2026-11-01T00:00:00.000Z" });
const NOW = new Date("2026-11-03T12:00:00Z");
const store = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe("countsByTag", () => {
  it("clamps negative and non-finite counts at zero", () => {
    const counts = countsByTag([stat("tag-a", -3), stat("tag-b", 5), stat("tag-c", Number.NaN)]);
    expect(counts.get("tag-a")).toBe(0);
    expect(counts.get("tag-b")).toBe(5);
    expect(counts.get("tag-c")).toBe(0);
  });
  it("is empty for no stats or no access", () => {
    expect(countsByTag([]).size).toBe(0);
    expect(countsByTag(null).size).toBe(0);
  });
});

describe("hasStats", () => {
  it("is false for an empty list and for null, true otherwise", () => {
    expect(hasStats([])).toBe(false);
    expect(hasStats(null)).toBe(false);
    expect(hasStats([stat("tag-a", 0)])).toBe(true);
  });
});

describe("interestRows", () => {
  const tags = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }, { id: "d", name: "Delta" }];
  it("sorts by count descending, then name, and includes tags without a stat doc as 0", () => {
    const rows = interestRows([stat("c", 10), stat("b", 10), stat("a", 4)], tags);
    expect(rows.map((r) => [r.name, r.count])).toEqual([["Beta", 10], ["Gamma", 10], ["Alpha", 4], ["Delta", 0]]);
  });
  it("gives each row a percentage of the largest count", () => {
    const rows = interestRows([stat("a", 40), stat("b", 10), stat("c", 1)], tags);
    expect(rows.map((r) => r.percent)).toEqual([100, 25, 3, 0]);
    expect(rows.every((r) => r.share === null)).toBe(true);
  });
  it("scales bars and shares to active members when the total is known, clamped to 100", () => {
    const rows = interestRows([stat("a", 15), stat("b", 3), stat("c", 90)], tags, 30);
    expect(rows.map((r) => [r.name, r.share, r.percent])).toEqual([["Gamma", 100, 100], ["Alpha", 50, 50], ["Beta", 10, 10], ["Delta", 0, 0]]);
  });
  it("falls back to relative bars without a share when the total is 0", () => {
    const rows = interestRows([stat("a", 10), stat("b", 5)], tags, 0);
    expect(rows.map((r) => [r.percent, r.share])).toEqual([[100, null], [50, null], [0, null], [0, null]]);
  });
  it("falls back to relative bars without a share when the active total is unknown (insights failed)", () => {
    const rows = interestRows([stat("a", 10), stat("b", 5)], tags, null);
    expect(rows.map((r) => [r.name, r.percent, r.share])).toEqual([["Alpha", 100, null], ["Beta", 50, null], ["Delta", 0, null], ["Gamma", 0, null]]);
    expect(interestRows([stat("a", 10), stat("b", 5)], tags, undefined)).toEqual(rows);
  });
  it("clamps negatives before sorting and measuring", () => {
    const rows = interestRows([stat("a", -2), stat("b", 8)], tags);
    expect(rows[0]).toMatchObject({ name: "Beta", count: 8, percent: 100 });
    expect(rows.find((r) => r.tagId === "a")).toMatchObject({ count: 0, percent: 0 });
  });
  it("has zero percentages when every count is zero, and ignores stats for unknown tags", () => {
    expect(interestRows([stat("a", 0), stat("zzz", 9)], tags).every((r) => r.percent === 0)).toBe(true);
    expect(interestRows([stat("zzz", 9)], tags)).toHaveLength(4);
  });
});

describe("interestLabel", () => {
  it("reads naturally for one and many", () => {
    expect(interestLabel(23)).toBe("23 members interested");
    expect(interestLabel(1)).toBe("1 member interested");
  });
});

describe("mock tagStats", () => {
  it("returns counts for most tags and leaves a few out", async () => {
    const api = createMockApi(store(), () => NOW);
    await api.signIn("organizer");
    const stats = await api.tagStats();
    expect(stats).not.toBeNull();
    expect(stats!.length).toBeGreaterThan(0);
    expect(stats!.length).toBeLessThan(TAGS.length);
    expect(stats!.some((s) => s.memberCount < 0)).toBe(true);
    expect(stats!.every((s) => s.memberCount <= 29)).toBe(true);
    expect(stats).toEqual(mockTagStats("acme"));
  });
  it("is empty for a company without stats", async () => {
    const api = createMockApi(store(), () => NOW);
    await api.signIn("otherAdmin");
    expect(await api.tagStats()).toEqual([]);
  });
  it("is refused for members", async () => {
    const api = createMockApi(store(), () => NOW);
    await api.signIn("member");
    await expect(api.tagStats()).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("tagStatFromDoc", () => {
  it("falls back to the document id and a zero count", () => {
    expect(tagStatFromDoc("tag-x", {})).toMatchObject({ tagId: "tag-x", memberCount: 0 });
    expect(tagStatFromDoc("tag-x", { tagId: "tag-y", memberCount: 7 })).toMatchObject({ tagId: "tag-y", memberCount: 7 });
  });
});
