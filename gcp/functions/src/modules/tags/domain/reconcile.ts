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
  /** True when orphan deletions were withheld because they would remove more than half of the existing stat docs (or the catalog is empty). */
  deletionsRefused: boolean;
}

/** More than this share of existing stat docs planned for deletion is treated as a bad catalog read, not an orphan cleanup. */
export const MAX_DELETION_SHARE = 0.5;

export function planReconcile(input: {
  catalogTagIds: readonly string[];
  existing: readonly ExistingStat[];
  computed: ReadonlyMap<string, number>;
  nowMs: number;
  recentWindowMs?: number;
  force: boolean;
  /** Permits deleting more than half of the existing stat docs (never with an empty catalog). Separate from `force`, which only skips the recent-write window. */
  allowMassDelete?: boolean;
}): ReconcilePlan {
  const recentWindowMs = input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const existing = new Map(input.existing.map((stat) => [stat.tagId, stat]));
  const catalog = new Set(input.catalogTagIds);
  const plan: ReconcilePlan = { corrections: [], deletions: [], unchanged: 0, skippedRecent: [], deletionsRefused: false };

  for (const tagId of [...catalog].sort()) {
    // Two non-atomic counts (all minus deactivated) can momentarily go negative; a count is never below zero.
    const computed = Math.max(0, input.computed.get(tagId) ?? 0);
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
  const orphans = [...existing.keys()].filter((tagId) => !catalog.has(tagId)).sort();
  // An empty catalog (failed or partial read) would orphan every doc; so would a catalog that lost most tags.
  if (orphans.length > 0 && (catalog.size === 0 || (!input.allowMassDelete && orphans.length > existing.size * MAX_DELETION_SHARE))) {
    plan.deletionsRefused = true;
  } else {
    plan.deletions.push(...orphans);
  }
  return plan;
}
