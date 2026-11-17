import type { AiInterestTag } from "../../../generated/models";
import type { CatalogTag, InterestStat } from "../application/ports";

/** A tag with fewer members than this is never reported, not even as a bucket (small-group privacy). */
export const SUPPRESSION_THRESHOLD = 5;
const TOP_MAX = 8;
const THIN_MAX = 50;

export interface InterestSummary { available: boolean; top: AiInterestTag[]; thinTagIds: string[] }

export function bucketFor(count: number): AiInterestTag["bucket"] | null {
  if (count < SUPPRESSION_THRESHOLD) return null;
  if (count < 10) return "5-9";
  if (count < 20) return "10-19";
  return "20+";
}

/** Reduces exact per-tag counts to coarse buckets; the counts themselves never appear in the result. */
export function summarizeInterests(stats: InterestStat[] | null, catalog: readonly CatalogTag[]): InterestSummary {
  if (stats === null) return { available: false, top: [], thinTagIds: [] };
  const order = new Map(catalog.map((tag, index) => [tag.id, index]));
  const counts = new Map<string, number>();
  for (const stat of stats) {
    if (!order.has(stat.tagId) || !Number.isSafeInteger(stat.memberCount) || stat.memberCount < 0) continue;
    counts.set(stat.tagId, Math.max(counts.get(stat.tagId) ?? 0, stat.memberCount));
  }
  const top = [...counts.entries()]
    .filter(([, count]) => count >= SUPPRESSION_THRESHOLD)
    .sort((a, b) => b[1] - a[1] || order.get(a[0])! - order.get(b[0])!)
    .slice(0, TOP_MAX)
    .map(([tagId, count]) => ({ tagId, bucket: bucketFor(count)! }));
  const thinTagIds = catalog
    .filter(tag => (counts.get(tag.id) ?? 0) < SUPPRESSION_THRESHOLD)
    .map(tag => tag.id)
    .slice(0, THIN_MAX);
  return { available: true, top, thinTagIds };
}
