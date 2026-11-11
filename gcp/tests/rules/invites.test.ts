import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from "firebase/firestore";

// Coworker invitations: sender/recipient reads only, no client writes; in-app notifications are recipient-only
// with an isRead-only update.
let env: RulesTestEnvironment;
const company = "invite-alpha";
const other = "invite-beta";
const invite = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
  companyId: company, eventId: "event", eventTitle: "Pasta", eventStartTime: Timestamp.now(), fromUserId: from, fromUserName: from,
  toUserId: to, message: "Join", status: "pending", createdAt: Timestamp.now(), ...extra,
});
const fs = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const invites = `companies/${company}/invites`;

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    for (const uid of ["inv-sender", "inv-recipient", "inv-bystander"]) await store.doc(`users/${uid}`).set({ companyId: company, role: "member", displayName: uid, avatarId: "a" });
    await store.doc("users/inv-outsider").set({ companyId: other, role: "member", displayName: "outsider", avatarId: "a" });
    await store.doc(`${invites}/event_inv-recipient`).set(invite("inv-sender", "inv-recipient"));
    await store.doc(`${invites}/event_other`).set(invite("inv-bystander", "inv-other-person"));
    await store.doc("users/inv-recipient/notifications/invite_event_inv-recipient").set({
      userId: "inv-recipient", companyId: company, type: "invite", title: "New invitation", body: "x", targetType: "invite",
      targetId: "event_inv-recipient", isRead: false, createdAt: Timestamp.now(),
    });
  });
});
after(async () => { await env.cleanup(); });

test("sender and recipient get the invite; a bystander, an outsider and unverified callers do not", async () => {
  const path = `${invites}/event_inv-recipient`;
  await assertSucceeds(getDoc(doc(fs("inv-recipient"), path)));
  await assertSucceeds(getDoc(doc(fs("inv-sender"), path)));
  await assertFails(getDoc(doc(fs("inv-bystander"), path)));
  await assertFails(getDoc(doc(fs("inv-outsider"), path)));
  await assertFails(getDoc(doc(fs("inv-recipient", false), path)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
  // Another tenant's path is unreadable even for a member of that company.
  await assertFails(getDoc(doc(fs("inv-outsider"), `${invites}/event_inv-recipient`)));
});

test("lists must be bounded and pinned to the caller, so a query cannot reach another person's invites", async () => {
  const db = fs("inv-recipient");
  await assertSucceeds(getDocs(query(collection(db, invites), where("companyId", "==", company), where("toUserId", "==", "inv-recipient"), limit(50))));
  await assertSucceeds(getDocs(query(collection(fs("inv-sender"), invites), where("companyId", "==", company), where("fromUserId", "==", "inv-sender"), limit(50))));
  // Without the companyId equality the rules cannot prove the documents belong to this tenant: refused as a whole.
  await assertFails(getDocs(query(collection(db, invites), where("toUserId", "==", "inv-recipient"), limit(50))));
  await assertFails(getDocs(query(collection(db, invites), where("toUserId", "==", "inv-recipient"))));
  await assertFails(getDocs(query(collection(db, invites), where("toUserId", "==", "inv-recipient"), limit(51))));
  await assertFails(getDocs(query(collection(db, invites), limit(50))));
  await assertFails(getDocs(query(collection(db, invites), where("toUserId", "==", "inv-other-person"), limit(50))));
  await assertFails(getDocs(query(collection(fs("inv-outsider"), invites), where("toUserId", "==", "inv-recipient"), limit(50))));
});

test("clients never create, update or delete invites", async () => {
  const sender = fs("inv-sender");
  const recipient = fs("inv-recipient");
  await assertFails(setDoc(doc(sender, `${invites}/event_new`), invite("inv-sender", "inv-bystander")));
  await assertFails(updateDoc(doc(recipient, `${invites}/event_inv-recipient`), { status: "accepted" }));
  await assertFails(updateDoc(doc(sender, `${invites}/event_inv-recipient`), { message: "edited" }));
  await assertFails(deleteDoc(doc(sender, `${invites}/event_inv-recipient`)));
});

test("rate-limit and other server collections stay denied", async () => {
  await assertFails(getDoc(doc(fs("inv-sender"), "inviteRateLimits/send_inv-sender")));
  await assertFails(setDoc(doc(fs("inv-sender"), "inviteRateLimits/send_inv-sender"), { windowStart: 0, count: 0 }));
});

test("notifications: recipient reads own and flips only isRead; nobody creates or deletes; others are denied", async () => {
  const path = "users/inv-recipient/notifications/invite_event_inv-recipient";
  const recipient = fs("inv-recipient");
  await assertSucceeds(getDoc(doc(recipient, path)));
  await assertSucceeds(getDocs(query(collection(recipient, "users/inv-recipient/notifications"), limit(50))));
  await assertFails(getDocs(query(collection(recipient, "users/inv-recipient/notifications"))));
  await assertFails(getDoc(doc(fs("inv-sender"), path)));
  await assertFails(getDocs(query(collection(fs("inv-sender"), "users/inv-recipient/notifications"), limit(50))));
  await assertFails(updateDoc(doc(recipient, path), { title: "edited" }));
  await assertFails(updateDoc(doc(recipient, path), { isRead: "yes" }));
  await assertFails(updateDoc(doc(recipient, path), { isRead: true, targetId: "other" }));
  await assertFails(setDoc(doc(recipient, "users/inv-recipient/notifications/forged"), { userId: "inv-recipient", isRead: false }));
  await assertFails(deleteDoc(doc(recipient, path)));
  await assertSucceeds(updateDoc(doc(recipient, path), { isRead: true }));
});
