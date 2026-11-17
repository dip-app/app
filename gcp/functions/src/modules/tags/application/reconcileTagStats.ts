import { planReconcile, type Correction } from "../domain/reconcile";
import type { TagCatalog, TagReconcileStore } from "./ports";

export interface ReconcileOptions {
  force?: boolean; dryRun?: boolean;
  /** Allows deleting more than half of the existing stat docs in one company (`force` does not). */
  allowMassDelete?: boolean; now?: () => number; recentWindowMs?: number;
  /** Operational warnings (ids and counts only). */
  onWarn?: (event: string, fields: Record<string, string | number>) => void;
}
export interface Deps { catalog: TagCatalog; store: TagReconcileStore }

export interface ReconcileReport {
  companyId: string;
  dryRun: boolean;
  checked: number;
  /** Corrections applied (or planned, on a dry run). */
  corrected: number;
  deleted: number;
  unchanged: number;
  skippedRecent: number;
  skippedConcurrent: number;
  /** Sum of |to - from| over corrections (from null counts as 0). */
  drift: number;
  corrections: Correction[];
  deletions: string[];
  skippedRecentTags: string[];
  /** Set when the company was skipped without touching any doc. */
  aborted?: "empty_catalog";
  /** Orphan deletions were withheld (more than half of the stat docs, or an empty catalog) and need `allowMassDelete`. */
  deletionsRefused?: boolean;
}

const COUNT_BATCH = 10;

/** Recomputes every catalog tag count for one company and corrects stat docs that drifted. Equal counts cause no write. */
export async function reconcileCompanyTagStats(deps: Deps, companyId: string, options: ReconcileOptions = {}): Promise<ReconcileReport> {
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const nowMs = (options.now ?? Date.now)();
  const catalogTagIds = [...(await deps.catalog.tagIds())].sort();
  if (catalogTagIds.length === 0) {
    // An empty catalog is a failed read or a wiped collection, never a reason to delete every stat doc.
    options.onWarn?.("tag stats reconcile aborted: empty catalog", { companyId });
    return {
      companyId, dryRun, checked: 0, corrected: 0, deleted: 0, unchanged: 0, skippedRecent: 0, skippedConcurrent: 0, drift: 0,
      corrections: [], deletions: [], skippedRecentTags: [], aborted: "empty_catalog",
    };
  }

  const computed = new Map<string, number>();
  for (let i = 0; i < catalogTagIds.length; i += COUNT_BATCH) {
    const batch = catalogTagIds.slice(i, i + COUNT_BATCH);
    const counts = await Promise.all(batch.map((tagId) => deps.store.countMembersWithTag(companyId, tagId)));
    batch.forEach((tagId, index) => computed.set(tagId, counts[index]!));
  }
  const docs = await deps.store.listStatDocs(companyId);
  const versions = new Map(docs.map((doc) => [doc.tagId, doc.version]));
  const plan = planReconcile({
    catalogTagIds,
    existing: docs.map(({ tagId, memberCount, updatedAtMs }) => ({ tagId, memberCount, updatedAtMs })),
    computed, nowMs, force, allowMassDelete: options.allowMassDelete ?? false, ...(options.recentWindowMs !== undefined ? { recentWindowMs: options.recentWindowMs } : {}),
  });

  const report: ReconcileReport = {
    companyId, dryRun, checked: catalogTagIds.length, corrected: 0, deleted: 0, unchanged: plan.unchanged,
    skippedRecent: plan.skippedRecent.length, skippedConcurrent: 0, drift: 0, corrections: [], deletions: [],
    skippedRecentTags: plan.skippedRecent,
  };
  if (plan.deletionsRefused) {
    report.deletionsRefused = true;
    options.onWarn?.("tag stats reconcile refused mass deletion", { companyId, existing: docs.length, wouldDelete: docs.filter((d) => !catalogTagIds.includes(d.tagId)).length });
  }
  for (const correction of plan.corrections) {
    if (!dryRun) {
      const outcome = await deps.store.writeCorrection(companyId, correction.tagId, correction.to, correction.from === null ? null : versions.get(correction.tagId));
      if (outcome === "concurrent") { report.skippedConcurrent += 1; continue; }
    }
    report.corrected += 1;
    report.drift += Math.abs(correction.to - (correction.from ?? 0));
    report.corrections.push(correction);
  }
  for (const tagId of plan.deletions) {
    if (!dryRun) {
      const outcome = await deps.store.deleteOrphan(companyId, tagId, versions.get(tagId));
      if (outcome === "concurrent") { report.skippedConcurrent += 1; continue; }
    }
    report.deleted += 1;
    report.deletions.push(tagId);
  }
  return report;
}

export interface ReconcileAllResult { reports: ReconcileReport[]; failedCompanies: string[] }

const PAGE_SIZE = 100;
/** Companies reconciled at once; each runs one count() pair per catalog tag, so keep it small. */
export const COMPANY_CONCURRENCY = 4;

/** Runs `task` over `items` with at most `limit` in flight; results keep the order of `items`. */
async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Reconciles an explicit list of companies, or every company (paged by document id). One failing company does not stop the rest. */
export async function reconcileAllCompanies(
  deps: Deps,
  options: ReconcileOptions & {
    companyIds?: readonly string[]; concurrency?: number;
    onReport?: (report: ReconcileReport) => void; onFailure?: (companyId: string, error: unknown) => void;
  } = {},
): Promise<ReconcileAllResult> {
  const result: ReconcileAllResult = { reports: [], failedCompanies: [] };
  const concurrency = Math.max(1, options.concurrency ?? COMPANY_CONCURRENCY);
  const runBatch = async (companyIds: readonly string[]) => {
    const outcomes = await mapLimit(companyIds, concurrency, async (companyId): Promise<{ companyId: string; report: ReconcileReport } | { companyId: string; error: unknown }> => {
      try {
        return { companyId, report: await reconcileCompanyTagStats(deps, companyId, options) };
      } catch (error) {
        return { companyId, error };
      }
    });
    for (const outcome of outcomes) {
      if ("report" in outcome) {
        result.reports.push(outcome.report);
        options.onReport?.(outcome.report);
      } else {
        result.failedCompanies.push(outcome.companyId);
        options.onFailure?.(outcome.companyId, outcome.error);
      }
    }
  };
  if (options.companyIds) {
    await runBatch(options.companyIds);
    return result;
  }
  let after: string | null = null;
  for (;;) {
    const page: string[] = await deps.store.listCompanyIds(after, PAGE_SIZE);
    await runBatch(page);
    if (page.length < PAGE_SIZE) return result;
    after = page[page.length - 1]!;
  }
}
