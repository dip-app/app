#!/usr/bin/env node
// Idempotent backfill of the server-owned share index: eventShares/{eventId} = { companyId } for every
// existing companies/{c}/events/{eventId}. New events get the entry from createEventV1.
// See docs/design/share-links.md. DRY-RUN BY DEFAULT: nothing is written unless --apply is passed.
// Existing entries are never overwritten; an entry pointing at a different company is reported as a conflict.
//
//   node gcp/scripts/backfill-event-shares.mjs --project <PROJECT_ID>           # report only
//   node gcp/scripts/backfill-event-shares.mjs --project <PROJECT_ID> --apply   # create missing entries
//
// Credentials: Application Default Credentials, or FIRESTORE_EMULATOR_HOST for a local emulator.
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const project = args[args.indexOf("--project") + 1];
if (!args.includes("--project") || !project || project.startsWith("--")) {
  console.error("Usage: backfill-event-shares.mjs --project <PROJECT_ID> [--apply]");
  process.exit(2);
}
const apply = args.includes("--apply");

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore, FieldValue } = requireFromFunctions("firebase-admin/firestore");

console.log(`${apply ? "APPLY" : "DRY-RUN"} against ${process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE project ${project}`}`);
const app = initializeApp({ projectId: project });
const db = getFirestore(app);

const events = await db.collectionGroup("events").select("companyId").get();
const counts = { created: 0, ok: 0, conflict: 0, skipped: 0 };
const seen = new Map();
let batch = db.batch();
let pending = 0;
for (const doc of events.docs) {
  const companyId = doc.ref.parent.parent?.id;
  if (!companyId || doc.ref.parent.parent.parent.id !== "companies") { counts.skipped++; continue; }
  if (seen.has(doc.id) && seen.get(doc.id) !== companyId) { console.log(`CONFLICT  ${doc.id} exists in companies ${seen.get(doc.id)} and ${companyId}`); counts.conflict++; continue; }
  seen.set(doc.id, companyId);
  const shareRef = db.collection("eventShares").doc(doc.id);
  const existing = await shareRef.get();
  if (existing.exists) {
    if (existing.get("companyId") === companyId) counts.ok++;
    else { console.log(`CONFLICT  ${doc.id} index says ${existing.get("companyId")}, event is in ${companyId}`); counts.conflict++; }
    continue;
  }
  console.log(`create    eventShares/${doc.id} -> ${companyId}`);
  counts.created++;
  if (apply) {
    batch.create(shareRef, { companyId, createdAt: FieldValue.serverTimestamp() });
    if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
}
if (apply && pending > 0) await batch.commit();
console.log(`${apply ? "Applied" : "Would apply"}: ${counts.created} created, ${counts.ok} already present, ${counts.conflict} conflicts, ${counts.skipped} skipped`);
await deleteApp(app);
if (counts.conflict > 0) process.exit(1);
