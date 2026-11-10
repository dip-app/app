import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential, signOut, type Auth } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

// Run: npm run test:challenges:integration
//   (firebase emulators:exec --project demo-dip --only auth,functions,firestore
//    "node --import tsx --test --test-concurrency=1 gcp/tests/integration/challenges*.test.ts")
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
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const app = adminApp.initializeApp({ projectId }, "challenge-tests");
const db = adminFirestore.getFirestore(app);

async function googleSignIn(auth: Auth, email: string, name: string) {
  await signOut(auth);
  const idToken = JSON.stringify({ sub: `google-${email}`, email, email_verified: true, name });
  return (await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))).user;
}
async function rejects(p: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(p, (e: any) => { assert.equal(e.code, `functions/${code}`); if (reason) assert.equal(e.details?.reason, reason); return true; });
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
/** A 7-day window starting `weeks` weeks after a whole-second base far enough ahead to stay in the future. */
const base = Math.floor((Date.now() + 2 * DAY) / 1000) * 1000;
const week = (weeks: number) => ({ startDate: iso(base + weeks * 7 * DAY), endDate: iso(base + (weeks + 1) * 7 * DAY - 1000) });
type Challenge = { id: string; companyId: string; participantCount: number; completedCount: number; revision: number; createdBy: string; startDate: string; endDate: string; title: string; pointsReward: number };
type CreateResponse = { contractVersion: number; challengeId: string; revision: number; replayed: boolean; challenge: Challenge };
type UpdateResponse = { contractVersion: number; challengeId: string; revision: number; challenge: Challenge };

test("challenge callables enforce authorization, idempotency, revisions, ownership and overlap against the emulator", async () => {
  const client = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, "challenge-client");
  const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const functions = getFunctions(client, "us-central1");
  const [hostname, port] = functionsHost.split(":");
  connectFunctionsEmulator(functions, hostname, Number(port));
  const resolve = httpsCallable(functions, "resolveMembershipV1");
  const create = httpsCallable(functions, "createChallengeV1");
  const update = httpsCallable(functions, "updateChallengeV1");
  const stamp = Date.now();
  const companyA = `ch-alpha-${stamp}`;
  const companyB = `ch-beta-${stamp}`;
  const draft = (overrides: Record<string, unknown> = {}) => ({
    title: "Fitness", description: "Get moving with coworkers this week.", tagIds: ["ch-tag-fitness"], type: "weekly",
    goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness", ...week(0), pointsReward: 50, ...overrides,
  });
  const request = (companyId: string, d = draft(), requestId: string = crypto.randomUUID()) => ({ contractVersion: 1, companyId, requestId, draft: d });
  try {
    await db.collection("companies").doc(companyA).set({ name: "Alpha", emailDomain: `ch-alpha-${stamp}.test` });
    await db.collection("companies").doc(companyB).set({ name: "Beta", emailDomain: `ch-beta-${stamp}.test` });
    await db.collection("tags").doc("ch-tag-fitness").set({ name: "Fitness", icon: "x", sortOrder: 1 });

    // Signed out.
    await signOut(auth);
    await rejects(create(request(companyA)), "unauthenticated", "UNAUTHENTICATED");

    // An ordinary member cannot create.
    await googleSignIn(auth, `member-${stamp}@ch-alpha-${stamp}.test`, "Ordinary Member");
    await resolve({ contractVersion: 1 });
    await rejects(create(request(companyA)), "permission-denied", "NOT_ORGANIZER");

    // Organizer of company A (manual, server-side role assignment).
    const organizer = await googleSignIn(auth, `admin-${stamp}@ch-alpha-${stamp}.test`, "Alex Organizer");
    await resolve({ contractVersion: 1 });
    await db.collection("users").doc(organizer.uid).update({ role: "admin" });

    // Tenant isolation: a supplied companyId never authorizes.
    await rejects(create(request(companyB)), "permission-denied", "COMPANY_MISMATCH");

    // Validation: unknown keys, server-owned counts, catalog URL policy, span, tags.
    await assert.rejects(create(request(companyA, { ...draft(), participantCount: 9 })), (e: any) => {
      assert.equal(e.code, "functions/invalid-argument"); assert.deepEqual(e.details.fields, ["draft.participantCount"]); return true;
    });
    await assert.rejects(create({ ...request(companyA), extra: true }), (e: any) => e.code === "functions/invalid-argument");
    for (const url of ["https://example.com/gym.jpg", "catalog://default/fitness"]) {
      await assert.rejects(create(request(companyA, draft({ coverImageURL: url }))), (e: any) => {
        assert.equal(e.details.reason, "VALIDATION_FAILED"); assert.deepEqual(e.details.fields, ["coverImageURL"]); return true;
      });
    }
    await rejects(create(request(companyA, draft({ endDate: iso(base + 15 * DAY) }))), "invalid-argument", "VALIDATION_FAILED");
    await rejects(create(request(companyA, draft({ tagIds: ["ch-tag-missing"] }))), "invalid-argument", "TAG_NOT_FOUND");

    // Create: server assigns company, author, counts, timestamps and revision.
    const requestId = crypto.randomUUID();
    const first = draft();
    const created = (await create(request(companyA, first, requestId))).data as CreateResponse;
    assert.equal(created.contractVersion, 1);
    assert.equal(created.revision, 1);
    assert.equal(created.replayed, false);
    assert.equal(created.challenge.id, created.challengeId);
    assert.deepEqual(
      { companyId: created.challenge.companyId, createdBy: created.challenge.createdBy, participantCount: created.challenge.participantCount, completedCount: created.challenge.completedCount, startDate: created.challenge.startDate },
      { companyId: companyA, createdBy: organizer.uid, participantCount: 0, completedCount: 0, startDate: first.startDate });
    const ref = db.collection("companies").doc(companyA).collection("challenges").doc(created.challengeId);
    const stored = (await ref.get()).data()!;
    assert.ok(stored.startDate instanceof adminFirestore.Timestamp);
    assert.ok(stored.createdAt instanceof adminFirestore.Timestamp);
    assert.equal(stored.revision, 1);
    assert.equal(stored.type, "weekly");

    // Replay returns the same challenge; reuse with another draft fails.
    const replay = (await create(request(companyA, first, requestId))).data as CreateResponse;
    assert.deepEqual(replay, { ...created, replayed: true });
    await rejects(create(request(companyA, { ...first, pointsReward: 60 }, requestId)), "invalid-argument", "REQUEST_REUSED");

    // Simultaneous replays create exactly one challenge.
    const racing = crypto.randomUUID();
    const racingDraft = draft({ ...week(2), title: "Racing" });
    const results = await Promise.all(Array.from({ length: 5 }, () => create(request(companyA, racingDraft, racing))));
    assert.equal(new Set(results.map((r) => (r.data as CreateResponse).challengeId)).size, 1);
    assert.equal((await db.collection("companies").doc(companyA).collection("challenges").where("title", "==", "Racing").get()).size, 1);

    // Overlap: one current weekly theme per company, with the conflicting week in details.
    await assert.rejects(create(request(companyA, draft({ startDate: iso(base + 3 * DAY), endDate: iso(base + 10 * DAY) }))), (e: any) => {
      assert.equal(e.code, "functions/failed-precondition");
      assert.equal(e.details.reason, "CHALLENGE_WINDOW_OVERLAP");
      assert.deepEqual(e.details.conflict, { challengeId: created.challengeId, ...week(0) });
      return true;
    });
    // Concurrent creates of overlapping windows with different request IDs: at most one wins.
    const contested = await Promise.allSettled(Array.from({ length: 3 }, () => create(request(companyA, draft(week(4))))));
    assert.equal(contested.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of contested) if (r.status === "rejected") assert.equal((r.reason as any).details?.reason, "CHALLENGE_WINDOW_OVERLAP");
    // The adjacent week is free.
    const next = (await create(request(companyA, draft(week(1))))).data as CreateResponse;
    assert.equal(next.revision, 1);

    // Update: revision increments; stale expectedRevision is aborted and overwrites nothing.
    const edit = (expectedRevision: number, d = draft(), companyId = companyA, challengeId = created.challengeId) =>
      ({ contractVersion: 1, companyId, challengeId, expectedRevision, draft: d });
    const renamed = (await update(edit(1, draft({ title: "Fitness week" })))).data as UpdateResponse;
    assert.equal(renamed.revision, 2);
    assert.equal(renamed.challenge.title, "Fitness week");
    await rejects(update(edit(1, draft({ title: "Stale" }))), "aborted", "REVISION_CONFLICT");
    assert.equal((await ref.get()).get("title"), "Fitness week");

    // Updates may not overlap another theme, and cannot touch counts.
    await rejects(update(edit(2, draft(week(1)))), "failed-precondition", "CHALLENGE_WINDOW_OVERLAP");
    await rejects(update(edit(2, { ...draft(), completedCount: 0 })), "invalid-argument", "VALIDATION_FAILED");

    // Field ownership: server-maintained counts survive an update; with participants the start is locked.
    await ref.update({ participantCount: 7, completedCount: 2 });
    const kept = (await update(edit(2, draft({ title: "Fitness week", pointsReward: 75 })))).data as UpdateResponse;
    assert.deepEqual([kept.challenge.participantCount, kept.challenge.completedCount, kept.revision], [7, 2, 3]);
    await rejects(update(edit(3, draft({ startDate: iso(base + DAY) }))), "failed-precondition", "WINDOW_CHANGE_BLOCKED");

    // Other-company organizers and members cannot update; unknown challenges are not found.
    await rejects(update(edit(3, draft(), companyB)), "permission-denied", "COMPANY_MISMATCH");
    await rejects(update(edit(3, draft(), companyA, "missing")), "not-found", "CHALLENGE_NOT_FOUND");
    await googleSignIn(auth, `member-${stamp}@ch-alpha-${stamp}.test`, "Ordinary Member");
    await rejects(update(edit(3)), "permission-denied", "NOT_ORGANIZER");

    // The receipt is private server data with a challenge-specific key.
    const receipt = await db.collection("companies").doc(companyA).collection("commandReceipts").doc(`challenge_${organizer.uid}_${requestId}`).get();
    assert.equal(receipt.get("kind"), "challenge");
    assert.equal(receipt.get("challengeId"), created.challengeId);
  } finally {
    await signOut(auth);
  }
});
