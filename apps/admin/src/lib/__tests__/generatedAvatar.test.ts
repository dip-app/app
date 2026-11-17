import { describe, expect, it } from "vitest";
import { fnv1a64, generatedAvatarFor, generatedAvatarId } from "../generatedAvatar";

/**
 * Pairs computed by running the app's own `DIPAvatarStyle.assigned(forUserID:)` (FNV-1a 64 + SplitMix64 finaliser, then
 * figure / mood / palette as mixed-radix digits) in Swift. If one of these changes, the portal no longer shows the member's app avatar.
 */
const SWIFT_PAIRS: [string, string][] = [
  ["", "crew-round-happy-pink"],
  ["a", "crew-square-wink-pink"],
  ["uid-123", "crew-square-wink-white"],
  ["pNVpp3OusRvgfUV8hv5R", "crew-square-happy-yellow"],
  ["member-1", "crew-round-calm-yellow"],
  ["u", "crew-square-wink-grey"],
  ["9fQ2xLmT7ZbKc1WdEoHq3VnAyR52", "crew-round-wink-grey"],
  ["user-0", "crew-pill-happy-grey"],
  ["user-19999", "crew-round-wink-grey"],
  ["Ünï-1", "crew-pill-calm-yellow"],
];

describe("generatedAvatarFor (port of DIPAvatarStyle.assigned)", () => {
  it.each(SWIFT_PAIRS)("maps %j to the same character as the app", (userId, expected) => {
    expect(generatedAvatarId(userId)).toBe(expected);
  });
  it("uses the app's FNV-1a 64 constants", () => {
    expect(fnv1a64("")).toBe(BigInt("0xcbf29ce484222325"));
    expect(fnv1a64("a")).toBe(BigInt("0xaf63dc4c8601ec8c"));
  });
  it("is stable, and reaches every shape, mood and colour", () => {
    expect(generatedAvatarFor("uid-123")).toEqual(generatedAvatarFor("uid-123"));
    const seen = { figure: new Set<string>(), mood: new Set<string>(), palette: new Set<string>() };
    for (let i = 0; i < 2000; i += 1) {
      const a = generatedAvatarFor(`user-${i}`);
      seen.figure.add(a.figure); seen.mood.add(a.mood); seen.palette.add(a.palette);
    }
    expect([seen.figure.size, seen.mood.size, seen.palette.size]).toEqual([3, 3, 6]);
  });
});
