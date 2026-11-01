import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { joinCodeLookupId } from "../../functions/src/modules/accounts/domain/joinCode";
import { FirestoreJoinRateLimiter } from "../../functions/src/modules/accounts/infrastructure/firestoreJoinRateLimiter";

// Run: firebase emulators:exec --project demo-dip --only auth,functions,firestore
//   "node --import tsx --test --test-concurrency=1 gcp/tests/integration/accounts*.test.ts"
const projectId = "demo-dip";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
for (const host of [authHost, firestoreHost, functionsHost]) {
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)) throw new Error("Requires local demo emulators.");
}
if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) throw new Error("Requires project demo-dip.");
const req = createRequire(require.resolve("../../functions/package.json"));
const adminApp = req("firebase-admin/app") as typeof import("firebase-admin/app");
const adminAuth = req("firebase-admin/auth") as typeof import("firebase-admin/auth");
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const app = adminApp.initializeApp({ projectId }, "callable-tests");
const db = adminFirestore.getFirestore(app);
const payload = { contractVersion: 1, joinCode: "  team-alpha  ", displayName: "Person" };
async function rejects(p: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(p, (e: any) => { assert.equal(e.code, `functions/${code}`); if (reason) assert.equal(e.details.reason, reason); return true; });
}

test("real callable verifies refreshed Auth tokens, creates/replays membership and limits all attempts", async () => {
  const client = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, "callable-client");
  const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const functions = getFunctions(client, "us-central1");
  const [functionsHostname, functionsPort] = functionsHost.split(":");
  connectFunctionsEmulator(functions, functionsHostname, Number(functionsPort));
  const join = httpsCallable(functions, "joinCompanyV1");
  try {
    await db.collection("companies").doc("callable-alpha").set({ name: "Alpha" });
    await db.collection("companies").doc("callable-beta").set({ name: "Beta" });
    await db.collection("companyAccess").doc(joinCodeLookupId("TEAM-ALPHA")).set({ companyId: "callable-alpha" });
    await db.collection("companyAccess").doc(joinCodeLookupId("TEAM-BETA")).set({ companyId: "callable-beta" });
    await rejects(join(payload), "unauthenticated");
    const { user } = await createUserWithEmailAndPassword(auth, `callable-${Date.now()}@example.invalid`, "synthetic-password");
    await rejects(join(payload), "permission-denied", "EMAIL_NOT_VERIFIED");
    assert.equal((await db.collection("accountRateLimits").doc(user.uid).get()).exists, false);
    await adminAuth.getAuth(app).updateUser(user.uid, { emailVerified: true });
    await user.reload();
    await user.getIdToken(true);
    await rejects(join({ ...payload, contractVersion: 2 }), "invalid-argument");
    assert.equal((await db.collection("accountRateLimits").doc(user.uid).get()).exists, false);
    const expected = { contractVersion: 1, companyId: "callable-alpha", role: "member" };
    assert.deepEqual((await join(payload)).data, expected);
    assert.deepEqual((await join(payload)).data, expected);
    const profile = (await db.collection("users").doc(user.uid).get()).data()!;
    assert.equal(profile.role, "member"); assert.equal(profile.pointsBalance, 0);
    assert.equal(profile.email, user.email); assert.equal(profile.travelRadiusMiles, 20);
    for (const key of ["photoURL", "avatarId", "department", "jobTitle", "city"]) assert.equal(profile[key], "");
    for (const key of ["interestTagIds", "availability", "friendIds", "favoritePhotoIds"]) assert.deepEqual(profile[key], []);
    assert.ok(profile.createdAt instanceof adminFirestore.Timestamp);
    await rejects(join({ ...payload, joinCode: "TEAM-BETA" }), "failed-precondition", "MEMBERSHIP_CONFLICT");
    await rejects(join({ ...payload, joinCode: "WRONG-CODE" }), "not-found", "INVALID_JOIN_CODE");
    await rejects(join({ ...payload, joinCode: "ALSO-WRONG" }), "not-found", "INVALID_JOIN_CODE");
    await rejects(join(payload), "resource-exhausted", "RATE_LIMITED");
    assert.equal((await db.collection("accountRateLimits").doc(user.uid).get()).get("attempts"), 5);
    // An empty fixed window admits at most five concurrent wrong-code requests.
    await db.collection("accountRateLimits").doc(user.uid).delete();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => join({ ...payload, joinCode: "WRONG-CODE" })));
    const codes = results.map((r: any) => r.reason?.code);
    assert.equal(codes.filter((c) => c === "functions/not-found").length, 5);
    assert.equal(codes.filter((c) => c === "functions/resource-exhausted").length, 5);
  } finally { await deleteApp(client); await adminApp.deleteApp(app); }
});

test("limiter uses injected server clock, bounded records and atomic concurrent increments", async () => {
  const clockApp = adminApp.initializeApp({ projectId }, "limiter-clock");
  const clockDb = adminFirestore.getFirestore(clockApp);
  let now = 120_001;
  const limiter = new FirestoreJoinRateLimiter(clockDb, () => now);
  const uid = `clock-${Date.now()}`;
  try {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => limiter.consume(uid)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
    const ref = clockDb.collection("accountRateLimits").doc(uid);
    assert.deepEqual(Object.keys((await ref.get()).data()!).sort(), ["attempts", "expiresAt", "windowStart"]);
    now = 180_000;
    await limiter.consume(uid);
    assert.equal((await ref.get()).get("attempts"), 1);
    assert.equal((await ref.get()).get("expiresAt").toMillis(), 240_000);
  } finally { await adminApp.deleteApp(clockApp); }
});
