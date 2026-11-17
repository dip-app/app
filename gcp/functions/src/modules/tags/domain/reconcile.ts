/** Pure reconcile planning for tag stats (docs/design/stretch/tag-interest-counts.md). No Firebase imports. */

export const DEFAULT_RECENT_WINDOW_MS = 10 * 60 * 1000;

export interface ExistingStat { tagId: string; memberCount: number; updatedAtMs: number | null }
export interface Correction { tagId: string; from: number | null; to: number }

export interface ReconcilePlan {
  corrections: Correction[];
  /** Stat docs whose tag is no longer in the catalog. */
  deletions: string[];
  unchanged: number;
  /** Tags whose stat doc was written recently enough that a trigger may still be in flight. */
  skippedRecent: string[];
}

export function planReconcile(input: {
  catalogTagIds: readonly string[];
  existing: readonly ExistingStat[];
  computed: ReadonlyMap<string, number>;
  nowMs: number;
  recentWindowMs?: number;
  force: boolean;
}): ReconcilePlan {
  const recentWindowMs = input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const existing = new Map(input.existing.map((stat) => [stat.tagId, stat]));
  const catalog = new Set(input.catalogTagIds);
  const plan: ReconcilePlan = { corrections: [], deletions: [], unchanged: 0, skippedRecent: [] };

  for (const tagId of [...catalog].sort()) {
    const computed = input.computed.get(tagId) ?? 0;
    const stat = existing.get(tagId);
    if (!stat) {
      // Never create zero docs.
      if (computed === 0) plan.unchanged += 1;
      else plan.corrections.push({ tagId, from: null, to: computed });
      continue;
    }
    if (stat.memberCount === computed) { plan.unchanged += 1; continue; }
    const recent = stat.updatedAtMs !== null && input.nowMs - stat.updatedAtMs < recentWindowMs;
    if (recent && !input.force) { plan.skippedRecent.push(tagId); continue; }
    plan.corrections.push({ tagId, from: stat.memberCount, to: computed });
  }
  for (const tagId of [...existing.keys()].sort()) if (!catalog.has(tagId)) plan.deletions.push(tagId);
  return plan;
}
