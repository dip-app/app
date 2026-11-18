import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, serverTimestamp, setDoc, doc, collection, getDocs, getDoc, deleteDoc, updateDoc } from "firebase/firestore";

// Member-owned notification preferences: users/{uid}/settings/notifications (PUSH-1).
let env: RulesTestEnvironment;
const db = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const path = "users/alice/settings/notifications";
const prefs = (overrides: Record<string, unknown> = {}) => ({ contractVersion: 1, updatedAt: serverTimestamp(), ...overrides });
const full = () => prefs({
  push: { invites: true, event_updates: false, reminders: true, chat: false, challenges: true, social: false, discovery: true },
  email: { invites: true, event_updates: false, reminders: true, challenges: false, discovery: true },
});

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: {
    host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8"),
  }});
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await store.doc("users/alice").set({ companyId: "pref-alpha", role: "member", displayName: "Alice" });
    await store.doc("users/bob").set({ companyId: "pref-alpha", role: "member", displayName: "Bob" });
    await store.doc("users/carol").set({ companyId: "pref-beta", role: "member", displayName: "Carol" });
    await store.doc(path).set({ contractVersion: 1, push: { chat: true }, updatedAt: Timestamp.now() });
    await store.doc("users/alice/settings/other").set({ anything: true });
  });
});
after(async () => { await env?.cleanup(); });

test("owner can create a full preference document and a minimal one", async () => {
  await assertSucceeds(setDoc(doc(db("alice"), path), full()));
  await assertSucceeds(setDoc(doc(db("bob"), "users/bob/settings/notifications"), prefs()));
});

test("owner can flip one switch with merge or update and a fresh server timestamp", async () => {
  await assertSucceeds(setDoc(doc(db("alice"), path), { contractVersion: 1, push: { chat: false }, updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(updateDoc(doc(db("alice"), path), { "push.social": true, updatedAt: serverTimestamp() }));
});

test("owner can get the document, also when it is missing", async () => {
  await assertSucceeds(getDoc(doc(db("alice"), path)));
  await assertSucceeds(getDoc(doc(db("carol"), "users/carol/settings/notifications")));
});

test("signed-out, unverified, same-company and other-company callers are denied", async () => {
  const anonymous = env.unauthenticatedContext().firestore();
  for (const client of [anonymous, db("alice", false), db("bob"), db("carol")]) {
    await assertFails(getDoc(doc(client, path)));
    await assertFails(setDoc(doc(client, path), prefs()));
  }
});

test("updatedAt must equal the request time and contractVersion must be 1", async () => {
  const client = db("alice");
  await assertFails(setDoc(doc(client, path), prefs({ updatedAt: Timestamp.fromMillis(Date.now() - 60_000) })));
  await assertFails(setDoc(doc(client, path), { contractVersion: 1 }));
  await assertFails(setDoc(doc(client, path), prefs({ contractVersion: 2 })));
  await assertFails(setDoc(doc(client, path), { push: { chat: true }, updatedAt: serverTimestamp() }));
});

test("unknown top-level keys are rejected", async () => {
  const client = db("alice");
  await assertFails(setDoc(doc(client, path), prefs({ companyId: "pref-alpha" })));
  await assertFails(setDoc(doc(client, path), prefs({ role: "admin" })));
});

test("push and email maps accept only their own categories and boolean values", async () => {
  const client = db("alice");
  await assertFails(setDoc(doc(client, path), prefs({ push: { marketing: true } })));
  await assertFails(setDoc(doc(client, path), prefs({ email: { chat: true } })));
  await assertFails(setDoc(doc(client, path), prefs({ email: { social: false } })));
  await assertFails(setDoc(doc(client, path), prefs({ push: { chat: "yes" } })));
  await assertFails(setDoc(doc(client, path), prefs({ email: { invites: 1 } })));
  await assertFails(setDoc(doc(client, path), prefs({ push: true })));
});

test("email.admin_suggestions accepts a boolean only and is never a push category", async () => {
  const client = db("alice");
  await assertSucceeds(setDoc(doc(client, path), prefs({ email: { admin_suggestions: true } })));
  await assertSucceeds(updateDoc(doc(client, path), { "email.admin_suggestions": false, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(client, path), prefs({ email: { admin_suggestions: "yes" } })));
  await assertFails(setDoc(doc(client, path), prefs({ email: { admin_suggestions: 1 } })));
  await assertFails(setDoc(doc(client, path), prefs({ push: { admin_suggestions: true } })));
});

test("email.calendar_invites accepts a boolean only and is never a push category", async () => {
  const client = db("alice");
  await assertSucceeds(setDoc(doc(client, path), prefs({ email: { calendar_invites: false } })));
  await assertSucceeds(updateDoc(doc(client, path), { "email.calendar_invites": true, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(client, path), prefs({ email: { calendar_invites: "yes" } })));
  await assertFails(setDoc(doc(client, path), prefs({ push: { calendar_invites: true } })));
});

test("other settings documents, delete and list are denied", async () => {
  const client = db("alice");
  await assertFails(getDoc(doc(client, "users/alice/settings/other")));
  await assertFails(setDoc(doc(client, "users/alice/settings/other"), prefs()));
  await assertFails(deleteDoc(doc(client, path)));
  await assertFails(getDocs(collection(client, "users/alice/settings")));
});
