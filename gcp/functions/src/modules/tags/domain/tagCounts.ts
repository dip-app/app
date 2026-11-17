import { createHash } from "node:crypto";

/** Pure interest-count rules (docs/design/stretch/tag-interest-counts.md). No Firebase imports. */

export interface CountingMembership { companyId: string; tagIds: Set<string> }
export type TagDeltas = Map<string, Map<string, number>>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The company and catalog interests a user document contributes to, or null when it does not count
 * (missing doc, no company, deactivated). A missing status counts as active, like `sameCompany` in the rules. */
export function countingMembership(doc: unknown, catalog: ReadonlySet<string>): CountingMembership | null {
  if (!isRecord(doc)) return null;
  const companyId = doc.companyId;
  if (typeof companyId !== "string" || companyId.length === 0) return null;
  if (doc.status === "deactivated") return null;
  const tagIds = new Set<string>();
  if (Array.isArray(doc.interestTagIds)) {
    for (const entry of doc.interestTagIds) if (typeof entry === "string" && catalog.has(entry)) tagIds.add(entry);
  }
  return { companyId, tagIds };
}

/** +1 for tags gained and -1 for tags lost, per company. A company change removes from the old company and adds to the new one. */
export function tagCountDeltas(before: unknown, after: unknown, catalog: ReadonlySet<string>): TagDeltas {
  const deltas: TagDeltas = new Map();
  const bump = (companyId: string, tagId: string, amount: number) => {
    let tags = deltas.get(companyId);
    if (!tags) { tags = new Map(); deltas.set(companyId, tags); }
    const next = (tags.get(tagId) ?? 0) + amount;
    if (next === 0) tags.delete(tagId); else tags.set(tagId, next);
  };
  const was = countingMembership(before, catalog);
  const now = countingMembership(after, catalog);
  if (was) for (const tagId of was.tagIds) bump(was.companyId, tagId, -1);
  if (now) for (const tagId of now.tagIds) bump(now.companyId, tagId, 1);
  for (const [companyId, tags] of deltas) if (tags.size === 0) deltas.delete(companyId);
  return deltas;
}

const rawTagSet = (doc: Record<string, unknown>): string[] => {
  if (!Array.isArray(doc.interestTagIds)) return [];
  return [...new Set(doc.interestTagIds.filter((entry): entry is string => typeof entry === "string"))].sort();
};

/** Cheap pre-check so ordinary profile edits skip the catalog read and every write. */
export function interestFieldsChanged(before: unknown, after: unknown): boolean {
  if (!isRecord(before) || !isRecord(after)) return isRecord(before) !== isRecord(after);
  if (before.companyId !== after.companyId || before.status !== after.status) return true;
  const a = rawTagSet(before);
  const b = rawTagSet(after);
  return a.length !== b.length || a.some((value, index) => value !== b[index]);
}

/** Receipt document ID for a trigger event: the event ID itself when it is a safe document ID, else its SHA-256. */
export function receiptIdFor(eventId: string): string {
  return /^[A-Za-z0-9_-]{1,200}$/.test(eventId) ? eventId : createHash("sha256").update(eventId, "utf8").digest("hex");
}

export interface InterestEntry { tagId: string; name: string; memberCount: number | null; suppressed: boolean }
export interface InterestSummary { top: InterestEntry[]; thin: InterestEntry[]; tagsWithStats: number }

/** Top and thin interests for one company with small-cell suppression (counts under `minCount` are hidden so
 * individuals are not singled out). Only catalog tags are considered; tags without a stat count as 0. */
export function summarizeInterests(
  stats: readonly { tagId: string; memberCount: number }[],
  catalog: readonly { id: string; name: string }[],
  options: { limit?: number; minCount?: number } = {},
): InterestSummary {
  const limit = options.limit ?? 5;
  const minCount = options.minCount ?? 5;
  const counts = new Map<string, number>();
  for (const stat of stats) counts.set(stat.tagId, Number.isFinite(stat.memberCount) ? Math.max(0, stat.memberCount) : 0);
  const rows = catalog.map((tag) => ({ tagId: tag.id, name: tag.name, count: counts.get(tag.id) ?? 0 }));
  const tagsWithStats = rows.filter((row) => counts.has(row.tagId)).length;
  const byName = (a: { name: string; tagId: string }, b: { name: string; tagId: string }) =>
    a.name.localeCompare(b.name, "en") || a.tagId.localeCompare(b.tagId, "en");
  const entry = (row: { tagId: string; name: string; count: number }): InterestEntry =>
    row.count >= minCount ? { tagId: row.tagId, name: row.name, memberCount: row.count, suppressed: false }
      : { tagId: row.tagId, name: row.name, memberCount: null, suppressed: true };

  const top = rows.filter((row) => row.count >= minCount).sort((a, b) => b.count - a.count || byName(a, b)).slice(0, limit);
  const topIds = new Set(top.map((row) => row.tagId));
  const rest = rows.filter((row) => !topIds.has(row.tagId));
  const thinVisible = rest.filter((row) => row.count >= minCount).sort((a, b) => a.count - b.count || byName(a, b));
  // Suppressed tags are thinner than any visible one; ordering them by name alone leaks nothing about their counts.
  const thinSuppressed = rest.filter((row) => row.count < minCount).sort(byName);
  const thin = [...thinSuppressed, ...thinVisible].slice(0, limit);
  return { top: top.map(entry), thin: thin.map(entry), tagsWithStats };
}
