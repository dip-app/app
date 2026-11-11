import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { applyEmployeeImport, getEmployeeImport, importEmployees } from "../../functions/src/modules/admin/application/importEmployees";
import { revokeRosterEntry, upsertRosterEntry } from "../../functions/src/modules/admin/application/roster";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { emailHash, normalizeEmployee } from "../../functions/src/modules/admin/domain/employee";
import { caller, makeDeps, NOW, rid, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";

const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");
const sha = (email: string) => createHash("sha256").update(email).digest("hex");
const audits = (store: FakeAdminStore) => store.children("companies/alpha/auditLog").map(c => c.data);

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}

function seedTeams(store: FakeAdminStore) {
  store.seed("companies/alpha/teams/t-platform", { companyId: "alpha", name: "Platform", archived: false, revision: 1 });
  store.seed("companies/alpha/teams/t-sales", { companyId: "alpha", name: "Sales", archived: false, revision: 1 });
  store.seed("companies/alpha/teams/t-old", { companyId: "alpha", name: "Legacy", archived: true, revision: 1 });
}

describe("roster", () => {
  const entry = (extra: Record<string, unknown> = {}) => ({ email: "New.Hire@Alpha.test", displayName: "New Hire", role: "organizer", teamIds: ["Platform"], workLocation: "HQ", department: "Ops", jobTitle: "Lead", ...extra });
  const upsert = (e: Record<string, unknown> = entry()) => ({ ...base, requestId: rid(), entry: e });

  test("pre-provisions a person under the SHA-256 of the lower-case email with resolved teams, and audits", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedTeams(store);
    const result = await upsertRosterEntry(deps, admin, upsert());
    assert.deepEqual(result, { contractVersion: 1, entryId: sha("new.hire@alpha.test"), created: true, status: "invited" });
    const doc = store.get(`companies/alpha/roster/${result.entryId}`)!;
    assert.equal(doc.email, "new.hire@alpha.test");
    assert.equal(doc.role, "organizer");
    assert.deepEqual(doc.teamIds, ["t-platform"]);
    assert.equal(doc.status, "invited");
    assert.equal(doc.invitedBy, "admin1");
    assert.equal(doc.source, "manual");
    assert.equal(audits(store)[0]!.action, "roster.upsert");
  });

  test("updating changes only supplied fields; a repeat is a no-op", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedTeams(store);
    const { entryId } = await upsertRosterEntry(deps, admin, upsert());
    const again = await upsertRosterEntry(deps, admin, upsert({ email: "new.hire@alpha.test", workLocation: "Remote" }));
    assert.equal(again.created, false);
    const doc = store.get(`companies/alpha/roster/${entryId}`)!;
    assert.equal(doc.workLocation, "Remote");
    assert.equal(doc.department, "Ops");
    assert.equal(doc.revision, 2);
    const noop = await upsertRosterEntry(deps, admin, upsert({ email: "new.hire@alpha.test", workLocation: "Remote" }));
    assert.equal(noop.created, false);
    assert.equal(store.get(`companies/alpha/roster/${entryId}`)!.revision, 2);
  });

  test("an existing member's email, a foreign domain, an unknown or archived team and bad fields are refused", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedTeams(store);
    await fails(upsertRosterEntry(deps, admin, upsert(entry({ email: "mia@alpha.test" }))), "failed-precondition", "EMAIL_ALREADY_MEMBER");
    await fails(upsertRosterEntry(deps, admin, upsert(entry({ email: "someone@beta.test" }))), "invalid-argument", "EMAIL_DOMAIN_MISMATCH");
    await fails(upsertRosterEntry(deps, admin, upsert(entry({ teamIds: ["Nope"] }))), "invalid-argument", "TEAM_NOT_FOUND");
    await fails(upsertRosterEntry(deps, admin, upsert(entry({ teamIds: ["Legacy"] }))), "invalid-argument", "TEAM_NOT_FOUND");
    for (const patch of [{ role: "root" }, { startDate: "2030-02-31" }, { email: "not-an-email" }, { unknown: 1 }]) {
      await assert.rejects(upsertRosterEntry(deps, admin, upsert(entry(patch))), (e: AdminError) => e.code === "invalid-argument");
    }
    assert.equal(store.children("companies/alpha/roster").length, 0);
  });

  test("subdomain addresses of the company's root domain are accepted", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    assert.equal((await upsertRosterEntry(deps, admin, upsert(entry({ email: "lee@eng.alpha.test", teamIds: undefined })))).created, true);
  });

  test("revoke marks an invited entry revoked, is idempotent, ignores claimed entries and is tenant scoped", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedTeams(store);
    const { entryId } = await upsertRosterEntry(deps, admin, upsert());
    const body = { ...base, requestId: rid(), entryId };
    assert.deepEqual(await revokeRosterEntry(deps, admin, body), { contractVersion: 1, entryId, status: "revoked", changed: true });
    assert.deepEqual(await revokeRosterEntry(deps, admin, body), { contractVersion: 1, entryId, status: "revoked", changed: true });
    assert.equal((await revokeRosterEntry(deps, admin, { ...body, requestId: rid() })).changed, false);
    store.seed(`companies/alpha/roster/${sha("c@alpha.test")}`, { companyId: "alpha", email: "c@alpha.test", status: "claimed", revision: 1 });
    assert.equal((await revokeRosterEntry(deps, admin, { ...base, requestId: rid(), entryId: sha("c@alpha.test") })).status, "claimed");
    await fails(revokeRosterEntry(deps, admin, { ...base, requestId: rid(), entryId: sha("ghost@alpha.test") }), "not-found", "ROSTER_ENTRY_NOT_FOUND");
    await fails(revokeRosterEntry(deps, caller("bo"), { ...base, requestId: rid(), entryId }), "permission-denied", "COMPANY_MISMATCH");
    assert.equal(audits(store).filter(a => a.action === "roster.revoke").length, 1);
  });

  test("re-inviting a revoked entry restores it", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const { entryId } = await upsertRosterEntry(deps, admin, upsert(entry({ teamIds: undefined })));
    await revokeRosterEntry(deps, admin, { ...base, requestId: rid(), entryId });
    await upsertRosterEntry(deps, admin, upsert(entry({ teamIds: undefined })));
    assert.equal(store.get(`companies/alpha/roster/${entryId}`)!.status, "invited");
  });

  test("emailHash is lower-case SHA-256", () => {
    assert.equal(emailHash("  MiXed@Alpha.test "), sha("mixed@alpha.test"));
  });
});

describe("employee normalization", () => {
  const ctx = { companyDomain: "alpha.test", teams: [{ id: "t1", name: "Platform", archived: false }] };
  test("trims cells, treats blanks as absent, lower-cases emails and resolves team names or ids", () => {
    const { record, issues } = normalizeEmployee({ email: "  A@Alpha.test ", displayName: "  Ann   Lee ", role: " Admin ", workLocation: "", teamIds: [" platform ", "t1"], managerEmail: "BOSS@alpha.test", startDate: "2030-05-01" }, ctx);
    assert.deepEqual(issues, []);
    assert.deepEqual(record, { email: "a@alpha.test", displayName: "Ann Lee", role: "admin", teamIds: ["t1"], managerEmail: "boss@alpha.test", startDate: "2030-05-01" });
  });
  test("reports every problem with a stable code", () => {
    const { issues } = normalizeEmployee({ email: "x@other.test", role: "ceo", startDate: "05/01/2030", teamIds: ["Ghost"], jobTitle: "x".repeat(121), zzz: 1 }, ctx);
    assert.deepEqual(issues.map(i => `${i.field}:${i.code}`).sort(),
      ["email:EMAIL_DOMAIN_MISMATCH", "jobTitle:TOO_LONG", "role:ROLE_INVALID", "startDate:DATE_INVALID", "teamIds:TEAM_NOT_FOUND", "zzz:UNKNOWN_FIELD"]);
    assert.equal(normalizeEmployee("nope", ctx).issues[0]!.code, "VALIDATION_FAILED");
  });
});

describe("bulk import", () => {
  const rows = () => [
    { email: "Mia@alpha.test", role: "member", teamIds: ["Sales"], workLocation: "HQ", displayName: "Ignored Name" }, // update existing member
    { email: "max@alpha.test", department: "Sales" }, // unchanged
    { email: "fresh@alpha.test", displayName: "Fresh Hire", role: "organizer", teamIds: ["Platform"], jobTitle: "Lead" }, // create
    { email: "bad@other.test" }, // invalid domain
    { email: "FRESH@alpha.test" }, // duplicate in file
    { email: "ada@alpha.test", role: "member" }, // admin protected
    { email: "", role: "member" }, // missing email
  ];
  const plan = (extra: Record<string, unknown> = {}) => ({ ...base, requestId: rid(), fileName: "people.csv", rows: rows(), ...extra });
  function setup() {
    const ctx = makeDeps();
    seedCompany(ctx.store); seedTeams(ctx.store);
    return ctx;
  }

  test("the dry run plans create / update / unchanged / invalid with field-level diffs and writes only the job", async () => {
    const { deps, store } = setup();
    const result = await importEmployees(deps, admin, plan());
    assert.deepEqual(result.totals, { total: 7, create: 1, update: 1, unchanged: 1, invalid: 4 });
    assert.deepEqual(result.rows.map(r => r.action), ["update", "unchanged", "create", "invalid", "invalid", "invalid", "invalid"]);
    assert.equal(result.rows[0]!.target, "member");
    assert.deepEqual(result.rows[0]!.changes.map(c => c.field).sort(), ["teamIds", "workLocation"]);
    assert.equal(result.rows[2]!.target, "roster");
    assert.equal(result.rows[3]!.errors[0]!.code, "EMAIL_DOMAIN_MISMATCH");
    assert.equal(result.rows[4]!.errors[0]!.code, "DUPLICATE_EMAIL");
    assert.equal(result.rows[5]!.errors[0]!.code, "ADMIN_ROLE_PROTECTED");
    assert.equal(result.rows[6]!.errors[0]!.code, "EMAIL_REQUIRED");
    assert.equal(result.status, "planned");
    // Nothing but the job, its chunk, the receipt and the plan audit entry was written; members and roster are untouched.
    assert.equal(store.get("users/m1")!.workLocation, undefined);
    assert.equal(store.children("companies/alpha/roster").length, 0);
    assert.equal(store.children("companies/alpha/importJobs").length, 1);
    assert.deepEqual(audits(store).map(a => a.action), ["import.plan"]);
  });

  test("the same requestId and rows return the same job; other rows reuse fails", async () => {
    const { deps, store } = setup();
    const body = plan();
    const first = await importEmployees(deps, admin, body);
    const second = await importEmployees(deps, admin, body);
    assert.deepEqual(second, first);
    assert.equal(store.children("companies/alpha/importJobs").length, 1);
    await fails(importEmployees(deps, admin, { ...body, rows: [{ email: "x@alpha.test" }] }), "failed-precondition", "REQUEST_REUSED");
  });

  test("apply processes chunks, updates members, invites new people, never touches protected fields, and reports errors", async () => {
    const { deps, store } = setup();
    const planned = await importEmployees(deps, admin, plan());
    const applied = await applyEmployeeImport(deps, admin, { ...base, jobId: planned.jobId, planHash: planned.planHash });
    assert.equal(applied.done, true);
    assert.equal(applied.status, "completed_with_errors");
    assert.deepEqual(applied.progress, { processed: 7, total: 7, created: 1, updated: 1, unchanged: 1, failed: 4 });
    assert.deepEqual(applied.results.map(r => r.outcome), ["updated", "unchanged", "created", "failed", "failed", "failed", "failed"]);
    const mia = store.get("users/m1")!;
    assert.equal(mia.workLocation, "HQ");
    assert.deepEqual(mia.teamIds, ["t-sales"]);
    assert.equal(mia.displayName, "Mia Member", "Google-owned name is never overwritten");
    assert.equal(mia.pointsBalance, 100);
    assert.equal(mia.revision, 1);
    assert.equal(store.get("users/admin1")!.role, "admin");
    const entry = store.get(`companies/alpha/roster/${sha("fresh@alpha.test")}`)!;
    assert.equal(entry.status, "invited");
    assert.equal(entry.source, "import");
    assert.equal(entry.role, "organizer");
    assert.deepEqual(entry.teamIds, ["t-platform"]);
    assert.equal(entry.importJobId, planned.jobId);
    const report = await getEmployeeImport(deps, admin, { ...base, jobId: planned.jobId });
    assert.equal(report.job.errors.length, 4);
    assert.equal(report.job.errors[0]!.errorCode, "EMAIL_DOMAIN_MISMATCH");
    assert.equal(report.job.status, "completed_with_errors");
    assert.equal(report.job.errorsTruncated, false);
    assert.ok(audits(store).some(a => a.action === "import.apply" && a.targetType === "member"));
    assert.ok(audits(store).some(a => a.action === "import.apply" && a.targetType === "import"));
    // Re-applying a finished job is a read-only no-op.
    const writes = store.writes;
    const again = await applyEmployeeImport(deps, admin, { ...base, jobId: planned.jobId, planHash: planned.planHash });
    assert.equal(again.done, true);
    assert.equal(store.writes, writes);
  });

  test("re-running the same file after an apply finds everything unchanged (idempotent re-runs)", async () => {
    const { deps } = setup();
    const first = await importEmployees(deps, admin, plan());
    await applyEmployeeImport(deps, admin, { ...base, jobId: first.jobId, planHash: first.planHash });
    const second = await importEmployees(deps, admin, plan());
    assert.deepEqual(second.totals, { total: 7, create: 0, update: 0, unchanged: 3, invalid: 4 });
    assert.equal(second.rows[2]!.target, "roster");
    const applied = await applyEmployeeImport(deps, admin, { ...base, jobId: second.jobId, planHash: second.planHash });
    assert.equal(applied.progress.created + applied.progress.updated, 0);
  });

  test("large files are applied one chunk of 100 rows per call and resume where they stopped", async () => {
    const { deps, store } = setup();
    const many = Array.from({ length: 250 }, (_, i) => ({ email: `p${i}@alpha.test`, jobTitle: `Role ${i}` }));
    const planned = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: many });
    assert.equal(planned.chunkCount, 3);
    const body = { ...base, jobId: planned.jobId, planHash: planned.planHash };
    const one = await applyEmployeeImport(deps, admin, body);
    assert.equal(one.done, false);
    assert.equal(one.status, "running");
    assert.equal(one.progress.processed, 100);
    assert.equal(store.children("companies/alpha/roster").length, 100);
    const two = await applyEmployeeImport(deps, admin, body);
    const three = await applyEmployeeImport(deps, admin, body);
    assert.equal(two.progress.processed, 200);
    assert.equal(three.done, true);
    assert.equal(three.status, "completed");
    assert.equal(three.progress.created, 250);
    assert.equal(store.children("companies/alpha/roster").length, 250);
  });

  test("a wrong plan hash, a foreign job and an active lease are refused", async () => {
    const { deps, store } = setup();
    const planned = await importEmployees(deps, admin, plan());
    const body = { ...base, jobId: planned.jobId, planHash: planned.planHash };
    await fails(applyEmployeeImport(deps, admin, { ...body, planHash: "0".repeat(64) }), "failed-precondition", "IMPORT_PLAN_MISMATCH");
    await fails(applyEmployeeImport(deps, admin, { ...body, jobId: "ghost" }), "not-found", "IMPORT_JOB_NOT_FOUND");
    await fails(applyEmployeeImport(deps, caller("bo"), body), "permission-denied", "COMPANY_MISMATCH");
    store.seed(`companies/alpha/importJobs/${planned.jobId}`, { ...store.get(`companies/alpha/importJobs/${planned.jobId}`)!, leaseId: "other", leaseUntil: new Date(NOW.getTime() + 60_000) });
    await fails(applyEmployeeImport(deps, admin, body), "aborted", "IMPORT_JOB_BUSY");
    store.seed(`companies/alpha/importJobs/${planned.jobId}`, { ...store.get(`companies/alpha/importJobs/${planned.jobId}`)!, leaseUntil: new Date(NOW.getTime() - 1) });
    assert.equal((await applyEmployeeImport(deps, admin, body)).done, true);
  });

  test("concurrent applies never double-process a chunk", async () => {
    const { deps, store } = setup();
    const planned = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: Array.from({ length: 150 }, (_, i) => ({ email: `q${i}@alpha.test` })) });
    const body = { ...base, jobId: planned.jobId, planHash: planned.planHash };
    const results = await Promise.allSettled([applyEmployeeImport(deps, admin, body), applyEmployeeImport(deps, caller("admin2"), body)]);
    assert.ok(results.some(r => r.status === "fulfilled"));
    for (const r of results) if (r.status === "rejected") assert.equal((r.reason as AdminError).reason, "IMPORT_JOB_BUSY");
    await applyEmployeeImport(deps, admin, body).catch(() => undefined);
    await applyEmployeeImport(deps, admin, body).catch(() => undefined);
    assert.equal(store.children("companies/alpha/roster").length, 150);
  });

  test("an existing invited roster entry is updated, a revoked one re-invited, and stale plans converge", async () => {
    const { deps, store } = setup();
    store.seed(`companies/alpha/roster/${sha("fresh@alpha.test")}`, { companyId: "alpha", email: "fresh@alpha.test", displayName: "", role: "member", teamIds: [], workLocation: "", department: "", jobTitle: "", status: "revoked", revision: 3 });
    const planned = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: [{ email: "fresh@alpha.test", jobTitle: "Lead" }, { email: "late@alpha.test" }] });
    assert.deepEqual(planned.rows.map(r => `${r.action}:${r.target}`), ["update:roster", "create:roster"]);
    // The person signs up between plan and apply: the live decision updates the member instead of the roster.
    store.seed("users/late", { ...store.get("users/m3")!, email: "late@alpha.test", displayName: "Lee Late" });
    const applied = await applyEmployeeImport(deps, admin, { ...base, jobId: planned.jobId, planHash: planned.planHash });
    assert.equal(applied.progress.failed, 0);
    const entry = store.get(`companies/alpha/roster/${sha("fresh@alpha.test")}`)!;
    assert.equal(entry.status, "invited");
    assert.equal(entry.jobTitle, "Lead");
    assert.equal(entry.revision, 4);
    assert.equal(store.get(`companies/alpha/roster/${sha("late@alpha.test")}`), undefined);
  });

  test("oversized and empty uploads, malformed rows and members of other roles are refused", async () => {
    const { deps } = setup();
    await fails(importEmployees(deps, admin, { ...base, requestId: rid(), rows: Array.from({ length: 2001 }, (_, i) => ({ email: `a${i}@alpha.test` })) }), "invalid-argument", "IMPORT_TOO_LARGE");
    await fails(importEmployees(deps, admin, { ...base, requestId: rid(), rows: [] }), "invalid-argument", "VALIDATION_FAILED");
    await fails(importEmployees(deps, caller("org1"), plan()), "permission-denied", "INSUFFICIENT_ROLE");
    const result = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: [null, 5, "x", [], { email: ["a"] }] });
    assert.equal(result.totals.invalid, 5);
  });
});
