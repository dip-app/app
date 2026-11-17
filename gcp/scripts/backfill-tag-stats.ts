// Backfill / repair of companies/{c}/tagStats from the users collection (TAG-4, docs/design/stretch/tag-interest-counts.md).
// Uses the same application code as the nightly reconcileTagStats function. DRY RUN by default: nothing is written without --apply.
//
//   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --import tsx gcp/scripts/backfill-tag-stats.ts [--company <ID> ...] [--apply]
//   Production: node --import tsx gcp/scripts/backfill-tag-stats.ts --project <ID> [--company <ID> ...]            (dry run)
//               node --import tsx gcp/scripts/backfill-tag-stats.ts --project <ID> --apply --yes-owner-approved   (needs owner approval)
//
// --apply uses force (recent stat docs are corrected too) but every write still carries a last-update-time precondition, so a
// trigger write that lands in between is skipped, not overwritten. Triggers on users are not fired (only tagStats is written).
// An empty tag catalog aborts a company; deleting more than half of its stat docs is refused unless --allow-mass-delete is passed.
// Not undoable by manifest; it is idempotent and a rerun is the recovery path. Export Firestore first for a production apply.
import { createRequire } from "node:module";
import { reconcileAllCompanies, type ReconcileReport } from "../functions/src/modules/tags/application/reconcileTagStats";
import { FirestoreTagReconcileStore } from "../functions/src/modules/tags/infrastructure/firestoreTagReconcile";
import { FirestoreTagCatalog } from "../functions/src/modules/tags/infrastructure/firestoreTagStats";

// firebase-admin lives in the Functions workspace; load it from there (docs/ops/seed-data.md).
const req = createRequire(require.resolve("../functions/package.json"));
const { getApps, initializeApp } = req("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

const args = process.argv.slice(2);
const valuesOf = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] && !args[i + 1]!.startsWith("--") ? [args[i + 1]!] : []));
const companies = valuesOf("--company");
const project = valuesOf("--project")[0];
const apply = args.includes("--apply");
const ownerApproved = args.includes("--yes-owner-approved");
// Needed only to delete more than half of a company's stat docs (otherwise treated as a bad catalog read and refused).
const allowMassDelete = args.includes("--allow-mass-delete");

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const localEmulator = /^(127\.0\.0\.1|localhost):[0-9]+$/.test(host);
if (host && !localEmulator) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST must point at 127.0.0.1 or localhost.");
  process.exit(2);
}
if (!localEmulator && !project) {
  console.error("Refusing to run: set FIRESTORE_EMULATOR_HOST to a local emulator, or pass --project <id> explicitly (production needs owner approval).");
  process.exit(2);
}
if (!localEmulator) {
  console.log(`*** LIVE PROJECT ${project}: production use needs owner approval (docs/ops/seed-data.md). ***`);
  if (apply && !ownerApproved) {
    console.error("Refusing to apply to a live project without --yes-owner-approved.");
    process.exit(2);
  }
}
const target = localEmulator ? `emulator ${host}` : `LIVE project ${project}`;
console.log(`${apply ? "APPLY" : "DRY-RUN"} ${target}${companies.length ? ` companies=${companies.join(",")}` : " all companies"}`);

const app = getApps()[0] ?? initializeApp({ projectId: project ?? process.env.GCLOUD_PROJECT ?? "demo-dip" });
const db = getFirestore(app);
const deps = { catalog: new FirestoreTagCatalog(db, 0), store: new FirestoreTagReconcileStore(db) };

const printReport = (report: ReconcileReport) => {
  console.log(`\ncompany ${report.companyId}`);
  const rows = [
    ...report.corrections.map((c) => ({ tag: c.tagId, current: c.from === null ? "(none)" : String(c.from), computed: String(c.to) })),
    ...report.deletions.map((tag) => ({ tag, current: "(orphan)", computed: "(delete)" })),
  ];
  if (rows.length > 0) console.table(rows);
  console.log(`  checked=${report.checked} ${apply ? "corrected" : "would-correct"}=${report.corrected} ${apply ? "deleted" : "would-delete"}=${report.deleted} ` +
    `unchanged=${report.unchanged} skippedRecent=${report.skippedRecent} skippedConcurrent=${report.skippedConcurrent} drift=${report.drift}`);
};

async function main(): Promise<void> {
  const { reports, failedCompanies } = await reconcileAllCompanies(deps, {
    force: apply, allowMassDelete, dryRun: !apply, onWarn: (event, fields) => console.warn(event, JSON.stringify(fields)), companyIds: companies.length ? companies : undefined, onReport: printReport,
    onFailure: (companyId, error) => console.error(`company ${companyId} FAILED: ${error instanceof Error ? error.message : "unknown error"}`),
  });
  const sum = (pick: (r: ReconcileReport) => number) => reports.reduce((total, r) => total + pick(r), 0);
  console.log(`\nSummary: companies=${reports.length} failed=${failedCompanies.length} ${apply ? "corrected" : "would-correct"}=${sum((r) => r.corrected)} ` +
    `${apply ? "deleted" : "would-delete"}=${sum((r) => r.deleted)} skippedConcurrent=${sum((r) => r.skippedConcurrent)} drift=${sum((r) => r.drift)}`);
  if (!apply) console.log("Dry run: nothing was written. Re-run with --apply to write.");
  process.exitCode = failedCompanies.length > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
