// One-off, EMULATOR-ONLY helper: creates a claimed roster entry for every existing member of a company so the roster lists
// everyone (docs/contracts/admin.md). It refuses to run unless FIRESTORE_EMULATOR_HOST points at a local emulator, so it can
// never write to production. Idempotent; existing roster entries are never modified.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --import tsx gcp/scripts/backfill-roster.ts --company <ID> [--company <ID> ...]
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { backfillRoster } from "../functions/src/modules/admin/application/backfillRoster";
import { FirestoreAdminStore } from "../functions/src/modules/admin/infrastructure/firestoreAdminStore";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)) {
  console.error("Refusing to run: set FIRESTORE_EMULATOR_HOST to a local emulator (this helper must never touch production).");
  process.exit(2);
}
const args = process.argv.slice(2);
const companies = args.flatMap((a, i) => (a === "--company" && args[i + 1] ? [args[i + 1]!] : []));
if (companies.length === 0) {
  console.error("Usage: backfill-roster.ts --company <ID> [--company <ID> ...]");
  process.exit(2);
}
const app = getApps()[0] ?? initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-dip" });
const store = new FirestoreAdminStore(getFirestore(app));
for (const companyId of companies) {
  console.log(companyId, await backfillRoster(store, companyId));
}
