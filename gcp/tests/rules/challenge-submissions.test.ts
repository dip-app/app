import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from "firebase/firestore";

// Challenge submissions: Storage evidence upload/read (cross-service) and Firestore submission + ledger rules.
let env: RulesTestEnvironment;
const company = "sub-alpha";
const other = "sub-beta";
const DAY = 86_400_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const profile = (c: string, name: string, role = "member") => ({ companyId: c, role, displayName: name, avatarId: `avatar-${name}`, pointsBalance: 0 });
const challenge = (c: string, startOffset: number, endOffset: number) => ({
  companyId: c, title: "Fitness", type: "weekly", goal: 5, goalUnit: "workouts", pointsReward: 50,
  startDate: Timestamp.fromMillis(Date.now() + startOffset), endDate: Timestamp.fromMillis(Date.now() + endOffset),
  participantCount: 0, completedCount: 0, revision: 1,
});
const submission = (uid: string, challengeId = "open", c = company) => ({
  companyId: c, challengeId, userId: uid, userName: "Member", userAvatarId: "a", caption: "", progress: 3, status: "submitted",
  storagePath: null, attempt: 1, pointsAwarded: 0, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
});
const ledger = (uid: string, c = company) => ({ companyId: c, userId: uid, amount: 50, reason: "challenge_approved", sourceId: "open", createdAt: Timestamp.now() });
const objectPath = (challengeId: string, uid: string, slot: string | number, c = company) =>
  `companies/${c}/challenges/${challengeId}/submissions/${uid}/${slot}`;
const fs = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const st = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).storage();
const upload = (storage: ReturnType<typeof st>, path: string, bytes: Uint8Array = JPEG, contentType = "image/jpeg") =>
  storage.ref(path).put(bytes, { contentType });
const subPath = (challengeId: string, uid: string, c = company) => `companies/${c}/challenges/${challengeId}/submissions/${challengeId}_${uid}`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-dip",
    firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") },
    storage: { host: "127.0.0.1", port: 9199, rules: readFileSync("gcp/storage.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await store.doc("users/sub-member").set(profile(company, "Member"));
    await store.doc("users/sub-coworker").set(profile(company, "Coworker"));
    await store.doc("users/sub-admin").set(profile(company, "Admin", "admin"));
    await store.doc("users/sub-outsider").set(profile(other, "Outsider"));
    await store.doc("users/sub-outadmin").set(profile(other, "OutAdmin", "admin"));
    await store.doc(`companies/${company}/challenges/open`).set(challenge(company, -DAY, 5 * DAY));
    await store.doc(`companies/${company}/challenges/ended`).set(challenge(company, -9 * DAY, -2 * DAY));
    await store.doc(`companies/${company}/challenges/future`).set(challenge(company, 2 * DAY, 9 * DAY));
    await store.doc(subPath("open", "sub-member")).set(submission("sub-member"));
    await store.doc(subPath("open", "sub-coworker")).set(submission("sub-coworker"));
    await store.doc(`companies/${company}/pointTransactions/challenge_open_sub-member`).set(ledger("sub-member"));
    await store.doc(`companies/${company}/pointTransactions/challenge_open_sub-coworker`).set(ledger("sub-coworker"));
    await context.storage().ref(objectPath("open", "sub-member", 4)).put(JPEG, { contentType: "image/jpeg" });
  });
});
after(async () => { await env?.cleanup(); });

// --- Storage ---

test("a member uploads evidence into their own slot while the window is open", async () => {
  await assertSucceeds(upload(st("sub-member"), objectPath("open", "sub-member", 0)));
  await assertSucceeds(upload(st("sub-member"), objectPath("open", "sub-member", 1), new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png"));
  await assertSucceeds(upload(st("sub-member"), objectPath("open", "sub-member", 2), new Uint8Array([1, 2, 3]), "image/heic"));
});

test("evidence uploads are create-only and limited to slots 0..4", async () => {
  await assertSucceeds(upload(st("sub-member"), objectPath("open", "sub-member", 3)));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 3)));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 4)));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 5)));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", "05")));
  await assertFails(st("sub-member").ref(objectPath("open", "sub-member", 4)).delete());
});

test("evidence uploads enforce owner folder, tenant, window, type and size", async () => {
  await assertFails(upload(st("sub-coworker"), objectPath("open", "sub-member", 0)));
  await assertFails(upload(st("sub-outsider"), objectPath("open", "sub-outsider", 0)));
  await assertFails(upload(st("sub-member", false), objectPath("open", "sub-member", 0)));
  await assertFails(upload(st("sub-member"), objectPath("ended", "sub-member", 0)));
  await assertFails(upload(st("sub-member"), objectPath("future", "sub-member", 0)));
  await assertFails(upload(st("sub-member"), objectPath("missing", "sub-member", 0)));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 0, other)));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 0), JPEG, "image/gif"));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 0), JPEG, "application/pdf"));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 0), new Uint8Array(0)));
  await assertFails(upload(st("sub-member"), objectPath("open", "sub-member", 0), new Uint8Array(10 * 1024 * 1024 + 1)));
  await assertFails(env.unauthenticatedContext().storage().ref(objectPath("open", "sub-member", 0)).put(JPEG, { contentType: "image/jpeg" }));
});

test("evidence is readable by the owner and same-company organizers only", async () => {
  const path = objectPath("open", "sub-member", 4);
  await assertSucceeds(st("sub-member").ref(path).getMetadata());
  await assertSucceeds(st("sub-admin").ref(path).getMetadata());
  await assertFails(st("sub-coworker").ref(path).getMetadata());
  await assertFails(st("sub-outsider").ref(path).getMetadata());
  await assertFails(st("sub-outadmin").ref(path).getMetadata());
  await assertFails(env.unauthenticatedContext().storage().ref(path).getMetadata());
  await assertFails(st("sub-admin").ref(`companies/${company}/challenges/open/submissions/sub-member`).listAll());
});

// --- Firestore ---

test("a member reads only their own submission; a missing one is observable", async () => {
  await assertSucceeds(getDoc(doc(fs("sub-member"), subPath("open", "sub-member"))));
  await assertFails(getDoc(doc(fs("sub-member"), subPath("open", "sub-coworker"))));
  await assertSucceeds(getDoc(doc(fs("sub-admin"), subPath("open", "sub-admin"))));
  await assertFails(getDoc(doc(fs("sub-admin"), subPath("open", "sub-member"))));
  await assertFails(getDoc(doc(fs("sub-outsider"), subPath("open", "sub-member"))));
  await assertFails(getDoc(doc(fs("sub-member", false), subPath("open", "sub-member"))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), subPath("open", "sub-member"))));
});

test("submissions cannot be listed or written by any client", async () => {
  const db = fs("sub-member");
  await assertFails(getDocs(query(collection(db, `companies/${company}/challenges/open/submissions`), limit(10))));
  await assertFails(getDocs(query(collection(db, `companies/${company}/challenges/open/submissions`), where("userId", "==", "sub-member"), limit(10))));
  await assertFails(setDoc(doc(db, subPath("open", "sub-new")), submission("sub-new")));
  await assertFails(setDoc(doc(db, subPath("open", "sub-member")), { ...submission("sub-member"), status: "approved", pointsAwarded: 9999 }));
  await assertFails(updateDoc(doc(db, subPath("open", "sub-member")), { status: "approved" }));
  await assertFails(deleteDoc(doc(db, subPath("open", "sub-member"))));
  await assertFails(updateDoc(doc(fs("sub-admin"), subPath("open", "sub-member")), { status: "approved" }));
});

test("the points ledger is readable by its owner only and never writable", async () => {
  const db = fs("sub-member");
  await assertSucceeds(getDoc(doc(db, `companies/${company}/pointTransactions/challenge_open_sub-member`)));
  await assertFails(getDoc(doc(db, `companies/${company}/pointTransactions/challenge_open_sub-coworker`)));
  const ledgerPath = `companies/${company}/pointTransactions`;
  await assertSucceeds(getDocs(query(collection(db, ledgerPath), where("companyId", "==", company), where("userId", "==", "sub-member"), limit(20))));
  await assertFails(getDocs(query(collection(db, ledgerPath), where("companyId", "==", company), limit(20))));
  await assertFails(getDocs(query(collection(db, ledgerPath), where("companyId", "==", company), where("userId", "==", "sub-member"))));
  await assertFails(setDoc(doc(db, `${ledgerPath}/forged`), ledger("sub-member")));
  await assertFails(updateDoc(doc(db, `${ledgerPath}/challenge_open_sub-member`), { amount: 5000 }));
  await assertFails(deleteDoc(doc(db, `${ledgerPath}/challenge_open_sub-member`)));
  await assertFails(getDoc(doc(fs("sub-outsider"), `${ledgerPath}/challenge_open_sub-member`)));
  await assertFails(updateDoc(doc(db, "users/sub-member"), { pointsBalance: 100000 }));
});
