import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithCredential, signOut, type Auth } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { FirestoreMembershipRateLimiter } from "../../functions/src/modules/accounts/infrastructure/firestoreMembershipRateLimiter";

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
const REQUEST = { contractVersion: 1 };
/**
 * The limiter uses fixed one-minute windows, so a burst that straddles a minute boundary
 * legitimately gets a fresh budget mid-burst. Budget assertions start early in a window.
 */
async function awaitFreshRateWindow(neededMs = 15_000) {
  const intoWindow = Date.now() % 60_000;
  if (intoWindow > 60_000 - neededMs) await new Promise((resolve) => setTimeout(resolve, 60_000 - intoWindow + 250));
}
/** Auth emulator accepts an unsigned Google ID token: sign in as a synthetic Google user. */
async function googleSignIn(auth: Auth, email: string, name: string, emailVerified = true) {
  await signOut(auth);
  const idToken = JSON.stringify({ sub: `google-${email}`, email, email_verified: emailVerified, name });
  return (await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))).user;
}
async function rejects(p: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(p, (e: any) => { assert.equal(e.code, `functions/${code}`); if (reason) assert.equal(e.details.reason, reason); return true; });
}

test("real callable verifies Google tokens, coerces domains, blocks personal domains and limits attempts", async () => {
  const client = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, "callable-client");
  const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const functions = getFunctions(client, "us-central1");
  const [functionsHostname, functionsPort] = functionsHost.split(":");
  connectFunctionsEmulator(functions, functionsHostname, Number(functionsPort));
  const resolve = httpsCallable(functions, "resolveMembershipV1");
  const stamp = Date.now();
  try {
    await db.collection("companies").doc("callable-alpha").set({ name: "Alpha" });
    await db.collection("companies").doc("callable-beta").set({ name: "Beta" });
    await db.collection("companyDomains").doc("callable-alpha.test").set({ companyId: "callable-alpha" });
    await db.collection("companyDomains").doc("callable-beta.test").set({ companyId: "callable-beta" });
    await rejects(resolve(REQUEST), "unauthenticated");

    // Email/password accounts are refused even when verified.
    const { user: passwordUser } = await createUserWithEmailAndPassword(auth, `pw-${stamp}@callable-alpha.test`, "synthetic-password");
    await adminAuth.getAuth(app).updateUser(passwordUser.uid, { emailVerified: true });
    await passwordUser.getIdToken(true);
    await rejects(resolve(REQUEST), "permission-denied", "PROVIDER_NOT_ALLOWED");

    await googleSignIn(auth, `p-${stamp}@gmail.com`, "Personal");
    await rejects(resolve(REQUEST), "permission-denied", "PERSONAL_EMAIL_DOMAIN");
    await googleSignIn(auth, `u-${stamp}@nowhere.test`, "Nobody");
    await rejects(resolve(REQUEST), "not-found", "NO_COMPANY_FOR_DOMAIN");

    await awaitFreshRateWindow();
    const user = await googleSignIn(auth, `m-${stamp}@eng.callable-alpha.test`, "Synthetic Member");
    assert.equal((await db.collection("accountRateLimits").doc(user.uid).get()).exists, false);
    await rejects(resolve({ contractVersion: 1, companyId: "callable-beta" }), "invalid-argument");
    const expected = { contractVersion: 1, companyId: "callable-alpha", role: "member" };
    assert.deepEqual((await resolve(REQUEST)).data, expected);
    assert.deepEqual((await resolve(REQUEST)).data, expected);
    const profile = (await db.collection("users").doc(user.uid).get()).data()!;
    assert.equal(profile.role, "member"); assert.equal(profile.pointsBalance, 0);
    assert.equal(profile.email, user.email); assert.equal(profile.displayName, "Synthetic Member");
    assert.equal(profile.travelRadiusMiles, 20);
    for (const key of ["photoURL", "avatarId", "department", "jobTitle", "city"]) assert.equal(profile[key], "");
    for (const key of ["interestTagIds", "availability", "friendIds", "favoritePhotoIds"]) assert.deepEqual(profile[key], []);
    assert.ok(profile.createdAt instanceof adminFirestore.Timestamp);
    // Two successes above count toward the budget; three more requests use it up.
    await resolve(REQUEST); await resolve(REQUEST); await resolve(REQUEST);
    await rejects(resolve(REQUEST), "resource-exhausted", "RATE_LIMITED");
    assert.equal((await db.collection("accountRateLimits").doc(user.uid).get()).get("attempts"), 5);
    // An empty fixed window admits at most five concurrent requests.
    await db.collection("accountRateLimits").doc(user.uid).delete();
    await awaitFreshRateWindow();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => resolve(REQUEST)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
    assert.equal(results.filter((r: any) => r.reason?.code === "functions/resource-exhausted").length, 5);
  } finally { await deleteApp(client); await adminApp.deleteApp(app); }
});

test("limiter uses injected server clock, bounded records and atomic concurrent increments", async () => {
  const clockApp = adminApp.initializeApp({ projectId }, "limiter-clock");
  const clockDb = adminFirestore.getFirestore(clockApp);
  let now = 120_001;
  const limiter = new FirestoreMembershipRateLimiter(clockDb, () => now);
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
