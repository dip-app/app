import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { reconcileAllCompanies, type ReconcileReport } from "../application/reconcileTagStats";
import { FirestoreTagReconcileStore } from "../infrastructure/firestoreTagReconcile";
import { FirestoreTagCatalog } from "../infrastructure/firestoreTagStats";

/** Report counts only: no corrections array, no PII. */
export const reportLogFields = (report: ReconcileReport) => ({
  companyId: report.companyId, checked: report.checked, corrected: report.corrected, deleted: report.deleted, unchanged: report.unchanged,
  skippedRecent: report.skippedRecent, skippedConcurrent: report.skippedConcurrent, drift: report.drift,
});

/** Nightly (03:30 UTC): recompute tag counts with count() aggregations and correct drift. Same code as the backfill script. */
export const reconcileTagStats = onSchedule(
  { schedule: "every day 03:30", timeZone: "Etc/UTC", region: "us-central1", retryCount: 1, timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 },
  async () => {
    const db = getFirestore(defaultAdminApp());
    const deps = { catalog: new FirestoreTagCatalog(db), store: new FirestoreTagReconcileStore(db) };
    const { reports, failedCompanies } = await reconcileAllCompanies(deps, {
      force: false,
      onWarn: (event, fields) => logger.warn(event, fields),
      onReport: (report) => logger.info("tag stats reconciled", reportLogFields(report)),
      onFailure: (companyId, error) => logger.error("tag stats reconcile failed", { companyId, code: String((error as { code?: unknown }).code ?? "unknown") }),
    });
    const total = reports.reduce((sum, r) => ({
      corrected: sum.corrected + r.corrected, deleted: sum.deleted + r.deleted, skippedConcurrent: sum.skippedConcurrent + r.skippedConcurrent, drift: sum.drift + r.drift,
    }), { corrected: 0, deleted: 0, skippedConcurrent: 0, drift: 0 });
    logger.info("tag stats reconcile total", { companies: reports.length, failed: failedCompanies.length, ...total });
    // Partial failures are logged per company and retried by tomorrow's run; rethrowing would re-run the whole job (and its
    // counts) for the companies that already succeeded. Only a total failure is an infrastructure problem worth a retry.
    if (failedCompanies.length > 0 && reports.length === 0) throw new Error(`Tag stats reconcile failed for all ${failedCompanies.length} companies.`);
  });
