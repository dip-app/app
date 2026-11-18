import { describe, expect, it } from "vitest";
import { COVER_LIBRARY, THEMES, coverByURL, coverImage, coverThumb, lexicalPick, searchCovers } from "../covers";
import { COVERS, coverFor } from "../catalog";
import { buildMockDrafts } from "../ideasMock";
import { createMockApi } from "../api";

describe("cover library", () => {
  it("loads the manifest with files, thumbs and alt text for every entry", () => {
    expect(COVER_LIBRARY.length).toBeGreaterThanOrEqual(14);
    const keys = new Set<string>();
    for (const c of COVER_LIBRARY) {
      expect(keys.has(c.key)).toBe(false);
      keys.add(c.key);
      expect(c.file).toMatch(/\.webp$/);
      expect(c.thumb).toMatch(/^thumbs\/.+\.webp$/);
      expect(c.alt.length).toBeGreaterThan(0);
      expect(c.label.length).toBeLessThanOrEqual(40);
      expect(c.themes.length).toBeGreaterThan(0);
      expect(c.url).toMatch(/^catalog:\/\/(default\/[a-z]+|cover\/[a-z0-9-]+)$/);
    }
  });

  it("has the nine themes with the weekly-theme names and a cover for each", () => {
    expect(THEMES.map((t) => t.key)).toEqual(["outdoors", "food", "arts", "games", "music", "learning", "volunteering", "wellness", "fitness"]);
    expect(THEMES.find((t) => t.key === "food")?.label).toBe("Food & Drink");
    for (const t of THEMES) expect(searchCovers({ theme: t.key }).length).toBeGreaterThan(0);
  });

  it("resolves legacy and new URLs and builds base-path image URLs", () => {
    expect(coverByURL("catalog://default/hiking")?.key).toBe("default-hiking");
    expect(coverByURL("catalog://cover/theme-music")?.label).toBe("Music and jam session");
    expect(coverByURL("catalog://cover/nope")).toBeUndefined();
    expect(coverByURL("https://example.com/x.jpg")).toBeUndefined();
    const hike = coverByURL("catalog://default/hiking")!;
    expect(coverImage(hike)).toBe("/admin/img/covers/default-hiking.webp");
    expect(coverThumb(hike)).toBe("/admin/img/covers/thumbs/default-hiking.webp");
  });

  it("keeps COVERS and coverFor working for older callers", () => {
    expect(COVERS.length).toBe(COVER_LIBRARY.length);
    expect(coverFor("catalog://default/games")?.id).toBe("games");
    expect(coverFor("catalog://cover/theme-arts")?.image).toContain("/img/covers/theme-arts.webp");
    expect(coverFor("catalog://default/unknown")).toBeUndefined();
  });
});

describe("mock pickEventCover", () => {
  const store = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  };
  it("returns a deterministic library cover as a match, avoiding exclusions, and needs a title and a role", async () => {
    const api = createMockApi(store(), () => new Date("2026-11-17T12:00:00Z"));
    await api.signIn("admin");
    const a = await api.pickEventCover({ title: "Kayaking on the lake" });
    expect(a).toMatchObject({ coverImageURL: "catalog://default/outdoors", source: "match", provider: null });
    const b = await api.pickEventCover({ title: "Kayaking on the lake", excludeCoverImageURLs: [a.coverImageURL] });
    expect(b.coverImageURL).not.toBe(a.coverImageURL);
    await expect(api.pickEventCover({ title: " " })).rejects.toMatchObject({ code: "invalid-argument" });
    await api.signIn("member");
    await expect(api.pickEventCover({ title: "x" })).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("searchCovers", () => {
  const keys = (r: { key: string }[]) => r.map((c) => c.key);
  it("matches tags, label and alt case-insensitively, by prefix", () => {
    expect(keys(searchCovers({ query: "KAYAK" }))).toContain("default-outdoors");
    expect(keys(searchCovers({ query: "yoga" }))).toContain("default-fitness");
    expect(keys(searchCovers({ query: "pug" }))).toEqual(["default-fitness"]);
    expect(keys(searchCovers({ query: "pendant" }))).toContain("default-cooking"); // alt text
    expect(keys(searchCovers({ query: "paddl" }))).toContain("default-outdoors"); // prefix
  });
  it("requires every word (AND) and filters by theme", () => {
    expect(keys(searchCovers({ query: "board games" }))).toContain("default-games");
    expect(searchCovers({ query: "kayak pizza" })).toEqual([]);
    expect(searchCovers({ query: "" })).toHaveLength(COVER_LIBRARY.length);
    const music = searchCovers({ theme: "music" });
    expect(music.every((c) => c.themes.includes("music"))).toBe(true);
    expect(searchCovers({ query: "kayak", theme: "music" })).toEqual([]);
  });
});

describe("lexicalPick", () => {
  it("picks by activity words", () => {
    expect(lexicalPick({ title: "Kayaking on the lake" }).key).toBe("default-outdoors");
    expect(lexicalPick({ title: "Team trivia and board games night" }).themes).toContain("games");
    expect(lexicalPick({ title: "Sunrise yoga", tagIds: ["tag-wellness"] }).key).toBe("default-fitness");
    expect(lexicalPick({ title: "Friday jam session", description: "Bring your guitar" }).key).toBe("theme-music");
  });
  it("falls back to the theme default, then the outdoors photo", () => {
    expect(lexicalPick({ title: "Zzzz qqq", tagIds: ["tag-music"] }).key).toBe("theme-music");
    expect(lexicalPick({ title: "Zzzz qqq" }).url).toBe("catalog://default/outdoors");
    expect(lexicalPick({ title: "Zzzz qqq", theme: "arts" }).key).toBe("theme-arts");
  });
  it("avoids excluded covers and is deterministic", () => {
    const first = lexicalPick({ title: "Kayaking on the lake" });
    const second = lexicalPick({ title: "Kayaking on the lake" }, [first.url]);
    expect(second.url).not.toBe(first.url);
    expect(lexicalPick({ title: "Kayaking on the lake" }).url).toBe(first.url);
  });
  it("gives mock Dipbot drafts different covers", () => {
    const drafts = buildMockDrafts({ focusTagIds: ["tag-games"], goal: "competition", groupSize: "team", setting: "indoors", budget: "under_15", timing: "weekday_lunch" }, "", 3);
    expect(new Set(drafts.map((d) => d.coverImageURL)).size).toBe(3);
    for (const d of drafts) expect(coverByURL(d.coverImageURL)).toBeDefined();
  });
});
