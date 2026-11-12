import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { getBugReport, listBugReports, updateBugReport } from "../../functions/src/modules/admin/application/bugReports";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { decodeCursor, encodeCursor } from "../../functions/src/modules/admin/domain/bugReports";
import { caller, makeDeps, rid, seedCompany, type FakeAdminStore, type FakeObjects } from "./helpers/adminFakes";

const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const triagePath = (id: string) => `companies/alpha/bugReportTriage/${id}`;
const audits = (store: FakeAdminStore) => store.children("companies/alpha/auditLog").map(c => c.data).filter(a => a.action === "bugreport.update");

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}

const diagnostics = { appVersion: "2.1", appBuild: "412", osVersion: "iOS 18.1", deviceModel: "iPhone17,1", locale: "en_US", screen: "event", installId: "0a1b2c3d-1111-2222-3333-444455556666" };

/** n reports from alpha members (newest = highest n), plus two from beta members. */
function seedReports(store: FakeAdminStore, n = 6, objects?: FakeObjects) {
  const who = ["m1", "m2", "m3"];
  for (let i = 1; i <= n; i += 1) {
    const uid = who[i % 3]!;
    const id = uuid(i);
    store.seed(`bugReports/${id}`, {
      uid, category: i % 2 ? "bug" : "idea", description: i === 3 ? "The join button keeps spinning" : `Report number ${i}`, source: "shake", screen: "event",
      diagnostics, createdAt: new Date(Date.UTC(2030, 0, 1, i)), ...(i === 1 ? { screenshotPath: `bugReports/${uid}/${id}.jpg`, screenshotBytes: 1000 } : {}),
    });
    if (i === 1) objects?.existing.add(`bugReports/${uid}/${id}.jpg`);
  }
  store.seed(`bugReports/${uuid(90)}`, { uid: "bea", category: "bug", description: "Other tenant report", source: "profile", screen: "home", createdAt: new Date(Date.UTC(2030, 0, 1, 23)) });
  store.seed(`bugReports/${uuid(91)}`, { uid: "ghost", category: "bug", description: "No membership", source: "profile", screen: "home", createdAt: new Date(Date.UTC(2030, 0, 1, 22)) });
}

describe("listBugReportsV1", () => {
  test("returns only the caller's company, newest first, with counts and no other tenant's data", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store);
    const res = await listBugReports(deps, admin, { ...base });
    assert.deepEqual(res.reports.map(r => r.id), [6, 5, 4, 3, 2, 1].map(uuid));
    assert.deepEqual(res.counts, { all: 6, new: 6, triaged: 0, resolved: 0, capped: false });
    assert.equal(res.nextPageToken, undefined);
    assert.equal(res.reports[0]!.reporterName, "Mia Member");
    assert.equal(res.reports.find(r => r.id === uuid(1))!.hasScreenshot, true);
    assert.ok(!JSON.stringify(res).includes("Other tenant"));
    assert.ok(!JSON.stringify(res).includes("mia@alpha.test"), "emails only appear in the detail");
    const beta = await listBugReports(deps, caller("bo"), { ...base, companyId: "beta" });
    assert.deepEqual(beta.reports.map(r => r.id), [uuid(90)]);
  });

  test("pages with a cursor, and a short page continues when the scan budget ends", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 6);
    const first = await listBugReports(deps, admin, { ...base, pageSize: 4 });
    assert.deepEqual(first.reports.map(r => r.id), [6, 5, 4, 3].map(uuid));
    assert.ok(first.nextPageToken);
    assert.equal(first.counts?.all, 6);
    const second = await listBugReports(deps, admin, { ...base, pageSize: 4, pageToken: first.nextPageToken });
    assert.deepEqual(second.reports.map(r => r.id), [2, 1].map(uuid));
    assert.equal(second.nextPageToken, undefined);
    assert.equal(second.counts, undefined, "counts come with the first page only");
  });

  test("filters by status, category, text and date range", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 6);
    await updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(2), status: "triaged" });
    await updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(4), status: "resolved" });
    const triaged = await listBugReports(deps, admin, { ...base, status: "triaged" });
    assert.deepEqual(triaged.reports.map(r => r.id), [uuid(2)]);
    assert.deepEqual(triaged.counts, { all: 6, new: 4, triaged: 1, resolved: 1, capped: false }, "counts ignore the status filter");
    assert.deepEqual((await listBugReports(deps, admin, { ...base, status: "new" })).reports.map(r => r.id), [6, 5, 3, 1].map(uuid));
    assert.deepEqual((await listBugReports(deps, admin, { ...base, category: "idea" })).reports.map(r => r.id), [6, 4, 2].map(uuid));
    assert.deepEqual((await listBugReports(deps, admin, { ...base, query: "SPINNING" })).reports.map(r => r.id), [uuid(3)]);
    assert.deepEqual((await listBugReports(deps, admin, { ...base, query: "max member" })).reports.map(r => r.reporterName), ["Max Member", "Max Member"]);
    assert.equal((await listBugReports(deps, admin, { ...base, from: "2030-01-02" })).reports.length, 0);
    assert.equal((await listBugReports(deps, admin, { ...base, from: "2030-01-01", to: "2030-01-01" })).reports.length, 6);
  });

  test("validates the request and refuses non-admins before reading anything", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store);
    await fails(listBugReports(deps, admin, { ...base, extra: 1 }), "invalid-argument", "VALIDATION_FAILED");
    await fails(listBugReports(deps, admin, { ...base, status: "open" }), "invalid-argument", "VALIDATION_FAILED");
    await fails(listBugReports(deps, admin, { ...base, from: "2030-02-30" }), "invalid-argument", "VALIDATION_FAILED");
    await fails(listBugReports(deps, admin, { ...base, from: "2030-02-02", to: "2030-02-01" }), "invalid-argument", "VALIDATION_FAILED");
    await fails(listBugReports(deps, admin, { ...base, pageToken: "garbage" }), "invalid-argument", "VALIDATION_FAILED");
    await fails(listBugReports(deps, caller("org1"), { ...base }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(listBugReports(deps, caller("m1"), { ...base }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(listBugReports(deps, caller("stranger"), { ...base }), "permission-denied", "MEMBERSHIP_CONFLICT");
    await fails(listBugReports(deps, caller("bo"), { ...base }), "permission-denied", "COMPANY_MISMATCH");
    await fails(listBugReports(deps, caller("admin1", { emailVerified: false }), { ...base }), "permission-denied", "EMAIL_NOT_VERIFIED");
    await fails(listBugReports(deps, null, { ...base }), "unauthenticated", "UNAUTHENTICATED");
  });

  test("the cursor round-trips and rejects malformed values", () => {
    const at = new Date("2030-01-01T05:00:00.123Z");
    assert.deepEqual(decodeCursor(encodeCursor(at, uuid(5))), { at, id: uuid(5) });
    assert.equal(decodeCursor("!!"), null);
    assert.equal(decodeCursor(Buffer.from("abc~def").toString("base64url")), null);
  });
});

describe("getBugReportV1", () => {
  test("returns detail with the reporter email, diagnostics and a short-lived screenshot URL", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store);
    seedReports(store, 3, objects);
    const res = await getBugReport(deps, admin, { ...base, reportId: uuid(1) });
    assert.equal(res.reporterEmail, "max@alpha.test");
    assert.deepEqual(res.diagnostics, diagnostics);
    assert.equal(res.report.hasScreenshot, true);
    assert.match(res.screenshotUrl ?? "", /^https:\/\/signed\.test\/bugReports\/m2\/.+\.jpg\?ttl=900000$/);
    assert.equal(res.screenshotExpiresAt, new Date(Date.parse("2030-01-02T12:00:00Z") + 900_000).toISOString());
    assert.deepEqual([res.note, res.revision], ["", 0]);
    const plain = await getBugReport(deps, admin, { ...base, reportId: uuid(2) });
    assert.equal(plain.screenshotUrl, undefined);
  });

  test("a signing failure leaves the screenshot out instead of failing the page", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store);
    seedReports(store, 2, objects);
    objects.failSigning = true;
    const res = await getBugReport(deps, admin, { ...base, reportId: uuid(1) });
    assert.equal(res.screenshotUrl, undefined);
    assert.equal(res.report.hasScreenshot, true);
  });

  test("never signs a path other than the reporter's own report object", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store);
    store.seed(`bugReports/${uuid(7)}`, { uid: "m1", category: "bug", description: "tampered path", source: "shake", screen: "home", createdAt: new Date(), screenshotPath: "users/m2/secret.jpg", screenshotBytes: 5 });
    objects.existing.add("users/m2/secret.jpg");
    const res = await getBugReport(deps, admin, { ...base, reportId: uuid(7) });
    assert.equal(res.screenshotUrl, undefined);
    assert.deepEqual(objects.signed, []);
  });

  test("tenant isolation and permissions: other companies, missing reports and non-admins learn nothing", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store);
    await fails(getBugReport(deps, admin, { ...base, reportId: uuid(90) }), "not-found", "BUG_REPORT_NOT_FOUND");
    await fails(getBugReport(deps, admin, { ...base, reportId: uuid(91) }), "not-found", "BUG_REPORT_NOT_FOUND");
    await fails(getBugReport(deps, admin, { ...base, reportId: uuid(500) }), "not-found", "BUG_REPORT_NOT_FOUND");
    await fails(getBugReport(deps, caller("bo"), { ...base, companyId: "beta", reportId: uuid(1) }), "not-found", "BUG_REPORT_NOT_FOUND");
    await fails(getBugReport(deps, caller("bo"), { ...base, reportId: uuid(1) }), "permission-denied", "COMPANY_MISMATCH");
    await fails(getBugReport(deps, caller("org1"), { ...base, reportId: uuid(1) }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(getBugReport(deps, caller("m1"), { ...base, reportId: uuid(1) }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(getBugReport(deps, admin, { ...base, reportId: "bad id" }), "invalid-argument", "VALIDATION_FAILED");
  });
});

describe("updateBugReportV1", () => {
  test("sets status, note and assignee in the server-owned triage document, audits, and leaves the report untouched", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 2);
    const before = JSON.stringify(store.get(`bugReports/${uuid(1)}`));
    const body = { ...base, requestId: rid(), reportId: uuid(1), status: "triaged", note: "Repro on iOS 18.1", assigneeId: "admin2" };
    const res = await updateBugReport(deps, admin, body);
    assert.deepEqual([res.status, res.note, res.assigneeId, res.assigneeName, res.revision, res.changed], ["triaged", "Repro on iOS 18.1", "admin2", "Abe Admin", 1, true]);
    const triage = store.get(triagePath(uuid(1)))!;
    assert.deepEqual([triage.companyId, triage.status, triage.updatedBy, triage.revision], ["alpha", "triaged", "admin1", 1]);
    assert.equal(JSON.stringify(store.get(`bugReports/${uuid(1)}`)), before, "the client-created document is immutable");
    assert.equal(audits(store).length, 1);
    assert.deepEqual(audits(store)[0]!.changes, [
      { field: "status", before: "new", after: "triaged" }, { field: "note", before: null, after: "(edited)" }, { field: "assignee", before: null, after: "Abe Admin" },
    ]);
    const detail = await getBugReport(deps, admin, { ...base, reportId: uuid(1) });
    assert.deepEqual([detail.report.status, detail.note, detail.report.assigneeName, detail.revision, detail.updatedByName], ["triaged", "Repro on iOS 18.1", "Abe Admin", 1, "Ada Admin"]);
  });

  test("is idempotent per requestId and refuses a reused key with different content", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 1);
    const body = { ...base, requestId: rid(), reportId: uuid(1), status: "resolved" };
    const first = await updateBugReport(deps, admin, body);
    assert.deepEqual(await updateBugReport(deps, admin, body), first);
    assert.equal(audits(store).length, 1);
    assert.equal(store.get(triagePath(uuid(1)))!.revision, 1);
    await fails(updateBugReport(deps, admin, { ...body, status: "triaged" }), "failed-precondition", "REQUEST_REUSED");
  });

  test("a no-op changes nothing and writes no audit entry; clearing the assignee works", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 1);
    await updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1), status: "triaged", assigneeId: "admin1" });
    const same = await updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1), status: "triaged" });
    assert.equal(same.changed, false);
    assert.equal(audits(store).length, 1);
    const cleared = await updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1), assigneeId: null });
    assert.deepEqual([cleared.changed, cleared.assigneeId], [true, undefined]);
    assert.equal(store.get(triagePath(uuid(1)))!.assigneeId, undefined);
    assert.equal((await updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1), note: "" })).changed, false);
  });

  test("expectedRevision guards concurrent admins", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 1);
    await updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1), status: "triaged" });
    await fails(updateBugReport(deps, caller("admin2"), { ...base, requestId: rid(), reportId: uuid(1), status: "resolved", expectedRevision: 0 }), "aborted", "REVISION_CONFLICT");
    assert.equal((await updateBugReport(deps, caller("admin2"), { ...base, requestId: rid(), reportId: uuid(1), status: "resolved", expectedRevision: 1 })).revision, 2);
  });

  test("two admins updating at once both land, with no lost revision", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 1);
    await Promise.all([
      updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1), status: "triaged" }),
      updateBugReport(deps, caller("admin2"), { ...base, requestId: rid(), reportId: uuid(1), note: "second" }),
    ]);
    const triage = store.get(triagePath(uuid(1)))!;
    assert.equal(triage.revision, 2);
    assert.deepEqual([triage.status, triage.note], ["triaged", "second"]);
  });

  test("validation, assignee rules, permissions and tenant isolation", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store);
    const ok = { ...base, requestId: rid(), reportId: uuid(1), status: "triaged" };
    await fails(updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1) }), "invalid-argument", "VALIDATION_FAILED");
    await fails(updateBugReport(deps, admin, { ...ok, status: "open" }), "invalid-argument", "VALIDATION_FAILED");
    await fails(updateBugReport(deps, admin, { ...ok, note: " padded " }), "invalid-argument", "VALIDATION_FAILED");
    await fails(updateBugReport(deps, admin, { ...ok, note: "x".repeat(2001) }), "invalid-argument", "VALIDATION_FAILED");
    await fails(updateBugReport(deps, admin, { ...ok, requestId: "short" }), "invalid-argument", "VALIDATION_FAILED");
    await fails(updateBugReport(deps, admin, { ...ok, requestId: rid(), assigneeId: "org1" }), "not-found", "ASSIGNEE_NOT_FOUND");
    await fails(updateBugReport(deps, admin, { ...ok, requestId: rid(), assigneeId: "bo" }), "not-found", "ASSIGNEE_NOT_FOUND");
    await fails(updateBugReport(deps, admin, { ...ok, requestId: rid(), assigneeId: "nobody" }), "not-found", "ASSIGNEE_NOT_FOUND");
    await fails(updateBugReport(deps, admin, { ...ok, requestId: rid(), reportId: uuid(90) }), "not-found", "BUG_REPORT_NOT_FOUND");
    await fails(updateBugReport(deps, caller("bo"), { ...ok, requestId: rid(), companyId: "beta" }), "not-found", "BUG_REPORT_NOT_FOUND");
    await fails(updateBugReport(deps, caller("org1"), { ...ok, requestId: rid() }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(updateBugReport(deps, caller("m1"), { ...ok, requestId: rid() }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(updateBugReport(deps, caller("bo"), { ...ok, requestId: rid() }), "permission-denied", "COMPANY_MISMATCH");
    assert.equal(store.get(triagePath(uuid(90))), undefined, "nothing was written for another tenant's report");
  });

  test("rate limits per caller", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    seedReports(store, 1);
    let calls = 0;
    deps.limiter = { consume: async () => { calls += 1; if (calls > 2) throw new AdminError("resource-exhausted", "RATE_LIMITED", "Too many requests."); } };
    await listBugReports(deps, admin, { ...base });
    await getBugReport(deps, admin, { ...base, reportId: uuid(1) });
    await fails(updateBugReport(deps, admin, { ...base, requestId: rid(), reportId: uuid(1), status: "triaged" }), "resource-exhausted", "RATE_LIMITED");
  });
});
