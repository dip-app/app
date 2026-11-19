// Removes the roster fields DIP no longer stores (managerEmail, startDate; docs/design/roster-data-minimization.md) from
// users/{uid} profiles and companies/{c}/roster/{entryId} entries. DRY RUN by default: nothing is written without --apply.
//
//   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --import tsx gcp/scripts/remove-unused-roster-fields.ts [--apply]
//   Production: node --import tsx gcp/scripts/remove-unused-roster-fields.ts --project <ID>                              (dry run)
//               node --import tsx gcp/scripts/remove-unused-roster-fields.ts --project <ID> --apply --yes-owner-approved (owner approval)
//
// Reads only the two field names (a field mask), never prints a value, an email or a document id: the output is counts only.
// --apply deletes exactly those two fields and nothing else (no revision bump, no updatedAt), one document at a time with a
// last-update-time precondition, so a document written in between is reported as skippedConcurrent and left for a rerun.
// Idempotent: a rerun finds nothing left to remove. Not undoable (the values are gone by design): export Firestore first.
// Triggers: deleting fields on users/{uid} fires onUserProfileUpdated, which ignores these fields (no RSVP snapshot change).
import { createRequire } from "node:module";

// firebase-admin lives in the Functions workspace; load it from there (docs/ops/seed-data.md).
const req = createRequire(require.resolve("../functions/package.json"));
const { getApps, initializeApp } = req("firebase-admin/app") as typeof import("firebase-admin/app");
const { FieldPath, FieldValue, getFirestore } = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

export const REMOVED_FIELDS = ["managerEmail", "startDate"] as const;
const PAGE = 500;

const args = process.argv.slice(2);
const valueOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1] : undefined; };
const project = valueOf("--project");
const apply = args.includes("--apply");
const ownerApproved = args.includes("--yes-owner-approved");

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
console.log(`${apply ? "APPLY" : "DRY-RUN"} ${localEmulator ? `emulator ${host}` : `LIVE project ${project}`}`);
if (apply && !localEmulator) console.log(`Before applying, export Firestore: gcloud firestore export gs://<backup-bucket>/pre-remove-unused-roster-fields --project ${project}`);

const app = getApps()[0] ?? initializeApp({ projectId: project ?? process.env.GCLOUD_PROJECT ?? "demo-dip" });
const db = getFirestore(app);

interface Tally { scanned: number; withField: number; managerEmail: number; startDate: number; removed: number; skippedConcurrent: number }
const tally = (): Tally => ({ scanned: 0, withField: 0, managerEmail: 0, startDate: 0, removed: 0, skippedConcurrent: 0 });

/** Field names present on a document (the value is never read past this check). */
export function presentFields(data: Record<string, unknown>): string[] {
  return REMOVED_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(data, field));
}

async function sweep(label: string, base: FirebaseFirestore.Query, keep: (path: string) => boolean): Promise<Tally> {
  const t = tally();
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let page = base.select(...REMOVED_FIELDS).orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) page = page.startAfter(last);
    const snap = await page.get();
    for (const doc of snap.docs) {
      if (!keep(doc.ref.path)) continue;
      t.scanned += 1;
      const fields = presentFields(doc.data());
      if (fields.length === 0) continue;
      t.withField += 1;
      for (const field of fields) t[field] += 1;
      if (!apply) continue;
      const patch: Record<string, FirebaseFirestore.FieldValue> = {};
      for (const field of fields) patch[field] = FieldValue.delete();
      try {
        await doc.ref.update(patch, { lastUpdateTime: doc.updateTime });
        t.removed += 1;
      } catch {
        t.skippedConcurrent += 1; // changed (or deleted) since the read: rerun to pick it up
      }
    }
    if (snap.docs.length < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(`${label}: scanned=${t.scanned} with-removed-fields=${t.withField} managerEmail=${t.managerEmail} startDate=${t.startDate}` +
    (apply ? ` removed=${t.removed} skippedConcurrent=${t.skippedConcurrent}` : ""));
  return t;
}

async function main(): Promise<void> {
  const users = await sweep("users", db.collection("users"), () => true);
  const roster = await sweep("roster entries", db.collectionGroup("roster"), path => /^companies\/[^/]+\/roster\/[^/]+$/.test(path));
  const total = users.withField + roster.withField;
  console.log(`\nSummary: documents with removed fields=${total} (users=${users.withField}, roster=${roster.withField})` +
    (apply ? ` removed=${users.removed + roster.removed} skippedConcurrent=${users.skippedConcurrent + roster.skippedConcurrent}` : ""));
  if (!apply) console.log("Dry run: nothing was written. Re-run with --apply (and --yes-owner-approved for a live project) to remove the fields.");
  process.exitCode = users.skippedConcurrent + roster.skippedConcurrent > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
