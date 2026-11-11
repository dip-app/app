import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { addEventAttendee, recordAttendance } from "../../functions/src/modules/admin/application/attendees";
import { applyEmployeeImport, getEmployeeImport, importEmployees } from "../../functions/src/modules/admin/application/importEmployees";
import { adjustMemberPoints, listMembers, setMemberStatus, updateMember } from "../../functions/src/modules/admin/application/members";
import { removeEventPhoto, removeEventPhotoComment } from "../../functions/src/modules/admin/application/moderation";
import type { AdminDeps, Caller, ObjectStore, SessionRevoker } from "../../functions/src/modules/admin/application/ports";
import { upsertRosterEntry } from "../../functions/src/modules/admin/application/roster";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { FirestoreAdminRateLimiter, FirestoreAdminStore, randomId } from "../../functions/src/modules/admin/infrastructure/firestoreAdminStore";
import { resolveMembership } from "../../functions/src/modules/accounts/application/resolveMembership";
import { FirestoreMembershipStore } from "../../functions/src/modules/accounts/infrastructure/firestoreMembershipStore";

// Emulator-backed test of the real Firestore adapter behind every admin command: transactions with real contention,
// document-id cursors, count(), collection-group queries, Timestamp/Date conversion, server timestamps, increments,
// field deletion, read-only snapshots and the roster claim in resolveMembershipV1. Callable wiring (Auth tokens, App Check)
// is Firebase's; the services are the same code the callables run.
//
// Run: npm run test:adminapi:integration

const PROJECT = "demo-dip";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!["127.0.0.1:8080", "127.0.0.1:18080"].includes(HOST ?? "")) throw new Error("Expected a local test emulator.");
if ((process.env.GCLOUD_PROJECT ?? PROJECT) !== PROJECT) throw new Error(`Refusing to run outside project ${PROJECT}.`);
process.env.GCLOUD_PROJECT = PROJECT;

const functionsRequire = createRequire(require.resolve("../../functions/package.json"));
const { initializeApp, deleteApp, getApps } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

let app: ReturnType<typeof initializeApp>;
let db: ReturnType<typeof getFirestore>;
let deps: AdminDeps;
const removedObjects: string[] = [];
const revoked: string[] = [];
const objects: ObjectStore = { remove: async path => { removedObjects.push(path); return true; } };
const sessions: SessionRevoker = { revoke: async uid => { revoked.push(uid); } };

const base = { contractVersion: 1, companyId: "alpha" };
const asUser = (uid: string): Caller => ({ uid, emailVerified: true, signInProvider: "google.com" });
let counter = 0;
const rid = () => `req-${Date.now()}-${++counter}`;
const sha = (email: string) => createHash("sha256").update(email).digest("hex");
const hoursFromNow = (h: number) => Timestamp.fromMillis(Date.now() + h * 3_600_000);

async function reason(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { return error instanceof AdminError ? error.reason : `UNEXPECTED ${String(error)}`; }
  return "OK";
}

before(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
  db = getFirestore(app);
  deps = { store: new FirestoreAdminStore(db), objects, sessions, limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(), newId: randomId };
});
after(async () => { await deleteApp(app); });

beforeEach(async () => {
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(response.ok, `emulator reset failed: ${response.status}`);
  removedObjects.length = 0; revoked.length = 0;
  const profile = (companyId: string, role: string, name: string, extra: Record<string, unknown> = {}) => ({
    companyId, role, displayName: name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@${companyId}.test`, photoURL: "", avatarId: "a1", department: "Eng", jobTitle: "", city: "",
    interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Timestamp.now(), ...extra,
  });
  await db.doc("companies/alpha").set({ name: "Alpha", emailDomain: "alpha.test" });
  await db.doc("companies/beta").set({ name: "Beta", emailDomain: "beta.test" });
  await db.doc("users/admin1").set(profile("alpha", "admin", "Ada Admin"));
  await db.doc("users/admin2").set(profile("alpha", "admin", "Abe Admin"));
  await db.doc("users/org1").set(profile("alpha", "organizer", "Olive Organizer"));
  for (let i = 0; i < 8; i++) await db.doc(`users/m${i}`).set(profile("alpha", "member", `Member ${i}`, { pointsBalance: 100 }));
  await db.doc("users/bo").set(profile("beta", "admin", "Bo Beta"));
  await db.doc("users/bea").set(profile("beta", "member", "Bea Beta"));
  const event = (extra: Record<string, unknown>) => ({ companyId: "alpha", title: "Boat Ride", status: "scheduled", capacity: 3, attendeeCount: 0, revision: 1, pointsValue: 0, ...extra });
  await db.doc("companies/alpha/events/past").set(event({ startTime: hoursFromNow(-5), endTime: hoursFromNow(-2) }));
  await db.doc("companies/alpha/events/live").set(event({ startTime: hoursFromNow(-1), endTime: hoursFromNow(2), pointsValue: 10 }));
  await db.doc("companies/alpha/events/soon").set(event({ startTime: hoursFromNow(24), endTime: hoursFromNow(26) }));
});

describe("album moderation on Firestore", () => {
  test("removes a photo with more comments than one transaction can hold, writes one audit entry, and replays safely", async () => {
    await db.doc("companies/alpha/events/past/photos/m1_0").set({ companyId: "alpha", eventId: "past", eventTitle: "Boat", uploaderId: "m1", uploaderName: "Member 1", caption: "x", commentCount: 450 });
    for (let i = 0; i < 450; i += 50) {
      const batch = db.batch();
      for (let j = i; j < i + 50; j++) batch.set(db.doc(`companies/alpha/events/past/photos/m1_0/comments/c${String(j).padStart(4, "0")}`), { companyId: "alpha", text: "hi", authorId: "m2" });
      await batch.commit();
    }
    const body = { ...base, requestId: rid(), eventId: "past", photoId: "m1_0", reason: "Spam" };
    const result = await removeEventPhoto(deps, asUser("admin1"), body);
    assert.deepEqual(result, { contractVersion: 1, photoId: "m1_0", removed: true, commentsRemoved: 450, objectRemoved: true });
    assert.equal((await db.doc("companies/alpha/events/past/photos/m1_0").get()).exists, false);
    assert.equal((await db.collection("companies/alpha/events/past/photos/m1_0/comments").count().get()).data().count, 0);
    assert.deepEqual(removedObjects, ["companies/alpha/events/past/photos/m1/0"]);
    assert.deepEqual(await removeEventPhoto(deps, asUser("admin1"), body), result);
    const audit = await db.collection("companies/alpha/auditLog").get();
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0]!.get("action"), "photo.remove");
    assert.ok(audit.docs[0]!.get("createdAt") instanceof Timestamp, "server timestamp");
    assert.equal(await reason(removeEventPhoto(deps, asUser("bo"), { ...body, requestId: rid() })), "COMPANY_MISMATCH");
    assert.equal(await reason(removeEventPhoto(deps, asUser("m1"), { ...body, requestId: rid() })), "INSUFFICIENT_ROLE");
  });

  test("concurrent comment removals leave an exact commentCount", async () => {
    await db.doc("companies/alpha/events/past/photos/m1_0").set({ companyId: "alpha", uploaderId: "m1", commentCount: 6 });
    for (let i = 0; i < 6; i++) await db.doc(`companies/alpha/events/past/photos/m1_0/comments/c${i}`).set({ companyId: "alpha", text: `c${i}`, authorId: "m2", authorName: "Member 2" });
    await Promise.all([0, 1, 2, 3].map(i => removeEventPhotoComment(deps, asUser("admin1"), { ...base, requestId: rid(), eventId: "past", photoId: "m1_0", commentId: `c${i}` })));
    assert.equal((await db.doc("companies/alpha/events/past/photos/m1_0").get()).get("commentCount"), 2);
    assert.equal((await db.collection("companies/alpha/events/past/photos/m1_0/comments").get()).size, 2);
  });
});

describe("attendees on Firestore", () => {
  test("concurrent adds never exceed capacity and counts stay exact", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => reason(addEventAttendee(deps, asUser(i % 2 ? "org1" : "admin1"), { ...base, requestId: rid(), eventId: "soon", userId: `m${i}` }))));
    assert.equal(results.filter(r => r === "OK").length, 3);
    assert.equal(results.filter(r => r === "EVENT_FULL").length, 3);
    const event = (await db.doc("companies/alpha/events/soon").get()).data()!;
    assert.equal(event.attendeeCount, 3);
    assert.equal((await db.collection("companies/alpha/events/soon/rsvps").where("status", "==", "going").get()).size, 3);
    assert.equal(await reason(addEventAttendee(deps, asUser("admin1"), { ...base, requestId: rid(), eventId: "soon", userId: "m7", capacityOverrideReason: "Guest of honour" })), "OK");
    const raised = (await db.doc("companies/alpha/events/soon").get()).data()!;
    assert.deepEqual([raised.capacity, raised.attendeeCount, raised.revision], [4, 4, 2]);
    assert.equal(await reason(addEventAttendee(deps, asUser("admin1"), { ...base, requestId: rid(), eventId: "soon", userId: "bea" })), "MEMBER_NOT_FOUND");
  });

  test("attendance awards points once and writes the deterministic ledger entry", async () => {
    await db.doc("companies/alpha/events/live/rsvps/m1").set({ companyId: "alpha", eventId: "live", userId: "m1", status: "going", checkedIn: false, checkedInAt: null });
    const results = await Promise.all([1, 2, 3].map(() => recordAttendance(deps, asUser("org1"), { ...base, eventId: "live", userId: "m1" })));
    assert.equal(results.reduce((sum, r) => sum + r.pointsAwarded, 0), 10);
    assert.equal((await db.doc("users/m1").get()).get("pointsBalance"), 110);
    const ledger = await db.doc("companies/alpha/pointTransactions/attendance_live_m1").get();
    assert.equal(ledger.get("amount"), 10);
    assert.ok((await db.doc("companies/alpha/events/live/rsvps/m1").get()).get("checkedInAt") instanceof Timestamp);
  });
});

describe("members on Firestore", () => {
  test("two admins demoting each other concurrently leave exactly one admin", async () => {
    const results = await Promise.all([
      reason(updateMember(deps, asUser("admin1"), { ...base, requestId: rid(), userId: "admin2", role: "member" })),
      reason(updateMember(deps, asUser("admin2"), { ...base, requestId: rid(), userId: "admin1", role: "member" })),
    ]);
    assert.equal(results.filter(r => r === "OK").length, 1, JSON.stringify(results));
    const admins = await db.collection("users").where("companyId", "==", "alpha").where("role", "==", "admin").get();
    assert.equal(admins.size, 1);
  });

  test("concurrent point deductions never overdraw and each is applied once", async () => {
    const results = await Promise.all([1, 2, 3].map(() => reason(adjustMemberPoints(deps, asUser("admin1"), { ...base, requestId: rid(), userId: "m3", delta: -40, reason: "Correction" }))));
    assert.equal(results.filter(r => r === "OK").length, 2);
    assert.equal((await db.doc("users/m3").get()).get("pointsBalance"), 20);
    assert.equal((await db.collection("companies/alpha/pointTransactions").get()).size, 2);
  });

  test("deactivation revokes sessions and cancels upcoming RSVPs found through the collection-group query", async () => {
    await addEventAttendee(deps, asUser("admin1"), { ...base, requestId: rid(), eventId: "soon", userId: "m4" });
    const result = await setMemberStatus(deps, asUser("admin1"), { ...base, requestId: rid(), userId: "m4", status: "deactivated", reason: "Left" });
    assert.equal(result.rsvpsCancelled, 1);
    assert.deepEqual(revoked, ["m4"]);
    assert.equal((await db.doc("users/m4").get()).get("status"), "deactivated");
    assert.equal((await db.doc("companies/alpha/events/soon").get()).get("attendeeCount"), 0);
    assert.equal((await db.doc("companies/alpha/events/soon/rsvps/m4").get()).get("status"), "cancelled");
    assert.equal(await reason(addEventAttendee(deps, asUser("admin1"), { ...base, requestId: rid(), eventId: "soon", userId: "m4" })), "MEMBER_NOT_FOUND");
  });

  test("the directory pages by document id and organizers do not see points", async () => {
    const seen: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await listMembers(deps, asUser("admin1"), { ...base, pageSize: 4, ...(token ? { pageToken: token } : {}) });
      seen.push(...response.members.map(m => m.userId));
      token = response.nextPageToken;
      if (!token) break;
    }
    assert.deepEqual([...seen].sort(), ["admin1", "admin2", "m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "org1"]);
    const organizerView = await listMembers(deps, asUser("org1"), { ...base, query: "member 3" });
    assert.deepEqual(organizerView.members.map(m => m.userId), ["m3"]);
    assert.equal(organizerView.members[0]!.pointsBalance, undefined);
  });

  test("the admin rate limiter refuses after its window budget", async () => {
    const limiter = new FirestoreAdminRateLimiter(db, () => 1_000_000);
    for (let i = 0; i < 120; i++) await limiter.consume("spammer");
    assert.equal(await reason(limiter.consume("spammer")), "RATE_LIMITED");
    await limiter.consume("someone-else");
  });
});

describe("bulk import and roster on Firestore", () => {
  test("plans and applies 250 rows in chunks, is idempotent, and never touches protected fields", async () => {
    await db.doc("companies/alpha/teams/t1").set({ companyId: "alpha", name: "Platform", archived: false, revision: 1 });
    const rows = [{ email: "member.2@alpha.test", teamIds: ["Platform"], workLocation: "HQ" },
      ...Array.from({ length: 249 }, (_, i) => ({ email: `new${i}@alpha.test`, role: "member", jobTitle: `Role ${i}` }))];
    const planned = await importEmployees(deps, asUser("admin1"), { ...base, requestId: rid(), fileName: "people.csv", rows });
    assert.deepEqual(planned.totals, { total: 250, create: 249, update: 1, unchanged: 0, invalid: 0 });
    assert.equal(planned.chunkCount, 3);
    assert.equal((await db.collection("companies/alpha/roster").get()).size, 0, "the dry run writes no roster entries");
    const body = { ...base, jobId: planned.jobId, planHash: planned.planHash };
    let last = await applyEmployeeImport(deps, asUser("admin1"), body);
    assert.equal(last.done, false);
    while (!last.done) last = await applyEmployeeImport(deps, asUser("admin1"), body);
    assert.equal(last.status, "completed");
    assert.deepEqual(last.progress, { processed: 250, total: 250, created: 249, updated: 1, unchanged: 0, failed: 0 });
    const member = (await db.doc("users/m2").get()).data()!;
    assert.deepEqual([member.workLocation, member.teamIds, member.pointsBalance, member.displayName, member.revision], ["HQ", ["t1"], 100, "Member 2", 1]);
    assert.equal((await db.collection("companies/alpha/roster").get()).size, 249);
    assert.equal((await db.doc(`companies/alpha/roster/${sha("new7@alpha.test")}`).get()).get("source"), "import");
    const job = await getEmployeeImport(deps, asUser("admin1"), { ...base, jobId: planned.jobId });
    assert.equal(job.job.status, "completed");
    assert.equal((await db.doc(`companies/alpha/importJobs/${planned.jobId}`).get()).get("leaseUntil"), undefined);
    const rerun = await importEmployees(deps, asUser("admin1"), { ...base, requestId: rid(), rows });
    assert.deepEqual(rerun.totals, { total: 250, create: 0, update: 0, unchanged: 250, invalid: 0 });
    assert.equal(await reason(importEmployees(deps, asUser("org1"), { ...base, requestId: rid(), rows })), "INSUFFICIENT_ROLE");
    assert.equal(await reason(applyEmployeeImport(deps, asUser("bo"), body)), "COMPANY_MISMATCH");
  });

  test("a roster entry is claimed by the first verified Google sign-in, exactly once, with its attributes", async () => {
    await upsertRosterEntry(deps, asUser("admin1"), { ...base, requestId: rid(), entry: { email: "Fresh.Hire@alpha.test", role: "organizer", workLocation: "HQ", department: "Ops", jobTitle: "Lead", displayName: "Fresh Hire" } });
    const membership = new FirestoreMembershipStore(db);
    const identity = (uid: string, email: string) => ({ uid, email, emailVerified: true, signInProvider: "google.com", name: "Fresh H." });
    assert.deepEqual(await resolveMembership(membership, identity("new-user", "fresh.hire@alpha.test"), { contractVersion: 1 }), { contractVersion: 1, companyId: "alpha", role: "organizer" });
    const user = (await db.doc("users/new-user").get()).data()!;
    assert.deepEqual([user.role, user.workLocation, user.department, user.jobTitle, user.status, user.pointsBalance, user.displayName], ["organizer", "HQ", "Ops", "Lead", "active", 0, "Fresh H."]);
    const entry = (await db.doc(`companies/alpha/roster/${sha("fresh.hire@alpha.test")}`).get()).data()!;
    assert.deepEqual([entry.status, entry.claimedBy], ["claimed", "new-user"]);
    assert.ok(entry.claimedAt instanceof Timestamp);
    assert.equal((await db.doc(`companies/alpha/auditLog/claim_${sha("fresh.hire@alpha.test")}`).get()).get("action"), "roster.claim");
    // A different uid with the same email can't claim it again and gets today's default member.
    assert.equal((await resolveMembership(membership, identity("second-user", "fresh.hire@alpha.test"), { contractVersion: 1 })).role, "member");
    // The roster entry now belongs to a member: it can no longer be upserted.
    assert.equal(await reason(upsertRosterEntry(deps, asUser("admin1"), { ...base, requestId: rid(), entry: { email: "fresh.hire@alpha.test" } })), "EMAIL_ALREADY_MEMBER");
  });

  test("roster-only companies refuse everyone else; deactivated members are refused", async () => {
    await db.doc("companies/alpha").update({ membershipMode: "rosterOnly" });
    const membership = new FirestoreMembershipStore(db);
    const identity = (uid: string, email: string) => ({ uid, email, emailVerified: true, signInProvider: "google.com", name: "Someone" });
    await assert.rejects(resolveMembership(membership, identity("stranger", "stranger@alpha.test"), { contractVersion: 1 }), (e: { reason?: string }) => e.reason === "NOT_ON_ROSTER");
    assert.equal((await db.doc("users/stranger").get()).exists, false);
    await db.doc("users/m5").update({ status: "deactivated" });
    await assert.rejects(resolveMembership(membership, identity("m5", "member.5@alpha.test"), { contractVersion: 1 }), (e: { reason?: string }) => e.reason === "ACCOUNT_DEACTIVATED");
    // Existing active members are unaffected by switching to roster-only.
    assert.equal((await resolveMembership(membership, identity("m6", "member.6@alpha.test"), { contractVersion: 1 })).role, "member");
  });
});
