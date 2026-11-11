import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from "firebase/firestore";

// Admin backend rules (docs/contracts/admin.md): admin-only audit log, roster and import jobs; same-company teams;
// organizer reads; deactivation; and the server-owned member fields.
let env: RulesTestEnvironment;
const c = "adm-alpha";
const o = "adm-beta";
const user = (companyId: string, role: string, extra: Record<string, unknown> = {}) => ({
  companyId, role, displayName: `${role} user`, email: `${role}@x.test`, photoURL: "", avatarId: "a1", department: "Eng", jobTitle: "", city: "",
  interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 7, createdAt: Timestamp.now(), ...extra,
});
const fs = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async context => {
    const store = context.firestore();
    await store.doc("users/adm-admin").set(user(c, "admin"));
    await store.doc("users/adm-org").set(user(c, "organizer"));
    await store.doc("users/adm-member").set(user(c, "member"));
    await store.doc("users/adm-gone").set(user(c, "admin", { status: "deactivated" }));
    await store.doc("users/adm-active").set(user(c, "member", { status: "active", workLocation: "HQ", teamIds: ["t1"], revision: 2 }));
    await store.doc("users/adm-other-admin").set(user(o, "admin"));
    const event = (companyId: string, status: string) => ({ companyId, title: "Boat", status, startTime: Timestamp.fromMillis(Date.now() + 3_600_000), endTime: Timestamp.fromMillis(Date.now() + 7_200_000), capacity: 5, attendeeCount: 0, revision: 1 });
    await store.doc(`companies/${c}/events/scheduled`).set(event(c, "scheduled"));
    await store.doc(`companies/${c}/events/cancelled`).set(event(c, "cancelled"));
    await store.doc(`companies/${c}/teams/t1`).set({ companyId: c, name: "Platform", archived: false, revision: 1 });
    await store.doc(`companies/${o}/teams/t9`).set({ companyId: o, name: "Other", archived: false, revision: 1 });
    await store.doc(`companies/${c}/auditLog/a1`).set({ companyId: c, actorId: "x", action: "member.update", targetType: "member", targetId: "m", summary: "s", changes: [] });
    await store.doc(`companies/${o}/auditLog/a2`).set({ companyId: o, actorId: "x", action: "member.update", targetType: "member", targetId: "m", summary: "s", changes: [] });
    await store.doc(`companies/${c}/roster/${"a".repeat(64)}`).set({ companyId: c, email: "new@x.test", role: "member", status: "invited" });
    await store.doc(`companies/${c}/importJobs/j1`).set({ companyId: c, status: "planned" });
    await store.doc(`companies/${c}/importJobs/j1/chunks/0`).set({ index: 0, rows: [{ email: "private@x.test" }] });
    await store.doc(`companies/${c}/commandReceipts/admin_x_req-12345678`).set({ command: "x" });
    await store.doc(`companies/${c}/pointTransactions/p1`).set({ companyId: c, userId: "adm-member", amount: 5 });
    await store.doc("adminRateLimits/adm-admin").set({ calls: 1 });
  });
});
after(async () => { await env.cleanup(); });

const listOf = (db: ReturnType<typeof fs>, path: string, max = 50) => getDocs(query(collection(db, path), limit(max)));

test("the audit log is readable by same-company admins only, never writable by any client", async () => {
  await assertSucceeds(getDoc(doc(fs("adm-admin"), `companies/${c}/auditLog/a1`)));
  await assertSucceeds(listOf(fs("adm-admin"), `companies/${c}/auditLog`));
  for (const reader of ["adm-org", "adm-member", "adm-gone", "adm-other-admin"]) {
    await assertFails(getDoc(doc(fs(reader), `companies/${c}/auditLog/a1`)));
    await assertFails(listOf(fs(reader), `companies/${c}/auditLog`));
  }
  await assertFails(getDoc(doc(fs("adm-admin", false), `companies/${c}/auditLog/a1`)));
  await assertFails(getDoc(doc(fs("adm-admin"), `companies/${o}/auditLog/a2`)));
  await assertFails(getDocs(collection(fs("adm-admin"), `companies/${c}/auditLog`)), "unbounded list");
  await assertFails(getDocs(query(collection(fs("adm-admin"), `companies/${c}/auditLog`), limit(101))));
  const admin = fs("adm-admin");
  await assertFails(setDoc(doc(admin, `companies/${c}/auditLog/forged`), { companyId: c, action: "x" }));
  await assertFails(updateDoc(doc(admin, `companies/${c}/auditLog/a1`), { summary: "edited" }));
  await assertFails(deleteDoc(doc(admin, `companies/${c}/auditLog/a1`)));
});

test("the roster and import jobs are admin-only; plan chunks, receipts, ledger and rate limits stay server-only", async () => {
  const roster = `companies/${c}/roster/${"a".repeat(64)}`;
  await assertSucceeds(getDoc(doc(fs("adm-admin"), roster)));
  await assertSucceeds(listOf(fs("adm-admin"), `companies/${c}/roster`));
  await assertSucceeds(getDoc(doc(fs("adm-admin"), `companies/${c}/importJobs/j1`)));
  for (const reader of ["adm-org", "adm-member", "adm-other-admin"]) {
    await assertFails(getDoc(doc(fs(reader), roster)));
    await assertFails(listOf(fs(reader), `companies/${c}/roster`));
    await assertFails(getDoc(doc(fs(reader), `companies/${c}/importJobs/j1`)));
  }
  const admin = fs("adm-admin");
  await assertFails(setDoc(doc(admin, roster), { status: "claimed" }));
  await assertFails(updateDoc(doc(admin, roster), { role: "admin" }));
  await assertFails(deleteDoc(doc(admin, roster)));
  await assertFails(setDoc(doc(admin, `companies/${c}/importJobs/j2`), { status: "planned" }));
  await assertFails(getDoc(doc(admin, `companies/${c}/importJobs/j1/chunks/0`)));
  await assertFails(getDoc(doc(admin, `companies/${c}/commandReceipts/admin_x_req-12345678`)));
  await assertFails(getDoc(doc(admin, `companies/${c}/pointTransactions/p1`)));
  await assertFails(getDoc(doc(admin, "adminRateLimits/adm-admin")));
  await assertFails(setDoc(doc(admin, `companies/${c}/pointTransactions/forged`), { companyId: c, userId: "adm-admin", amount: 999 }));
});

test("teams are readable by same-company members and never writable", async () => {
  for (const reader of ["adm-admin", "adm-org", "adm-member"]) {
    await assertSucceeds(getDoc(doc(fs(reader), `companies/${c}/teams/t1`)));
    await assertSucceeds(listOf(fs(reader), `companies/${c}/teams`));
  }
  await assertFails(getDoc(doc(fs("adm-other-admin"), `companies/${c}/teams/t1`)));
  await assertFails(getDoc(doc(fs("adm-member"), `companies/${o}/teams/t9`)));
  await assertFails(getDocs(collection(fs("adm-member"), `companies/${c}/teams`)));
  await assertFails(setDoc(doc(fs("adm-admin"), `companies/${c}/teams/t2`), { companyId: c, name: "X" }));
  await assertFails(updateDoc(doc(fs("adm-admin"), `companies/${c}/teams/t1`), { name: "Renamed" }));
  await assertFails(deleteDoc(doc(fs("adm-admin"), `companies/${c}/teams/t1`)));
});

test("organizers read cancelled events like admins; members still cannot", async () => {
  await assertSucceeds(getDoc(doc(fs("adm-org"), `companies/${c}/events/cancelled`)));
  await assertSucceeds(getDoc(doc(fs("adm-admin"), `companies/${c}/events/cancelled`)));
  await assertFails(getDoc(doc(fs("adm-member"), `companies/${c}/events/cancelled`)));
  await assertFails(setDoc(doc(fs("adm-org"), `companies/${c}/events/new`), { companyId: c }));
});

test("a deactivated member loses every same-company read but keeps own profile access", async () => {
  await assertFails(getDoc(doc(fs("adm-gone"), `companies/${c}/events/scheduled`)));
  await assertFails(getDoc(doc(fs("adm-gone"), `companies/${c}/teams/t1`)));
  await assertFails(getDoc(doc(fs("adm-gone"), `companies/${c}/events/cancelled`)));
  await assertSucceeds(getDoc(doc(fs("adm-gone"), "users/adm-gone")));
  await assertSucceeds(getDoc(doc(fs("adm-active"), `companies/${c}/events/scheduled`)));
});

test("clients cannot write the server-owned member fields, role, status, teams or points", async () => {
  const own = (uid: string) => doc(fs(uid), `users/${uid}`);
  for (const patch of [{ role: "admin" }, { status: "invited" }, { status: "deactivated" }, { teamIds: ["t-other"] }, { workLocation: "Remote" }, { revision: 9 },
    { managerEmail: "a@b.c" }, { startDate: "2030-01-01" }, { pointsBalance: 1_000_000 }, { statusUpdatedAt: Timestamp.now() }]) {
    await assertFails(updateDoc(own("adm-member"), patch));
    await assertFails(updateDoc(own("adm-active"), patch));
  }
  // Own-profile edits still work for members who carry the new server-owned fields.
  await assertSucceeds(updateDoc(own("adm-active"), { department: "Ops" }));
  await assertSucceeds(updateDoc(own("adm-member"), { city: "Pittsburgh" }));
  await assertFails(updateDoc(doc(fs("adm-member"), "users/adm-active"), { department: "Hacked" }));
  await assertFails(getDoc(doc(fs("adm-admin"), "users/adm-member")), "admins have no direct private-profile read (listMembersV1 only)");
});
