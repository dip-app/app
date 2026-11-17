import { TAGS } from "./catalog";
import type { TagStat } from "./tagStats";

// Deterministic preview counts for the demo company. A few tags are left out on purpose (no stat doc yet), and one
// count is negative, as the server can briefly report; the portal clamps it. Counts stay at or below the demo company's 29 active members. Other companies start empty.
const COUNTS: Record<string, number> = {
  "tag-fitness": 24, "tag-energetic": 12, "tag-hype": 7, "tag-outdoors": 21, "tag-social": 29, "tag-cooking": 18,
  "tag-games": 17, "tag-chill": -1, "tag-food": 26, "tag-music": 15, "tag-learning": 9,
};

export function mockTagStats(companyId: string, empty = false): TagStat[] {
  if (empty || companyId !== "acme") return [];
  return TAGS.filter((tag) => tag.id in COUNTS).map((tag) => ({
    tagId: tag.id, memberCount: COUNTS[tag.id] ?? 0, updatedAt: "2026-11-01T12:00:00.000Z", reconciledAt: "2026-11-01T06:00:00.000Z",
  }));
}
