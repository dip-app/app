import { describe, expect, it } from "vitest";
import { LIVE_TAG_NAMES, opaqueTagId } from "../catalog";
import { GENERIC_BLURB, mascotArt, normalizeName, tagArt, tagBlurb } from "../tagArt";

const withId = (name: string) => ({ id: opaqueTagId(`live:${name}`), name });

describe("tagArt", () => {
  it("maps known production names to theme or spot art", () => {
    expect(tagArt(withId("Fitness")).src).toContain("/img/themes/fitness.png");
    expect(tagArt(withId("Water Sport")).src).toContain("/img/themes/outdoors.svg");
    expect(tagArt(withId("Weekly Activity")).src).toContain("/img/themes/fitness.png");
    expect(tagArt(withId("Carpentry")).src).toContain("/img/themes/arts.svg");
    expect(tagArt(withId("Creative")).src).toContain("/img/themes/arts.svg");
    expect(tagArt(withId("Food")).src).toContain("/img/themes/food.svg");
    expect(tagArt(withId("Bonding")).src).toContain("/img/ai/goal-team_bonding.svg");
    expect(tagArt(withId("Hype")).src).toContain("/img/ai/interest-hype.svg");
    expect(tagArt({ id: "x", name: "Food & Drink" }).src).toContain("/img/themes/food.svg");
  });

  it("matches synonyms for unknown names on word starts only", () => {
    expect(tagArt(withId("Kayak Trips")).src).toContain("outdoors");
    expect(tagArt(withId("Pottery Night")).src).toContain("arts");
    expect(tagArt(withId("Live Band")).src).toContain("music");
    expect(tagArt(withId("Trivia")).src).toContain("games");
    expect(tagArt(withId("Mindfulness")).src).toContain("wellness");
    expect(tagArt(withId("Charity Drive")).src).toContain("volunteering");
    expect(tagArt(withId("Party")).src).toContain("goal-team_bonding"); // not "art"
  });

  it("falls back to a deterministic mascot on a tile, varied across tags", () => {
    const a = tagArt({ id: "k3Fh2xQ", name: "Zorbing" });
    expect(a.kind).toBe("mascot");
    expect(tagArt({ id: "k3Fh2xQ", name: "Zorbing" })).toEqual(a);
    const unknown = Array.from({ length: 24 }, (_, i) => mascotArt(`tag-${i}`));
    expect(new Set(unknown.map((x) => x.src)).size).toBeGreaterThan(10);
    expect(new Set(unknown.map((x) => x.bg)).size).toBeGreaterThan(3);
  });

  it("gives every production tag art, and the live names are not all alike", () => {
    const srcs = LIVE_TAG_NAMES.map((n) => tagArt(withId(n)).src);
    expect(srcs.every(Boolean)).toBe(true);
    expect(new Set(srcs).size).toBeGreaterThan(8);
  });
});

describe("tagBlurb", () => {
  it("uses curated copy of 3 to 5 words for every known name", () => {
    for (const name of LIVE_TAG_NAMES.slice(0, 14)) {
      const words = tagBlurb({ name }).replace(/[,.]/g, "").split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(3);
      expect(words.length).toBeLessThanOrEqual(5);
    }
    expect(tagBlurb({ name: "Water Sport" })).toBe("Paddle, swim, sail");
  });
  it("lets a description override, falls back by keyword family, then generic", () => {
    expect(tagBlurb({ name: "Fitness", description: "Sweat together" })).toBe("Sweat together");
    expect(tagBlurb({ name: "Kayak Trips" })).toBe("Fresh air and fun");
    expect(tagBlurb({ name: "Zorbing" })).toBe(GENERIC_BLURB);
    expect(normalizeName("Food & Drink")).toBe("food and drink");
  });
});
