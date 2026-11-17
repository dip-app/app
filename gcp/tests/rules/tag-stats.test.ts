import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from "firebase/firestore";

// Tag interest counts (docs/design/stretch/tag-interest-counts.md): organizer/admin read, no client writes,
// receipts server-only.
let env: RulesTestEnvironment;
const company = "tagstat-alpha";
const other = "tagstat-beta";
const stats = `companies/${company}/tagStats`;
const statPath = `${stats}/cook`;
const receiptPath = `companies/${company}/tagStatReceipts/evt1`;
const fs = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    const users: Record<string, Record<string, unknown>> = {
      "ts-member": { companyId: company, role: "member" },
      "ts-organizer": { companyId: company, role: "organizer" },
      "ts-admin": { companyId: company, role: "admin" },
      "ts-other-organizer": { companyId: other, role: "organizer" },
      "ts-deactivated": { companyId: company, role: "organizer", status: "deactivated" },
      "ts-unverified": { companyId: company, role: "organizer" },
    };
    for (const [uid, data] of Object.entries(users)) await store.doc(`users/${uid}`).set({ displayName: uid, avatarId: "a", ...data });
    await store.doc(statPath).set({ tagId: "cook", memberCount: 7, updatedAt: Timestamp.now() });
    await store.doc(`${stats}/run`).set({ tagId: "run", memberCount: 2, updatedAt: Timestamp.now() });
    await store.doc(receiptPath).set({ createdAt: Timestamp.now(), expireAt: Timestamp.now() });
  });
});
after(async () => { await env.cleanup(); });

test("organizer and admin get and list (bounded) tag stats", async () => {
  for (const uid of ["ts-organizer", "ts-admin"]) {
    const db = fs(uid);
    await assertSucceeds(getDoc(doc(db, statPath)));
    await assertSucceeds(getDocs(query(collection(db, stats), limit(200))));
    await assertSucceeds(getDocs(query(collection(db, stats), limit(50))));
  }
});

test("unbounded or oversized lists are refused", async () => {
  const db = fs("ts-organizer");
  await assertFails(getDocs(collection(db, stats)));
  await assertFails(getDocs(query(collection(db, stats), limit(201))));
});

test("members, other tenants, deactivated, unverified and signed-out callers cannot read", async () => {
  const callers = {
    member: fs("ts-member"), otherOrganizer: fs("ts-other-organizer"), deactivated: fs("ts-deactivated"),
    unverified: fs("ts-unverified", false), anonymous: anon(),
  };
  for (const db of Object.values(callers)) {
    await assertFails(getDoc(doc(db, statPath)));
    await assertFails(getDocs(query(collection(db, stats), limit(50))));
  }
});

test("every client write to tag stats is refused, even for admins", async () => {
  for (const db of [fs("ts-admin"), fs("ts-organizer"), fs("ts-member"), anon()]) {
    await assertFails(setDoc(doc(db, `${stats}/forged`), { tagId: "forged", memberCount: 999 }));
    await assertFails(setDoc(doc(db, statPath), { tagId: "cook", memberCount: 999 }));
    await assertFails(updateDoc(doc(db, statPath), { memberCount: 999 }));
    await assertFails(deleteDoc(doc(db, statPath)));
  }
});

test("tag stat receipts are server-only for reads and writes, including admins", async () => {
  for (const db of [fs("ts-admin"), fs("ts-organizer"), fs("ts-member"), anon()]) {
    await assertFails(getDoc(doc(db, receiptPath)));
    await assertFails(getDocs(query(collection(db, `companies/${company}/tagStatReceipts`), limit(10))));
    await assertFails(setDoc(doc(db, `companies/${company}/tagStatReceipts/new`), { createdAt: Timestamp.now() }));
    await assertFails(updateDoc(doc(db, receiptPath), { createdAt: Timestamp.now() }));
    await assertFails(deleteDoc(doc(db, receiptPath)));
  }
});
