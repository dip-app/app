import { strict as assert } from "node:assert";
import { describe, mock, test } from "node:test";
import { createRequire } from "node:module";
import { recordAttendance } from "../../functions/src/modules/admin/application/attendees";
import { importEmployees } from "../../functions/src/modules/admin/application/importEmployees";
import { adjustMemberPoints, getMember, listMembers } from "../../functions/src/modules/admin/application/members";
import { removeEventPhoto, removeEventPhotoComment } from "../../functions/src/modules/admin/application/moderation";
import { listRoster } from "../../functions/src/modules/admin/application/roster";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { MAX_ROW_KEYS, normalizeEmployee } from "../../functions/src/modules/admin/domain/employee";
import { caller, makeDeps, rid, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";

// firebase-functions is a dependency of the functions workspace only; resolve the same instance the module under test uses.
const { logger } = createRequire(`${__dirname}/../../functions/package.json`)("firebase-functions/v2") as typeof import("firebase-functions/v2");

const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}
const audits = (store: FakeAdminStore) => store.children("companies/alpha/auditLog").map(c => c.data);

describe("rate limiter runs only after authorization", () => {
  test("non-members, other tenants, deactivated and under-privileged callers never reach the limiter", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const consumed: string[] = [];
    deps.limiter = { consume: async uid => { consumed.push(uid); } };
    await fails(getMember(deps, caller("stranger"), { ...base, userId: "m1" }), "permission-denied", "MEMBERSHIP_CONFLICT");
    await fails(getMember(deps, caller("bo"), { ...base, userId: "m1" }), "permission-denied", "COMPANY_MISMATCH");
    await fails(getMember(deps, caller("deact"), { ...base, userId: "m1" }), "permission-denied", "ACCOUNT_DEACTIVATED");
    await fails(listMembers(deps, caller("m2"), base), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(adjustMemberPoints(deps, caller("org1"), { ...base, requestId: rid(), userId: "m1", delta: 1, reason: "test reason" }), "permission-denied", "INSUFFICIENT_ROLE");
    assert.deepEqual(consumed, []);
  });

  test("an authorized caller is counted once, after the authorization read", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const order: string[] = [];
    const original = store.runReadOnly.bind(store);
    store.runReadOnly = (work => { order.push("authorize"); return original(work); }) as typeof store.runReadOnly;
    deps.limiter = { consume: async uid => { order.push(`consume:${uid}`); } };
    await getMember(deps, admin, { ...base, userId: "m1" });
    assert.equal(order[0], "authorize");
    assert.equal(order[1], "consume:admin1");
  });

  test("a rate-limited admin is still refused", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    deps.limiter = { consume: async () => { throw new AdminError("resource-exhausted", "RATE_LIMITED", "Slow down."); } };
    await fails(getMember(deps, admin, { ...base, userId: "m1" }), "resource-exhausted", "RATE_LIMITED");
  });
});

describe("import row and directory bounds", () => {
  const ctx = { companyDomain: "alpha.test", teams: [] };

  test("a row with thousands of keys yields one issue, not one per key", () => {
    const row: Record<string, unknown> = { email: "a@alpha.test" };
    for (let i = 0; i < 5000; i++) row[`extra${i}`] = "x";
    const { issues } = normalizeEmployee(row, ctx);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.code, "VALIDATION_FAILED");
  });

  test("up to the key cap unknown columns are reported with truncated names", () => {
    const row: Record<string, unknown> = { email: "a@alpha.test", ["k".repeat(500)]: "x" };
    for (let i = 0; i < MAX_ROW_KEYS - 2; i++) row[`u${i}`] = "x";
    const { issues } = normalizeEmployee(row, ctx);
    assert.equal(issues.length, MAX_ROW_KEYS - 1);
    assert.ok(issues.every(i => i.field.length <= 60));
  });

  test("a directory larger than the scan cap fails instead of producing a wrong plan", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    for (let i = 0; i < 50_000; i++) store.seed(`users/bulk${String(i).padStart(6, "0")}`, { companyId: "alpha", role: "member", email: `b${i}@alpha.test` });
    await fails(importEmployees(deps, admin, { ...base, requestId: rid(), rows: [{ email: "new@alpha.test" }] }), "failed-precondition", "IMPORT_TOO_LARGE");
  });

  test("an import job, its chunks and results carry a 30 day expireAt", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const plan = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: [{ email: "new@alpha.test" }] });
    const job = store.get(`companies/alpha/importJobs/${plan.jobId}`)!;
    const chunk = store.get(`companies/alpha/importJobs/${plan.jobId}/chunks/0`)!;
    assert.ok(job.expireAt instanceof Date && chunk.expireAt instanceof Date);
    assert.equal((job.expireAt as Date).getTime() - Date.parse("2030-01-02T12:00:00Z"), 30 * 86_400_000);
  });
});

describe("directory scan cap", () => {
  test("listMembers scans at most 500 documents per call and continues with the cursor", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    for (let i = 0; i < 700; i++) store.seed(`users/z${String(i).padStart(4, "0")}`, { companyId: "alpha", role: "member", displayName: "Zed", email: `z${i}@alpha.test`, pointsBalance: 0 });
    const ids = store.children("users").filter(u => u.data.companyId === "alpha").map(u => u.id).sort();
    const first = await listMembers(deps, admin, { ...base, query: "no-such-person" });
    assert.equal(first.members.length, 0);
    assert.equal(first.nextPageToken, ids[499]);
    const second = await listMembers(deps, admin, { ...base, query: "no-such-person", pageToken: first.nextPageToken });
    assert.equal(second.nextPageToken, undefined);
  });

  test("listRoster scans at most 500 entries per call", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    for (let i = 0; i < 700; i++) {
      store.seed(`companies/alpha/roster/r${String(i).padStart(4, "0")}`, { companyId: "alpha", email: `r${i}@alpha.test`, displayName: "R", role: "member", teamIds: [], workLocation: "", department: "", jobTitle: "", status: "invited" });
    }
    const page = await listRoster(deps, admin, { ...base, query: "no-such-person" });
    assert.equal(page.entries.length, 0);
    assert.equal(page.nextPageToken, "r0499");
  });
});

describe("moderation cleanup and audit redaction", () => {
  const request = () => ({ ...base, requestId: rid(), eventId: "past", photoId: "m1_0", reason: "Inappropriate" });

  test("a missing photo triggers no storage or comment cleanup and no audit", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/events/past/photos/m1_0/comments/orphan", { companyId: "alpha", text: "stray" });
    const result = await removeEventPhoto(deps, admin, request());
    assert.equal(result.removed, false);
    assert.deepEqual(objects.removed, []);
    assert.ok(store.get("companies/alpha/events/past/photos/m1_0/comments/orphan"));
    assert.equal(audits(store).length, 0);
  });

  test("a failed storage delete is logged with ids only", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/events/past/photos/m1_0", { companyId: "alpha", eventId: "past", uploaderId: "m1", uploaderName: "Mia", caption: "Sunny", commentCount: 0 });
    objects.remove = async () => false;
    const warn = mock.method(logger, "warn", () => undefined);
    try {
      const result = await removeEventPhoto(deps, admin, request());
      assert.equal(result.objectRemoved, false);
      assert.equal(warn.mock.calls.length, 1);
      assert.deepEqual(warn.mock.calls[0]!.arguments[1], { companyId: "alpha", eventId: "past", photoId: "m1_0" });
    } finally { warn.mock.restore(); }
  });

  test("audit entries keep lengths, never caption or comment text", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/events/past/photos/m1_0", { companyId: "alpha", eventId: "past", uploaderId: "m1", uploaderName: "Mia", caption: "Sunny day", commentCount: 1 });
    store.seed("companies/alpha/events/past/photos/m1_0/comments/c0", { companyId: "alpha", authorId: "m2", authorName: "Max", text: "Secret words" });
    await removeEventPhotoComment(deps, admin, { ...request(), commentId: "c0" });
    await removeEventPhoto(deps, admin, request());
    const dump = JSON.stringify(audits(store));
    assert.ok(!dump.includes("Sunny day") && !dump.includes("Secret words"));
    assert.ok(dump.includes("textLength") && dump.includes("captionLength"));
  });
});

describe("selfTarget audit flag", () => {
  test("points adjustments and attendance on the actor's own record are flagged; others are not", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await adjustMemberPoints(deps, admin, { ...base, requestId: rid(), userId: "admin1", delta: 5, reason: "self" });
    await adjustMemberPoints(deps, admin, { ...base, requestId: rid(), userId: "m1", delta: 5, reason: "other" });
    const adjust = audits(store).filter(a => a.action === "points.adjust");
    assert.equal(adjust.filter(a => a.selfTarget === true).length, 1);
    assert.equal(adjust.find(a => a.targetId === "m1")!.selfTarget, undefined);

    store.seed("companies/alpha/events/live/rsvps/admin1", { companyId: "alpha", eventId: "live", userId: "admin1", status: "going", checkedIn: false, checkedInAt: null });
    await recordAttendance(deps, admin, { ...base, eventId: "live", userId: "admin1", checkedIn: true });
    const attendance = audits(store).find(a => a.action === "attendance.record")!;
    assert.equal(attendance.selfTarget, true);
  });
});
