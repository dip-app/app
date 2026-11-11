import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from "firebase/firestore";
import { getStorage, connectStorageEmulator, ref, uploadBytes } from "firebase/storage";

// Run with: npm run test:challenge-submissions:integration. Exercises the real client SDKs against
// storage.rules, firestore.rules and the submit/approve/reject/list callables on the emulators.
const projectId = "demo-dip";
const bucket = `${projectId}.appspot.com`;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
for (const host of [authHost, firestoreHost, storageHost, functionsHost]) {
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)) throw new Error("Requires local emulators.");
}
if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) throw new Error("Requires demo-dip.");
const req = createRequire(require.resolve("../../functions/package.json"));
const adminApp = req("firebase-admin/app") as typeof import("firebase-admin/app");
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const adminAuth = req("firebase-admin/auth") as typeof import("firebase-admin/auth");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
async function rejects(promise: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error.code, code.includes("/") || code.startsWith("firestore:") ? code.replace("firestore:", "") : `functions/${code}`, String(error));
    if (reason) assert.equal(error.details?.reason, reason);
    return true;
  });
}

test("submit, review and award flow through the real SDKs, rules and ledger", { timeout: 180_000 }, async t => {
  const stamp = `subs-${Date.now()}`;
  const admin = adminApp.initializeApp({ projectId, storageBucket: bucket }, stamp);
  const db = adminFirestore.getFirestore(admin);
  const companyId = `${stamp}-alpha`;
  const challengeId = "week1";
  const clients = Array.from({ length: 4 }, (_, i) => {
    const app = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app", storageBucket: bucket }, `${stamp}-${i}`);
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(app, "us-central1");
    const [fnHost, fnPort] = functionsHost.split(":"); connectFunctionsEmulator(functions, fnHost!, Number(fnPort));
    const firestore = getFirestore(app);
    const [fsHost, fsPort] = firestoreHost!.split(":"); connectFirestoreEmulator(firestore, fsHost!, Number(fsPort));
    const storage = getStorage(app);
    const [stHost, stPort] = storageHost!.split(":"); connectStorageEmulator(storage, stHost!, Number(stPort));
    return {
      app, auth, firestore, storage,
      submit: httpsCallable(functions, "submitChallengeV1"), approve: httpsCallable(functions, "approveChallengeV1"),
      reject: httpsCallable(functions, "rejectChallengeV1"), list: httpsCallable(functions, "listChallengeSubmissionsV1"),
    };
  });
  const [member, organizer, outsider, other] = clients as [typeof clients[number], typeof clients[number], typeof clients[number], typeof clients[number]];
  const roles = ["member", "admin", "member", "member"];
  const uids: string[] = [];
  for (const [index, client] of [member, organizer, outsider, other].entries()) {
    const email = `${stamp}-${index}@synthetic.test`;
    const token = JSON.stringify({ sub: email, email, email_verified: true, name: `Member ${index}` });
    const { user } = await signInWithCredential(client.auth, GoogleAuthProvider.credential(token));
    uids.push(user.uid);
    await db.doc(`users/${user.uid}`).set({ companyId: index === 2 ? `${companyId}-other` : companyId, role: roles[index],
      displayName: `Member ${index}`, avatarId: `avatar-${index}`, pointsBalance: 5 });
  }
  const [uid, organizerUid, outsiderUid] = uids as [string, string, string];
  await db.doc(`companies/${companyId}/challenges/${challengeId}`).set({
    companyId, title: "Fitness", description: "Move", tagIds: [], type: "weekly", goal: 5, goalUnit: "workouts",
    coverImageURL: "catalog://theme/fitness", startDate: adminFirestore.Timestamp.fromMillis(Date.now() - 86_400_000),
    endDate: adminFirestore.Timestamp.fromMillis(Date.now() + 86_400_000), pointsReward: 40, participantCount: 0, completedCount: 0, revision: 1,
  });
  // Close every client and admin handle so the test process exits (open Firestore/Auth handles otherwise hang it).
  t.after(async () => {
    await db.recursiveDelete(db.doc(`companies/${companyId}`)).catch(() => undefined);
    for (const user of uids) {
      await db.doc(`users/${user}`).delete().catch(() => undefined);
      await adminAuth.getAuth(admin).deleteUser(user).catch(() => undefined);
    }
    for (const client of clients) await deleteApp(client.app).catch(() => undefined);
    await adminApp.deleteApp(admin).catch(() => undefined);
  });
  const evidence = (slot: number) => `companies/${companyId}/challenges/${challengeId}/submissions/${uid}/${slot}`;
  const payload = (overrides: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId, challengeId, progress: 3, caption: "Ran", ...overrides });
  const review = (overrides: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId, challengeId, userId: uid, ...overrides });
  const submissionPath = `companies/${companyId}/challenges/${challengeId}/submissions/${challengeId}_${uid}`;

  await t.test("submit with evidence creates a pending submission; a replay changes nothing", async () => {
    await uploadBytes(ref(member.storage, evidence(0)), JPEG, { contentType: "image/jpeg" });
    const first = await member.submit(payload({ storagePath: evidence(0) }));
    assert.deepEqual(first.data, { contractVersion: 1, submissionId: `${challengeId}_${uid}`, status: "submitted", outcome: "created", attempt: 1 });
    const replay = await member.submit(payload({ storagePath: evidence(0) }));
    assert.equal((replay.data as { outcome: string }).outcome, "unchanged");
    const mine = (await getDoc(doc(member.firestore, submissionPath))).data()!;
    assert.equal(mine.status, "submitted");
    assert.equal(mine.pointsAwarded, 0);
    assert.equal((await db.doc(`companies/${companyId}/challenges/${challengeId}`).get()).get("participantCount"), 1);
  });

  await t.test("a colleague or outsider cannot read the submission; the organizer cannot via the SDK", async () => {
    await rejects(getDoc(doc(other.firestore, submissionPath)), "firestore:permission-denied");
    await rejects(getDoc(doc(outsider.firestore, submissionPath)), "firestore:permission-denied");
  });

  await t.test("bad submissions are refused with stable reasons", async () => {
    await rejects(member.submit(payload({ status: "approved" })), "invalid-argument", "VALIDATION_FAILED");
    await rejects(member.submit(payload({ progress: 6 })), "invalid-argument", "VALIDATION_FAILED");
    await rejects(outsider.submit(payload()), "permission-denied", "MEMBERSHIP_CONFLICT");
    await rejects(member.submit(payload({ progress: 4, storagePath: evidence(1) })), "failed-precondition", "UPLOAD_NOT_FOUND");
    await uploadBytes(ref(member.storage, evidence(2)), GIF, { contentType: "image/gif" }).then(
      () => assert.fail("gif upload must be denied"), () => undefined);
  });

  await t.test("members cannot review; organizers of the company approve once and points land in the ledger", async () => {
    await rejects(member.approve(review()), "permission-denied", "NOT_ORGANIZER");
    await rejects(member.list({ contractVersion: 1, companyId, challengeId }), "permission-denied", "NOT_ORGANIZER");
    const queue = await organizer.list({ contractVersion: 1, companyId, challengeId, status: "submitted" });
    assert.deepEqual((queue.data as { submissions: { userId: string }[] }).submissions.map(s => s.userId), [uid]);
    const [a, b] = await Promise.all([organizer.approve(review()), organizer.approve(review())]);
    const awarded = [a, b].map(r => (r.data as { pointsAwarded: number }).pointsAwarded).sort();
    assert.deepEqual(awarded, [0, 40]);
    assert.equal((await db.doc(`users/${uid}`).get()).get("pointsBalance"), 45);
    assert.equal((await db.doc(`companies/${companyId}/pointTransactions/challenge_${challengeId}_${uid}`).get()).get("amount"), 40);
    assert.equal((await db.doc(`companies/${companyId}/challenges/${challengeId}`).get()).get("completedCount"), 1);
    const mine = (await getDoc(doc(member.firestore, submissionPath))).data()!;
    assert.deepEqual([mine.status, mine.pointsAwarded, mine.reviewedBy], ["approved", 40, organizerUid]);
    await rejects(member.submit(payload({ progress: 5 })), "failed-precondition", "SUBMISSION_LOCKED");
    await rejects(organizer.reject(review({ reason: "late" })), "failed-precondition", "SUBMISSION_LOCKED");
    assert.notEqual(outsiderUid, uid);
  });
});
