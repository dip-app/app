import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";

// Deactivated members lose writes and company reads but keep reading their own profile (the app shows
// "deactivated"); active members are unaffected. Server-only collections stay closed to every client role.
let env: RulesTestEnvironment;
const company = "deact-co";
const profile = {
  companyId: company, displayName: "Test Member", email: "member@example.test", photoURL: "", avatarId: "a", department: "", jobTitle: "", city: "",
  role: "member", interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0,
  createdAt: Timestamp.fromMillis(1000),
};
const fs = (uid: string) => env.authenticatedContext(uid, { email_verified: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await store.doc("users/dx-active").set(profile);
    await store.doc("users/dx-gone").set({ ...profile, status: "deactivated" });
    await store.doc("users/dx-admin").set({ ...profile, role: "admin" });
    await store.doc(`companies/${company}`).set({ name: "Deact Co", emailDomain: "example.test" });
    for (const uid of ["dx-active", "dx-gone"]) {
      await store.doc(`companies/${company}/events/e1/rsvps/${uid}`).set({
        companyId: company, eventId: "e1", userId: uid, status: "going", eventStartTime: Timestamp.fromMillis(5000), createdAt: Timestamp.fromMillis(1000),
      });
      await store.doc(`users/${uid}/notifications/n1`).set({ isRead: false, title: "x" });
    }
  });
});
after(async () => { await env.cleanup(); });

test("users/{uid}: a deactivated member can read but not update their own profile; an active member can update", async () => {
  await assertSucceeds(getDoc(doc(fs("dx-gone"), "users/dx-gone")));
  await assertFails(updateDoc(doc(fs("dx-gone"), "users/dx-gone"), { city: "Pittsburgh" }));
  await assertSucceeds(updateDoc(doc(fs("dx-active"), "users/dx-active"), { city: "Pittsburgh" }));
});

test("companies/{id}: get requires an active same-company member", async () => {
  await assertFails(getDoc(doc(fs("dx-gone"), `companies/${company}`)));
  await assertSucceeds(getDoc(doc(fs("dx-active"), `companies/${company}`)));
});

test("collection-group rsvps list (My Events) is denied to a deactivated member, allowed for an active one", async () => {
  const mine = (uid: string) => query(collectionGroup(fs(uid), "rsvps"), where("userId", "==", uid), where("companyId", "==", company), where("status", "==", "going"), limit(20));
  await assertFails(getDocs(mine("dx-gone")));
  await assertSucceeds(getDocs(mine("dx-active")));
});

test("own notifications and notification preferences cannot be changed by a deactivated member", async () => {
  await assertFails(updateDoc(doc(fs("dx-gone"), "users/dx-gone/notifications/n1"), { isRead: true }));
  await assertSucceeds(updateDoc(doc(fs("dx-active"), "users/dx-active/notifications/n1"), { isRead: true }));
  const prefs = { contractVersion: 1, push: { chat: false }, updatedAt: serverTimestamp() };
  await assertFails(setDoc(doc(fs("dx-gone"), "users/dx-gone/settings/notifications"), prefs));
  await assertSucceeds(setDoc(doc(fs("dx-active"), "users/dx-active/settings/notifications"), prefs));
});

const serverOnly = [
  "emailOutbox/o1", "emailCaps/member_a_20300102", "emailSuppressions/h1", `companies/${company}/aiRequests/a_req-12345678`, `companies/${company}/aiUsage/203001`,
  `companies/${company}/aiUsageDaily/20300102_a`, `companies/${company}/aiSettings/current`, `companies/${company}/tagStatReceipts/r1`,
  "notificationReceipts/h1", "pushRateLimits/dx-active", `companies/${company}/events/e1/pushReceipts/k1`, "adminRateLimits/dx-admin", "accountRateLimits/dx-active",
  "inviteRateLimits/k1", `companies/${company}/commandReceipts/admin_x_req-1`, `companies/${company}/importJobs/j1`, `companies/${company}/importJobs/j1/chunks/0`,
  `companies/${company}/importJobs/j1/results/1`, "users/dx-active/devices/h1",
];

test("server-only collections are unreadable and unwritable for members and admins", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    for (const path of serverOnly) await context.firestore().doc(path).set({ expireAt: Timestamp.now(), email: "x@example.test" });
  });
  for (const uid of ["dx-active", "dx-admin"]) {
    const db = fs(uid);
    for (const path of serverOnly) {
      // The job summary document is the one admin-readable entry (adminOf); chunks and results stay closed.
      if (!(uid === "dx-admin" && path.endsWith("/importJobs/j1"))) await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, `${path}-new`), { expireAt: Timestamp.now() }));
      await assertFails(updateDoc(doc(db, path), { expireAt: Timestamp.now() }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    for (const group of ["emailOutbox", "emailCaps", "emailSuppressions", "notificationReceipts", "pushRateLimits", "adminRateLimits"]) {
      await assertFails(getDocs(query(collection(db, group), limit(5))));
    }
  }
});

test("tag stats cannot be written by any client role", async () => {
  for (const uid of ["dx-active", "dx-admin"]) {
    await assertFails(setDoc(doc(fs(uid), `companies/${company}/tagStats/cook`), { tagId: "cook", memberCount: 1, updatedAt: Timestamp.now() }));
  }
  await assertFails(getDoc(doc(fs("dx-active"), `companies/${company}/tagStats/cook`)));
});
