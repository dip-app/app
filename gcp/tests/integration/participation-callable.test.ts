import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential, createUserWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

// Run with: npm run test:participation:integration (setRsvpV1 is exported from the functions root).
const projectId = "demo-dip";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
for (const host of [authHost, firestoreHost, functionsHost]) {
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)) throw new Error("Requires local emulators.");
}
if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) throw new Error("Requires demo-dip.");
const req = createRequire(require.resolve("../../functions/package.json"));
const adminApp = req("firebase-admin/app") as typeof import("firebase-admin/app");
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const adminAuth = req("firebase-admin/auth") as typeof import("firebase-admin/auth");
async function rejects(promise: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error.code, `functions/${code}`);
    if (reason) assert.equal(error.details.reason, reason);
    return true;
  });
}

test("SDK callable enforces identity, atomic RSVP lifecycle, concurrency and denied direct writes", { timeout: 120_000 }, async t => {
  const stamp = `participation-${Date.now()}`;
  const app = adminApp.initializeApp({ projectId }, stamp);
  const db = adminFirestore.getFirestore(app);
  const companyId = `${stamp}-alpha`;
  const eventId = "event";
  const ref = db.doc(`companies/${companyId}/events/${eventId}`);
  const createdUsers: string[] = [];
  const clients = Array.from({ length: 5 }, (_, i) => {
    const app = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, `${stamp}-${i}`);
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(app, "us-central1");
    const [fnHost, fnPort] = functionsHost.split(":"); connectFunctionsEmulator(functions, fnHost!, Number(fnPort));
    const firestore = getFirestore(app);
    const [fsHost, fsPort] = firestoreHost!.split(":"); connectFirestoreEmulator(firestore, fsHost!, Number(fsPort));
    return { app, auth, firestore, call: httpsCallable(functions, "setRsvpV1") };
  });
  const [a,b,other,anonymous,password] = clients as [typeof clients[number], typeof clients[number], typeof clients[number], typeof clients[number], typeof clients[number]];
  const payload = { contractVersion: 1, companyId, eventId, status: "going" };
  const startTime = adminFirestore.Timestamp.fromMillis(Date.now() + 86_400_000);
  const reset = async (overrides = {}) => {
    await db.recursiveDelete(ref);
    await ref.set({ companyId, status: "scheduled", startTime, capacity: 2, attendeeCount: 0, ...overrides });
  };
  try {
    const uids: string[] = [];
    for (const [index, client] of [a,b,other].entries()) {
      const email = `${stamp}-${index}@synthetic.test`;
      const token = JSON.stringify({ sub: email, email, email_verified: true, name: `Member ${index}` });
      const { user } = await signInWithCredential(client.auth, GoogleAuthProvider.credential(token));
      createdUsers.push(user.uid); uids.push(user.uid);
      await db.doc(`users/${user.uid}`).set({ companyId: index === 2 ? `${stamp}-beta` : companyId,
        role: index === 1 ? "admin" : "member", displayName: `Member ${index}`, avatarId: "avatar", department: "Engineering", pointsBalance: 0 });
    }
    const [uidA,uidB] = uids as [string,string,string];
    await reset();
    await t.test("auth and tenant denial do not disclose event existence; forged fields rejected", async () => {
      await rejects(anonymous.call(payload), "unauthenticated");
      await rejects(other.call(payload), "permission-denied", "MEMBERSHIP_CONFLICT");
      await rejects(other.call({ ...payload, eventId: "missing" }), "permission-denied");
      await rejects(a.call({ ...payload, userId: uidB, attendeeCount: 100 }), "invalid-argument");
      const { user } = await createUserWithEmailAndPassword(password.auth, `${stamp}@password.test`, "synthetic-password");
      createdUsers.push(user.uid); await adminAuth.getAuth(app).updateUser(user.uid, { emailVerified: true }); await user.getIdToken(true);
      await db.doc(`users/${user.uid}`).set({ companyId, role: "member" });
      await rejects(password.call(payload), "permission-denied", "PROVIDER_NOT_ALLOWED");
      assert.equal((await ref.get()).get("attendeeCount"), 0);
    });
    await t.test("join/cancel/rejoin and concurrent same-user replay preserve snapshots and count", async () => {
      const first = (await a.call(payload)).data;
      assert.deepEqual(first, { contractVersion: 1, eventId, status: "going", attendeeCount: 1 });
      const rsvp = ref.collection("rsvps").doc(uidA);
      const original = (await rsvp.get()).data()!;
      assert.equal(original.userId, uidA); assert.equal(original.userName, "Member 0");
      assert.equal(original.userAvatarId, "avatar"); assert.equal(original.userDepartment, "Engineering");
      assert.ok(original.eventStartTime.isEqual(startTime)); assert.ok(original.createdAt instanceof adminFirestore.Timestamp);
      assert.equal(original.checkedIn, false); assert.equal(original.checkedInAt, null);
      await Promise.all(Array.from({ length: 4 }, () => a.call(payload)));
      assert.equal((await ref.get()).get("attendeeCount"), 1);
      await a.call({ ...payload, status: "cancelled" }); await a.call({ ...payload, status: "cancelled" });
      assert.equal((await ref.get()).get("attendeeCount"), 0);
      assert.equal((await rsvp.get()).get("status"), "cancelled");
      await a.call(payload); assert.deepEqual((await rsvp.get()).data(), original);
      assert.equal((await db.doc(`users/${uidA}`).get()).get("pointsBalance"), 0);
    });
    await t.test("real Firestore last-seat race admits one; concurrent cancels never underflow", async () => {
      await reset({ capacity: 1 });
      const results = await Promise.allSettled([a.call(payload), b.call(payload)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
      assert.equal(failure.reason.code, "functions/resource-exhausted"); assert.equal(failure.reason.details.reason, "EVENT_FULL");
      const going = await ref.collection("rsvps").where("status", "==", "going").get();
      assert.equal(going.size, 1); assert.equal((await ref.get()).get("attendeeCount"), 1);
      const winner = going.docs[0]!.id === uidA ? a : b;
      await Promise.all(Array.from({ length: 4 }, () => winner.call({ ...payload, status: "cancelled" })));
      assert.equal((await ref.get()).get("attendeeCount"), 0);
    });
    await t.test("closed/past/full events map errors and exact replays remain safe", async () => {
      await reset({ capacity: 1, attendeeCount: 1 }); await rejects(a.call(payload), "resource-exhausted", "EVENT_FULL");
      await reset({ status: "cancelled" }); await rejects(a.call(payload), "failed-precondition", "EVENT_CLOSED");
      await reset(); await a.call(payload);
      await ref.update({ startTime: adminFirestore.Timestamp.fromMillis(Date.now() - 1000) });
      await a.call(payload); await rejects(a.call({ ...payload, status: "cancelled" }), "failed-precondition", "EVENT_CLOSED");
      await rejects(b.call(payload), "failed-precondition", "EVENT_CLOSED");
      await rejects(a.call({ ...payload, eventId: "missing" }), "not-found");
    });
    await t.test("current rules deny client RSVP/count/attendance writes and cross-company reads", async () => {
      const target = doc(a.firestore, ref.path);
      const denied = (promise: Promise<unknown>) => assert.rejects(promise, (error: any) => error.code === "permission-denied");
      await denied(updateDoc(target, { attendeeCount: 100 }));
      await denied(setDoc(doc(a.firestore, `${ref.path}/rsvps/${uidA}`), { companyId, userId: uidA, status: "going", checkedIn: true }));
      await denied(updateDoc(doc(a.firestore, `${ref.path}/rsvps/${uidA}`), { checkedIn: true }));
      await denied(getDoc(doc(other.firestore, ref.path)));
    });
  } finally {
    await Promise.all(clients.map(client => deleteApp(client.app)));
    await db.recursiveDelete(ref);
    for (const uid of createdUsers) { await db.doc(`users/${uid}`).delete(); await adminAuth.getAuth(app).deleteUser(uid); }
    await adminApp.deleteApp(app);
  }
});
