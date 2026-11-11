#!/usr/bin/env node
// Backfill of the attendee snapshot on existing RSVPs: userDepartment and userJobTitle are copied from the
// member's users/{uid} document (the same fields setRsvpV1 snapshots at join and onUserProfileUpdated keeps
// current). Iterates companies/{c}/events/{e}/rsvps (no collection-group query). Only those two fields are
// written; status, counts, attendance and every other field are never touched.
// DRY-RUN BY DEFAULT: nothing is written unless --apply is passed. Safe to re-run (idempotent).
//
//   node gcp/scripts/backfill-rsvp-profile.mjs --project <PROJECT_ID> --company <ID> [--company <ID> ...]
//   node gcp/scripts/backfill-rsvp-profile.mjs --project <PROJECT_ID> --company <ID> --apply
//
// Credentials: Application Default Credentials, or FIRESTORE_EMULATOR_HOST for a local emulator.
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const valueOf = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const [project] = valueOf("--project");
const companies = valueOf("--company");
if (!project || project.startsWith("--") || companies.length === 0 || companies.some((c) => !c || c.startsWith("--"))) {
  console.error("Usage: backfill-rsvp-profile.mjs --project <PROJECT_ID> --company <ID> [--company <ID> ...] [--apply]");
  process.exit(2);
}
const apply = args.includes("--apply");

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

console.log(`${apply ? "APPLY" : "DRY-RUN"} against ${process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE project ${project}`}`);
const app = initializeApp({ projectId: project });
const db = getFirestore(app);

const text = (value) => (typeof value === "string" ? value : "");
const users = new Map();
async function userFor(uid) {
  if (!users.has(uid)) users.set(uid, (await db.collection("users").doc(uid).get()).data() ?? null);
  return users.get(uid);
}

let exitCode = 0;
for (const companyId of companies) {
  const counts = { events: 0, rsvps: 0, updated: 0, current: 0, missingUser: 0, otherCompany: 0 };
  let batch = db.batch();
  let pending = 0;
  const events = await db.collection("companies").doc(companyId).collection("events").select().get();
  for (const event of events.docs) {
    counts.events++;
    const rsvps = await event.ref.collection("rsvps").get();
    for (const rsvp of rsvps.docs) {
      counts.rsvps++;
      const uid = rsvp.get("userId");
      if (typeof uid !== "string" || uid !== rsvp.id) { counts.missingUser++; continue; }
      const user = await userFor(uid);
      if (!user) { counts.missingUser++; continue; }
      if (user.companyId !== companyId) { counts.otherCompany++; continue; }
      const patch = {};
      if (rsvp.get("userDepartment") !== text(user.department)) patch.userDepartment = text(user.department);
      if (rsvp.get("userJobTitle") !== text(user.jobTitle)) patch.userJobTitle = text(user.jobTitle);
      if (Object.keys(patch).length === 0) { counts.current++; continue; }
      console.log(`update    ${companyId}/${event.id}/${rsvp.id}  ${Object.keys(patch).join(", ")}`);
      counts.updated++;
      if (apply) {
        batch.update(rsvp.ref, patch);
        if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
      }
    }
  }
  if (apply && pending > 0) await batch.commit();
  console.log(`${apply ? "Applied" : "Would apply"} for ${companyId}: ${counts.updated} updated, ${counts.current} already current, ` +
    `${counts.missingUser} without a matching user, ${counts.otherCompany} users from another company, ${counts.rsvps} RSVPs across ${counts.events} events`);
  if (counts.otherCompany > 0) exitCode = 1;
}
await deleteApp(app);
process.exit(exitCode);
