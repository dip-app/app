import { planReconcile, type Correction } from "../domain/reconcile";
import type { TagCatalog, TagReconcileStore } from "./ports";

export interface ReconcileOptions { force?: boolean; dryRun?: boolean; now?: () => number; recentWindowMs?: number }
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
}

const COUNT_BATCH = 10;

/** Recomputes every catalog tag count for one company and corrects stat docs that drifted. Equal counts cause no write. */
export async function reconcileCompanyTagStats(deps: Deps, companyId: string, options: ReconcileOptions = {}): Promise<ReconcileReport> {
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const nowMs = (options.now ?? Date.now)();
  const catalogTagIds = [...(await deps.catalog.tagIds())].sort();

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
    computed, nowMs, force, ...(options.recentWindowMs !== undefined ? { recentWindowMs: options.recentWindowMs } : {}),
  });

  const report: ReconcileReport = {
    companyId, dryRun, checked: catalogTagIds.length, corrected: 0, deleted: 0, unchanged: plan.unchanged,
    skippedRecent: plan.skippedRecent.length, skippedConcurrent: 0, drift: 0, corrections: [], deletions: [],
    skippedRecentTags: plan.skippedRecent,
  };
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

/** Reconciles an explicit list of companies, or every company (paged by document id). One failing company does not stop the rest. */
export async function reconcileAllCompanies(
  deps: Deps,
  options: ReconcileOptions & { companyIds?: readonly string[]; onReport?: (report: ReconcileReport) => void; onFailure?: (companyId: string, error: unknown) => void } = {},
): Promise<ReconcileAllResult> {
  const result: ReconcileAllResult = { reports: [], failedCompanies: [] };
  const run = async (companyId: string) => {
    try {
      const report = await reconcileCompanyTagStats(deps, companyId, options);
      result.reports.push(report);
      options.onReport?.(report);
    } catch (error) {
      result.failedCompanies.push(companyId);
      options.onFailure?.(companyId, error);
    }
  };
  if (options.companyIds) {
    for (const companyId of options.companyIds) await run(companyId);
    return result;
  }
  let after: string | null = null;
  for (;;) {
    const page: string[] = await deps.store.listCompanyIds(after, PAGE_SIZE);
    for (const companyId of page) await run(companyId);
    if (page.length < PAGE_SIZE) return result;
    after = page[page.length - 1]!;
  }
}
