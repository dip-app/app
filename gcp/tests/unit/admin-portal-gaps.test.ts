import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { backfillRosterCallable } from "../../functions/src/modules/admin/application/backfillRoster";
import { applyEmployeeImport, importEmployees } from "../../functions/src/modules/admin/application/importEmployees";
import { listMembers } from "../../functions/src/modules/admin/application/members";
import { listRoster, resendRosterInvite, upsertRosterEntry } from "../../functions/src/modules/admin/application/roster";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { progressFromTallies, tallyOf } from "../../functions/src/modules/admin/domain/importPlan";
import { caller, makeDeps, rid, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";

const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");
const sha = (email: string) => createHash("sha256").update(email).digest("hex");
const entryPath = (email: string) => `companies/alpha/roster/${sha(email)}`;
const audits = (store: FakeAdminStore) => store.children("companies/alpha/auditLog").map(c => c.data);

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}

describe("resendRosterInviteV1", () => {
  async function setup() {
    const ctx = makeDeps();
    seedCompany(ctx.store);
    await upsertRosterEntry(ctx.deps, admin, { ...base, requestId: rid(), entry: { email: "new.hire@alpha.test", displayName: "New Hire", role: "member" } });
    return ctx;
  }

  test("records the resend, returns the link and message, audits, and is idempotent per requestId", async () => {
    const { deps, store } = await setup();
    const body = { ...base, requestId: rid(), entryId: sha("new.hire@alpha.test") };
    const first = await resendRosterInvite(deps, admin, body);
    assert.equal(first.resendCount, 1);
    assert.equal(first.status, "invited");
    assert.equal(first.signInUrl, "https://letsdip.work");
    assert.match(first.message, /^Hi New, you're set up on DIP at Alpha\./);
    assert.match(first.message, /new\.hire@alpha\.test/);
    const stored = store.get(entryPath("new.hire@alpha.test"))!;
    assert.deepEqual([stored.resendCount, stored.lastResentBy], [1, "admin1"]);
    assert.equal(audits(store).filter(a => a.action === "roster.resend").length, 1);
    assert.deepEqual(await resendRosterInvite(deps, admin, body), first);
    assert.equal(store.get(entryPath("new.hire@alpha.test"))!.resendCount, 1, "a replay does not count twice");
    assert.equal(audits(store).filter(a => a.action === "roster.resend").length, 1);
    assert.equal((await resendRosterInvite(deps, admin, { ...body, requestId: rid() })).resendCount, 2);
    await fails(resendRosterInvite(deps, admin, { ...body, entryId: sha("other@alpha.test") }), "failed-precondition", "REQUEST_REUSED");
  });

  test("organizers and admins get the admin portal link; claimed, revoked, missing and cross-tenant entries are refused; the count is capped", async () => {
    const { deps, store } = await setup();
    await upsertRosterEntry(deps, admin, { ...base, requestId: rid(), entry: { email: "boss@alpha.test", displayName: "Boss", role: "admin" } });
    assert.equal((await resendRosterInvite(deps, admin, { ...base, requestId: rid(), entryId: sha("boss@alpha.test") })).signInUrl, "https://letsdip.work/admin/");
    store.seed(entryPath("claimed@alpha.test"), { companyId: "alpha", email: "claimed@alpha.test", status: "claimed", revision: 1 });
    store.seed(entryPath("gone@alpha.test"), { companyId: "alpha", email: "gone@alpha.test", status: "revoked", revision: 1 });
    await fails(resendRosterInvite(deps, admin, { ...base, requestId: rid(), entryId: sha("claimed@alpha.test") }), "failed-precondition", "ROSTER_ENTRY_CLAIMED");
    await fails(resendRosterInvite(deps, admin, { ...base, requestId: rid(), entryId: sha("gone@alpha.test") }), "failed-precondition", "ROSTER_ENTRY_NOT_INVITED");
    await fails(resendRosterInvite(deps, admin, { ...base, requestId: rid(), entryId: sha("ghost@alpha.test") }), "not-found", "ROSTER_ENTRY_NOT_FOUND");
    await fails(resendRosterInvite(deps, caller("bo"), { ...base, requestId: rid(), entryId: sha("new.hire@alpha.test") }), "permission-denied", "COMPANY_MISMATCH");
    store.seed(entryPath("new.hire@alpha.test"), { ...store.get(entryPath("new.hire@alpha.test"))!, resendCount: 10 });
    await fails(resendRosterInvite(deps, admin, { ...base, requestId: rid(), entryId: sha("new.hire@alpha.test") }), "resource-exhausted", "RESEND_LIMIT");
  });
});

describe("listRosterV1", () => {
  test("pages with a cursor, filters by state and search, and returns exact counts on the first page", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    for (let i = 0; i < 12; i++) {
      const email = `p${String(i).padStart(2, "0")}@alpha.test`;
      store.seed(entryPath(email), {
        companyId: "alpha", email, displayName: `Person ${i}`, role: "member", teamIds: [], workLocation: i % 2 ? "Remote" : "HQ", department: "", jobTitle: "",
        status: i < 6 ? "invited" : i < 9 ? "claimed" : i < 11 ? "revoked" : "claimed", memberStatus: i === 11 ? "deactivated" : "active",
        source: "import", createdAt: new Date("2030-01-01T00:00:00Z"), updatedAt: new Date("2030-01-01T00:00:00Z"), revision: 1,
      });
    }
    const first = await listRoster(deps, admin, { ...base, pageSize: 5 });
    assert.equal(first.entries.length, 5);
    assert.ok(first.nextPageToken);
    assert.deepEqual(first.counts, { all: 12, invited: 6, active: 3, deactivated: 1, revoked: 2 });
    const seen = new Set(first.entries.map(e => e.id));
    let token = first.nextPageToken;
    while (token) {
      const page = await listRoster(deps, admin, { ...base, pageSize: 5, pageToken: token });
      assert.equal(page.counts, undefined);
      for (const e of page.entries) { assert.ok(!seen.has(e.id)); seen.add(e.id); }
      token = page.nextPageToken;
    }
    assert.equal(seen.size, 12);
    const invited = await listRoster(deps, admin, { ...base, state: "invited", pageSize: 100 });
    assert.equal(invited.entries.length, 6);
    assert.equal((await listRoster(deps, admin, { ...base, state: "deactivated" })).entries.length, 1);
    assert.equal((await listRoster(deps, admin, { ...base, query: "REMOTE", pageSize: 100 })).entries.length, 6);
    assert.equal((await listRoster(deps, admin, { ...base, query: "p03@" })).entries[0]!.email, "p03@alpha.test");
    await fails(listRoster(deps, caller("org1"), base), "permission-denied", "INSUFFICIENT_ROLE");
  });
});

describe("listMembersV1 total", () => {
  test("the first page carries the exact company total; later pages do not", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const first = await listMembers(deps, admin, { ...base, pageSize: 3 });
    assert.equal(first.total, 7);
    assert.equal(first.members.length, 3);
    const next = await listMembers(deps, admin, { ...base, pageSize: 3, pageToken: first.nextPageToken });
    assert.equal(next.total, undefined);
  });
});

describe("backfillRosterV1", () => {
  const dry = (extra: Record<string, unknown> = {}) => ({ ...base, requestId: rid(), dryRun: true, ...extra });
  const real = (extra: Record<string, unknown> = {}) => ({ ...base, requestId: rid(), dryRun: false, ...extra });

  test("a dry run counts without writing; the real run creates claimed entries, audits once, and a re-run creates nothing", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed(entryPath("max@alpha.test"), { companyId: "alpha", email: "max@alpha.test", status: "invited", role: "admin", revision: 4 });
    const before = store.children("companies/alpha/roster").length;
    const preview = await backfillRosterCallable(deps, admin, dry());
    assert.deepEqual([preview.dryRun, preview.scanned, preview.created, preview.existing, preview.skipped, preview.done], [true, 7, 6, 1, 0, true]);
    assert.equal(store.children("companies/alpha/roster").length, before);
    assert.equal(audits(store).length, 0);

    const run = real();
    const applied = await backfillRosterCallable(deps, admin, run);
    assert.deepEqual([applied.created, applied.existing, applied.done], [6, 1, true]);
    const mia = store.get(entryPath("mia@alpha.test"))!;
    assert.deepEqual([mia.status, mia.claimedBy, mia.source, mia.memberStatus], ["claimed", "m1", "signup", "active"]);
    assert.equal(store.get(entryPath("dee@alpha.test"))!.memberStatus, "deactivated");
    assert.equal(store.get(entryPath("max@alpha.test"))!.status, "invited", "an existing entry is never touched");
    assert.equal(store.get("companies/beta/roster/" + sha("bo@beta.test")), undefined, "other tenants are never touched");
    assert.deepEqual(audits(store).map(a => a.action), ["roster.backfill"]);
    assert.deepEqual(await backfillRosterCallable(deps, admin, run), applied);
    assert.equal(audits(store).length, 1);
    const again = await backfillRosterCallable(deps, admin, real());
    assert.deepEqual([again.created, again.existing], [0, 7]);
  });

  test("works in chunks of 100 members with a cursor", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    for (let i = 0; i < 230; i++) store.seed(`users/z${String(i).padStart(3, "0")}`, { companyId: "alpha", role: "member", displayName: `Z ${i}`, email: `z${i}@alpha.test`, createdAt: new Date("2030-01-01T00:00:00Z") });
    let token: string | undefined;
    let created = 0;
    let calls = 0;
    do {
      const page = await backfillRosterCallable(deps, admin, real(token ? { pageToken: token } : {}));
      assert.ok(page.scanned <= 100);
      created += page.created;
      token = page.nextPageToken;
      calls++;
    } while (token);
    assert.equal(created, 237);
    assert.equal(calls, 3);
    assert.equal(store.children("companies/alpha/roster").length, 237);
  });

  test("admins only, validated and company-scoped", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await fails(backfillRosterCallable(deps, caller("org1"), dry()), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(backfillRosterCallable(deps, caller("bo"), dry()), "permission-denied", "COMPANY_MISMATCH");
    await fails(backfillRosterCallable(deps, admin, { ...base, requestId: rid() }), "invalid-argument", "VALIDATION_FAILED");
  });
});

describe("import counters are exact after an interrupted chunk", () => {
  test("tallies sum per chunk and a retried chunk replaces its tally", () => {
    const one = tallyOf([{ outcome: "created" }, { outcome: "updated" }, { outcome: "failed" }]);
    assert.deepEqual(progressFromTallies({ 0: one, 1: tallyOf([{ outcome: "unchanged" }]) }, 4), { processed: 4, total: 4, created: 1, updated: 1, unchanged: 1, failed: 1 });
    assert.deepEqual(progressFromTallies({ 0: one, ...{ 0: one } }, 3), { processed: 3, total: 3, created: 1, updated: 1, unchanged: 0, failed: 1 });
  });

  test("re-applying a chunk whose job record was not advanced reports the original outcomes, not 'unchanged'", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/teams/t-sales", { companyId: "alpha", name: "Sales", archived: false, revision: 1 });
    const rows = [{ email: "mia@alpha.test", workLocation: "HQ" }, { email: "fresh@alpha.test", displayName: "Fresh", teamIds: ["Sales"] }, { email: "max@alpha.test", department: "Sales" }];
    const planned = await importEmployees(deps, admin, { ...base, requestId: rid(), rows });
    const body = { ...base, jobId: planned.jobId, planHash: planned.planHash };
    const done = await applyEmployeeImport(deps, admin, body);
    assert.deepEqual([done.progress.created, done.progress.updated, done.progress.unchanged], [1, 1, 1]);
    // Simulate a crash after the rows were applied but before the job cursor advanced.
    const path = `companies/alpha/importJobs/${planned.jobId}`;
    const job = store.get(path)!;
    const { tallies: _tallies, ...rest } = job;
    void _tallies;
    (store as unknown as { docs: Map<string, unknown> }).docs.delete(`companies/alpha/auditLog/admin1_${planned.jobId}_done`); // written in the finalize transaction that "crashed"
    store.seed(path, { ...rest, nextChunk: 0, status: "running", progress: { processed: 0, total: 3, created: 0, updated: 0, unchanged: 0, failed: 0 } });
    const retried = await applyEmployeeImport(deps, admin, body);
    assert.deepEqual(retried.progress, done.progress);
    assert.deepEqual(retried.results.map(r => r.outcome), ["updated", "created", "unchanged"]);
    assert.equal(audits(store).filter(a => a.action === "import.apply" && a.targetType === "member").length, 1, "rows are applied once");
  });
});
