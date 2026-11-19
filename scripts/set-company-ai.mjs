#!/usr/bin/env node
// Turn Dipbot (AI) off or back on for ONE company. AI is on by default for every company (issue #196, AI-10);
// this writes the explicit per-company opt-out in the server-only companies/{id}/aiSettings/current document.
// Idempotent (merge write of the single field `enabled`; other overrides such as monthlyCredits are kept) and
// DRY-RUN BY DEFAULT: nothing is written unless --apply is passed.
//
//   node scripts/set-company-ai.mjs --project <PROJECT_ID> --company <COMPANY_ID> --off            # report only
//   node scripts/set-company-ai.mjs --project <PROJECT_ID> --company <COMPANY_ID> --off --apply    # opt out
//   node scripts/set-company-ai.mjs --project <PROJECT_ID> --company <COMPANY_ID> --on --apply     # opt back in
//
// Credentials: Application Default Credentials (gcloud auth application-default login), or FIRESTORE_EMULATOR_HOST.
// The deployment switch AI_EVENTS_ENABLED and the other kill switches still apply on top of this. Never commit credentials.
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  const v = i === -1 ? undefined : args[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
};
const project = value("--project");
const companyId = value("--company");
if (!project || !companyId || flag("--on") === flag("--off") || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) {
  console.error("Usage: set-company-ai.mjs --project <PROJECT_ID> --company <COMPANY_ID> (--on | --off) [--apply]");
  process.exit(2);
}
const enabled = flag("--on");
const apply = flag("--apply");

const requireFromFunctions = createRequire(new URL("../gcp/functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE project ${project}`;
console.log(`${apply ? "APPLY" : "DRY-RUN"} against ${target}`);
const app = initializeApp({ projectId: project });
const db = getFirestore(app);
try {
  const company = await db.doc(`companies/${companyId}`).get();
  if (!company.exists) {
    console.error(`companies/${companyId} does not exist; nothing to do.`);
    process.exitCode = 1;
  } else {
    const ref = db.doc(`companies/${companyId}/aiSettings/current`);
    const before = await ref.get();
    const current = before.exists ? before.get("enabled") : undefined;
    const effective = current === undefined || current === true;
    console.log(`Dipbot is currently ${effective ? "ON" : "OFF"} for ${companyId} (enabled field: ${current === undefined ? "missing" : JSON.stringify(current)}).`);
    if (current === enabled) console.log("Already set; nothing to write.");
    else if (!apply) console.log(`Would set enabled=${enabled}. Re-run with --apply.`);
    else {
      await ref.set({ enabled }, { merge: true });
      console.log(`Set enabled=${enabled}.`);
    }
  }
} finally {
  await deleteApp(app);
}
