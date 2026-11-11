import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { addEventAttendee } from "../../functions/src/modules/admin/application/attendees";
import {
  adjustMemberPoints, getMember, listMembers, resetMemberProfile, setMemberStatus, updateCompanySettings, updateMember, upsertTeam,
} from "../../functions/src/modules/admin/application/members";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { caller, makeDeps, rid, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";

const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");
const organizer = caller("org1");

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}
const audits = (store: FakeAdminStore) => store.children("companies/alpha/auditLog").map(c => c.data);

describe("listMembersV1 / getMemberV1", () => {
  test("lists only the caller's company, with points for admins only", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const asAdmin = await listMembers(deps, admin, base);
    assert.deepEqual(asAdmin.members.map(m => m.userId), ["admin1", "admin2", "deact", "m1", "m2", "m3", "org1"]);
    assert.equal(asAdmin.members.find(m => m.userId === "m1")!.pointsBalance, 100);
    assert.equal(asAdmin.members.find(m => m.userId === "deact")!.status, "deactivated");
    assert.equal(asAdmin.nextPageToken, undefined);
    const asOrganizer = await listMembers(deps, organizer, base);
    assert.ok(asOrganizer.members.every(m => m.pointsBalance === undefined));
    assert.ok(asAdmin.members.every(m => !("interestTagIds" in m)), "private profile fields are not exposed");
  });

  test("filters by role, status, team, location and a case-insensitive search", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("users/m2", { ...store.get("users/m2")!, teamIds: ["t-platform"], workLocation: "Pittsburgh HQ" });
    const ids = async (extra: Record<string, unknown>) => (await listMembers(deps, admin, { ...base, ...extra })).members.map(m => m.userId);
    assert.deepEqual(await ids({ role: "organizer" }), ["org1"]);
    assert.deepEqual(await ids({ status: "deactivated" }), ["deact"]);
    assert.deepEqual(await ids({ teamId: "t-platform" }), ["m2"]);
    assert.deepEqual(await ids({ workLocation: "pittsburgh hq" }), ["m2"]);
    assert.deepEqual(await ids({ query: "SALES" }), ["m2"]);
    assert.deepEqual(await ids({ query: "mia@alpha" }), ["m1"]);
    assert.deepEqual(await ids({ query: "beta" }), [], "another company's members never match");
  });

  test("pages with an id cursor and returns every member exactly once", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    for (let i = 0; i < 30; i++) store.seed(`users/z${String(i).padStart(2, "0")}`, { ...store.get("users/m3")!, displayName: `Zed ${i}`, email: `z${i}@alpha.test` });
    const seen: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await listMembers(deps, admin, { ...base, pageSize: 7, ...(token ? { pageToken: token } : {}) });
      assert.ok(response.members.length <= 7);
      seen.push(...response.members.map(m => m.userId));
      token = response.nextPageToken;
      if (!token) break;
    }
    assert.equal(seen.length, 37);
    assert.equal(new Set(seen).size, 37);
  });

  test("getMemberV1 returns one summary and hides other tenants' users", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    assert.equal((await getMember(deps, admin, { ...base, userId: "m1" })).member.displayName, "Mia Member");
    await fails(getMember(deps, admin, { ...base, userId: "bea" }), "not-found", "MEMBER_NOT_FOUND");
    await fails(getMember(deps, admin, { ...base, userId: "ghost" }), "not-found", "MEMBER_NOT_FOUND");
  });
});

describe("updateMemberV1", () => {
  const update = (extra: Record<string, unknown>) => ({ ...base, requestId: rid(), userId: "m1", ...extra });

  test("changes role, teams and org attributes, bumps the revision and audits the diff; protected fields stay", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/teams/t1", { companyId: "alpha", name: "Platform", archived: false, revision: 1 });
    const result = await updateMember(deps, admin, update({ role: "organizer", teamIds: ["t1"], workLocation: "HQ", department: "Ops", jobTitle: "Lead" }));
    assert.deepEqual(result, { contractVersion: 1, userId: "m1", revision: 1, changedFields: ["role", "teamIds", "workLocation", "department", "jobTitle"] });
    const user = store.get("users/m1")!;
    assert.equal(user.role, "organizer");
    assert.deepEqual(user.teamIds, ["t1"]);
    assert.equal(user.pointsBalance, 100);
    assert.equal(user.displayName, "Mia Member");
    assert.equal(user.email, "mia@alpha.test");
    const [entry] = audits(store);
    assert.equal(entry!.action, "member.update");
    assert.ok((entry!.changes as any[]).some(c => c.field === "role" && c.before === "member" && c.after === "organizer"));
  });

  test("protected and unknown fields are rejected by the strict request", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    for (const field of ["pointsBalance", "displayName", "email", "companyId2", "status", "id"]) {
      await fails(updateMember(deps, admin, update({ [field]: field === "pointsBalance" ? 1 : "x" })), "invalid-argument", "VALIDATION_FAILED");
    }
    assert.equal(store.get("users/m1")!.pointsBalance, 100);
  });

  test("a no-op change writes nothing; a replay returns the first response", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const noop = await updateMember(deps, admin, update({ department: "Eng" }));
    assert.deepEqual(noop.changedFields, []);
    assert.equal(audits(store).length, 0);
    const body = update({ workLocation: "HQ" });
    const first = await updateMember(deps, admin, body);
    assert.deepEqual(await updateMember(deps, admin, body), first);
    assert.equal(store.get("users/m1")!.revision, 1);
    assert.equal(audits(store).length, 1);
    await fails(updateMember(deps, admin, { ...body, workLocation: "Elsewhere" }), "failed-precondition", "REQUEST_REUSED");
  });

  test("expectedRevision guards lost updates; concurrent edits serialize", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await updateMember(deps, admin, update({ workLocation: "HQ", expectedRevision: 0 }));
    await fails(updateMember(deps, admin, update({ workLocation: "Remote", expectedRevision: 0 })), "aborted", "REVISION_CONFLICT");
    const results = await Promise.allSettled([
      updateMember(deps, admin, update({ jobTitle: "A", expectedRevision: 1 })),
      updateMember(deps, caller("admin2"), update({ jobTitle: "B", expectedRevision: 1 })),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.reason, "REVISION_CONFLICT");
    assert.equal(store.get("users/m1")!.revision, 2);
  });

  test("teams must exist in this company's active catalog", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/teams/old", { companyId: "alpha", name: "Old", archived: true });
    store.seed("companies/beta/teams/btm", { companyId: "beta", name: "Beta team", archived: false });
    await fails(updateMember(deps, admin, update({ teamIds: ["ghost"] })), "invalid-argument", "TEAM_NOT_FOUND");
    await fails(updateMember(deps, admin, update({ teamIds: ["old"] })), "invalid-argument", "TEAM_NOT_FOUND");
    await fails(updateMember(deps, admin, update({ teamIds: ["btm"] })), "invalid-argument", "TEAM_NOT_FOUND");
  });

  test("the last admin cannot be demoted, but one of two can", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("users/admin2", { ...store.get("users/admin2")!, status: "deactivated" });
    await fails(updateMember(deps, admin, update({ userId: "admin1", role: "member" })), "failed-precondition", "LAST_ADMIN");
    store.seed("users/admin2", { ...store.get("users/admin2")!, status: "active" });
    assert.equal((await updateMember(deps, admin, update({ userId: "admin1", role: "organizer" }))).changedFields[0], "role");
    await fails(updateMember(deps, caller("admin2"), update({ userId: "admin2", role: "member" })), "failed-precondition", "LAST_ADMIN");
  });

  test("two admins demoting each other concurrently leave at least one admin", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const results = await Promise.allSettled([
      updateMember(deps, admin, update({ userId: "admin2", role: "member" })),
      updateMember(deps, caller("admin2"), update({ userId: "admin1", role: "member" })),
    ]);
    assert.ok(results.some(r => r.status === "rejected"), "one demotion must lose");
    const admins = store.children("users").filter(u => u.data.companyId === "alpha" && u.data.role === "admin");
    assert.equal(admins.length, 1);
  });

  test("another company's member is MEMBER_NOT_FOUND", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await fails(updateMember(deps, admin, update({ userId: "bea" })), "not-found", "MEMBER_NOT_FOUND");
    assert.equal(store.get("users/bea")!.role, "member");
  });
});

describe("resetMemberProfileV1", () => {
  test("clears self-set data and keeps identity, org attributes and points", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const result = await resetMemberProfile(deps, admin, { ...base, requestId: rid(), userId: "m1", reason: "Inappropriate avatar" });
    assert.deepEqual(result.resetFields.sort(), ["avatarId", "city", "favoritePhotoIds", "interestTagIds", "travelRadiusMiles"]);
    const user = store.get("users/m1")!;
    assert.equal(user.avatarId, "");
    assert.deepEqual(user.interestTagIds, []);
    assert.equal(user.travelRadiusMiles, 20);
    assert.equal(user.pointsBalance, 100);
    assert.equal(user.role, "member");
    assert.equal(user.department, "Eng");
    assert.equal(user.displayName, "Mia Member");
    assert.equal(audits(store)[0]!.action, "member.reset");
    assert.equal(audits(store)[0]!.reason, "Inappropriate avatar");
  });

  test("an already-default profile is a no-op, and another tenant's member is not found", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await resetMemberProfile(deps, admin, { ...base, requestId: rid(), userId: "m1" });
    const again = await resetMemberProfile(deps, admin, { ...base, requestId: rid(), userId: "m1" });
    assert.deepEqual(again.resetFields, []);
    assert.equal(audits(store).length, 1);
    await fails(resetMemberProfile(deps, admin, { ...base, requestId: rid(), userId: "bea" }), "not-found", "MEMBER_NOT_FOUND");
  });
});

describe("setMemberStatusV1", () => {
  const status = (extra: Record<string, unknown>) => ({ ...base, requestId: rid(), userId: "m1", status: "deactivated", ...extra });

  test("deactivation revokes sessions, frees the member's upcoming seats and audits; reactivation restores access", async () => {
    const { deps, store, sessions } = makeDeps();
    seedCompany(store);
    await addEventAttendee(deps, admin, { ...base, requestId: rid(), eventId: "soon", userId: "m1" });
    assert.equal(store.get("companies/alpha/events/soon")!.attendeeCount, 1);
    const result = await setMemberStatus(deps, admin, status({ reason: "Left the company" }));
    assert.deepEqual(result, { contractVersion: 1, userId: "m1", status: "deactivated", changed: true, rsvpsCancelled: 1, revision: 1 });
    assert.equal(store.get("users/m1")!.status, "deactivated");
    assert.equal(store.get("users/m1")!.pointsBalance, 100, "points are protected");
    assert.deepEqual(sessions.revoked, ["m1"]);
    assert.equal(store.get("companies/alpha/events/soon/rsvps/m1")!.status, "cancelled");
    assert.equal(store.get("companies/alpha/events/soon")!.attendeeCount, 0);
    assert.ok(audits(store).some(a => a.action === "member.status" && a.reason === "Left the company"));
    const back = await setMemberStatus(deps, admin, status({ status: "active" }));
    assert.equal(back.changed, true);
    assert.equal(store.get("users/m1")!.status, "active");
  });

  test("a replay is idempotent and repeating the same state changes nothing", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const body = status({});
    const first = await setMemberStatus(deps, admin, body);
    assert.deepEqual(await setMemberStatus(deps, admin, body), first);
    assert.equal((await setMemberStatus(deps, admin, status({}))).changed, false);
    assert.equal(store.get("users/m1")!.revision, 1);
  });

  test("cannot deactivate yourself or the last active admin", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await fails(setMemberStatus(deps, admin, status({ userId: "admin1" })), "failed-precondition", "CANNOT_DEACTIVATE_SELF");
    await setMemberStatus(deps, admin, status({ userId: "admin2" }));
    await fails(setMemberStatus(deps, caller("org1"), status({ userId: "admin1" })), "permission-denied", "INSUFFICIENT_ROLE");
    store.seed("users/admin3", { ...store.get("users/admin1")!, displayName: "Third" });
    await setMemberStatus(deps, caller("admin3"), status({ userId: "admin1" }));
    await fails(setMemberStatus(deps, caller("admin3"), status({ userId: "admin3" })), "failed-precondition", "CANNOT_DEACTIVATE_SELF");
  });

  test("another tenant's member cannot be deactivated", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await fails(setMemberStatus(deps, admin, status({ userId: "bea" })), "not-found", "MEMBER_NOT_FOUND");
    assert.equal(store.get("users/bea")!.status, undefined);
  });
});

describe("adjustMemberPointsV1", () => {
  const adjust = (extra: Record<string, unknown>) => ({ ...base, requestId: rid(), userId: "m1", delta: 25, reason: "Contest winner", ...extra });

  test("appends a ledger entry and updates the balance atomically; replay applies once", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const body = adjust({ requestId: "adjust-0001" });
    assert.deepEqual(await adjustMemberPoints(deps, admin, body), { contractVersion: 1, userId: "m1", pointsBalance: 125, applied: true });
    assert.equal(store.get("users/m1")!.pointsBalance, 125);
    const ledger = store.get("companies/alpha/pointTransactions/adjust_admin1_adjust-0001")!;
    assert.equal(ledger.amount, 25);
    assert.equal(ledger.userId, "m1");
    await adjustMemberPoints(deps, admin, body);
    assert.equal(store.get("users/m1")!.pointsBalance, 125);
    assert.equal(audits(store).length, 1);
  });

  test("the balance can't go negative; a zero or oversized delta and a missing reason are invalid", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await fails(adjustMemberPoints(deps, admin, adjust({ delta: -101 })), "failed-precondition", "INSUFFICIENT_POINTS");
    assert.equal((await adjustMemberPoints(deps, admin, adjust({ delta: -100 }))).pointsBalance, 0);
    for (const patch of [{ delta: 0 }, { delta: 100001 }, { delta: 1.5 }, { reason: "" }, { reason: "ab" }]) {
      await fails(adjustMemberPoints(deps, admin, adjust(patch)), "invalid-argument", "VALIDATION_FAILED");
    }
  });

  test("concurrent deductions never overdraw", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const results = await Promise.allSettled([adjustMemberPoints(deps, admin, adjust({ delta: -60 })), adjustMemberPoints(deps, caller("admin2"), adjust({ delta: -60 }))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(store.get("users/m1")!.pointsBalance, 40);
  });
});

describe("teams and company settings", () => {
  test("creates, renames and archives teams; names are unique case-insensitively", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const created = await upsertTeam(deps, admin, { ...base, requestId: rid(), name: "Platform" });
    assert.equal(created.created, true);
    const doc = store.get(`companies/alpha/teams/${created.teamId}`)!;
    assert.equal(doc.name, "Platform");
    assert.equal(doc.archived, false);
    await fails(upsertTeam(deps, admin, { ...base, requestId: rid(), name: "platform" }), "failed-precondition", "TEAM_NAME_TAKEN");
    const renamed = await upsertTeam(deps, admin, { ...base, requestId: rid(), teamId: created.teamId, name: "Platform Eng", archived: true });
    assert.deepEqual([renamed.created, renamed.revision], [false, 2]);
    assert.equal(store.get(`companies/alpha/teams/${created.teamId}`)!.archived, true);
    await fails(upsertTeam(deps, admin, { ...base, requestId: rid(), teamId: "ghost", name: "X" }), "not-found", "TEAM_NOT_FOUND");
    assert.equal(audits(store).filter(a => a.action === "team.upsert").length, 2);
  });

  test("membership mode defaults to open and switches to rosterOnly with an audit entry", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    assert.deepEqual(await updateCompanySettings(deps, admin, { ...base, requestId: rid(), membershipMode: "open" }), { contractVersion: 1, membershipMode: "open", changed: false });
    assert.deepEqual(await updateCompanySettings(deps, admin, { ...base, requestId: rid(), membershipMode: "rosterOnly" }), { contractVersion: 1, membershipMode: "rosterOnly", changed: true });
    assert.equal(store.get("companies/alpha")!.membershipMode, "rosterOnly");
    assert.equal(store.get("companies/beta")!.membershipMode, undefined, "other tenants untouched");
    await fails(updateCompanySettings(deps, admin, { ...base, requestId: rid(), membershipMode: "closed" }), "invalid-argument", "VALIDATION_FAILED");
    assert.equal(audits(store).length, 1);
  });
});
