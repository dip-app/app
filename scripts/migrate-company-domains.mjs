#!/usr/bin/env node
// One-off, idempotent migration: companyDomains/{rootDomain} -> companies/{id}.emailDomain.
// See docs/adr/0007-oauth-domain-based-sign-in.md. DRY-RUN BY DEFAULT: nothing is written
// unless --apply is passed, and mapping documents are deleted only with --apply --delete.
//
//   node scripts/migrate-company-domains.mjs --project <PROJECT_ID>                  # report only
//   node scripts/migrate-company-domains.mjs --project <PROJECT_ID> --apply          # set emailDomain
//   node scripts/migrate-company-domains.mjs --project <PROJECT_ID> --apply --delete # + delete verified mappings
//
// Flags: --overwrite-email-domain  replace a different existing companies.emailDomain
//                                  (needed e.g. when a test mapping like cmu.edu points at
//                                  a company whose emailDomain is descriptive text).
// Credentials: Application Default Credentials (gcloud auth application-default login),
// or FIRESTORE_EMULATOR_HOST for a local emulator. Never commit credentials.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const project = args[args.indexOf("--project") + 1];
if (!flag("--project") || !project || project.startsWith("--")) {
  console.error("Usage: migrate-company-domains.mjs --project <PROJECT_ID> [--apply] [--delete] [--overwrite-email-domain]");
  process.exit(2);
}
const apply = flag("--apply");
const doDelete = flag("--delete");
const overwrite = flag("--overwrite-email-domain");
if (doDelete && !apply) { console.error("--delete requires --apply."); process.exit(2); }

const requireFromFunctions = createRequire(new URL("../gcp/functions/package.json", import.meta.url));
const { getDomain } = requireFromFunctions("tldts");
const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
const personal = new Set(JSON.parse(readFileSync(
  new URL("../gcp/functions/src/modules/accounts/domain/personal-email-domains.json", import.meta.url), "utf8")));

const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE project ${project}`;
console.log(`${apply ? "APPLY" : "DRY-RUN"}${doDelete ? " +delete" : ""} against ${target}`);

const app = initializeApp({ projectId: project });
const db = getFirestore(app);

const [mappings, companies] = await Promise.all([db.collection("companyDomains").get(), db.collection("companies").get()]);
const company = new Map(companies.docs.map((d) => [d.id, d.get("emailDomain")]));

const blockers = [];   // anything here blocks deletion of every mapping
const plan = [];       // { domain, companyId, action: ok|set|normalize|overwrite|skip, reason }
const perCompany = new Map();
for (const m of mappings.docs) {
  const domain = m.id;
  const companyId = m.get("companyId");
  if (typeof companyId !== "string" || companyId === "") { plan.push({ domain, action: "skip", reason: "malformed mapping (no string companyId); delete manually after review" }); continue; }
  if (getDomain(domain, { allowPrivateDomains: false }) !== domain || personal.has(domain) || domain !== domain.toLowerCase()) {
    plan.push({ domain, companyId, action: "skip", reason: "key is not a lowercase non-personal root domain; it never matched sign-ins" }); continue;
  }
  if (!company.has(companyId)) { plan.push({ domain, companyId, action: "skip", reason: "company document missing (orphan); it never granted membership" }); continue; }
  perCompany.set(companyId, [...(perCompany.get(companyId) ?? []), domain]);
  plan.push({ domain, companyId, action: "pending" });
}
for (const item of plan) {
  if (item.action !== "pending") continue;
  const domains = perCompany.get(item.companyId);
  const current = company.get(item.companyId);
  if (domains.length > 1) { item.action = "skip"; item.reason = `company has several mapped domains (${domains.join(", ")}); emailDomain holds one. Decide manually`; blockers.push(item); }
  else if (current === item.domain) item.action = "ok";
  else if (typeof current === "string" && current.toLowerCase() === item.domain) { item.action = "normalize"; }
  else if (current === undefined || current === null || current === "") item.action = "set";
  else if (overwrite) { item.action = "overwrite"; item.reason = `replaces existing emailDomain ${JSON.stringify(current)}`; }
  else { item.action = "skip"; item.reason = `companies emailDomain is ${JSON.stringify(current)}; rerun with --overwrite-email-domain to replace`; blockers.push(item); }
}

// Final emailDomain per company after the plan; that set must be unique (one company per domain).
const finalDomain = new Map(company);
for (const item of plan) if (["set", "normalize", "overwrite"].includes(item.action)) finalDomain.set(item.companyId, item.domain);
const owners = new Map();
for (const [id, domain] of finalDomain) if (typeof domain === "string" && domain) owners.set(domain.toLowerCase(), [...(owners.get(domain.toLowerCase()) ?? []), id]);
for (const [domain, ids] of owners) if (ids.length > 1) blockers.push({ domain, reason: `duplicate emailDomain across companies ${ids.join(", ")}` });

for (const item of plan) console.log(`${item.action.padEnd(9)} ${item.domain} -> ${item.companyId ?? "?"}${item.reason ? `  (${item.reason})` : ""}`);
for (const b of blockers) console.log(`BLOCKER   ${b.domain}: ${b.reason}`);
console.log(`${mappings.size} mapping(s), ${companies.size} company document(s), ${blockers.length} blocker(s).`);

if (apply) {
  const writes = plan.filter((i) => ["set", "normalize", "overwrite"].includes(i.action));
  const duplicateBlocked = blockers.some((b) => !b.companyId && !b.action);
  if (duplicateBlocked) { console.error("Refusing to write: duplicate emailDomain values would break unique-domain-per-company."); process.exitCode = 1; }
  else {
    for (const item of writes) await db.doc(`companies/${item.companyId}`).update({ emailDomain: item.domain });
    console.log(`Updated ${writes.length} company document(s).`);
    if (doDelete) {
      if (blockers.length) { console.error("Not deleting: resolve blockers first (nothing deleted)."); process.exitCode = 1; }
      else {
        let deleted = 0;
        for (const item of plan.filter((i) => ["ok", "set", "normalize", "overwrite"].includes(i.action))) {
          // Re-read to verify the company now carries the domain before removing the mapping.
          const fresh = await db.doc(`companies/${item.companyId}`).get();
          if (fresh.get("emailDomain") !== item.domain) { console.error(`Keeping ${item.domain}: verification failed.`); process.exitCode = 1; continue; }
          await db.doc(`companyDomains/${item.domain}`).delete();
          deleted += 1;
        }
        console.log(`Deleted ${deleted} verified mapping(s). Orphan/malformed/skipped mappings were left in place.`);
      }
    }
  }
} else {
  console.log("Dry run: nothing written. Re-run with --apply to set emailDomain, then --apply --delete to remove verified mappings.");
}
if (blockers.length) process.exitCode = 1;
await deleteApp(app);
