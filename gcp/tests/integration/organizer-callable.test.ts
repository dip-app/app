import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential, signOut, type Auth } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

// Run: firebase emulators:exec --project demo-dip --only auth,functions,firestore
//   "node --import tsx --test --test-concurrency=1 gcp/tests/integration/organizer*.test.ts"
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
const app = adminApp.initializeApp({ projectId }, "organizer-tests");
const db = adminFirestore.getFirestore(app);

async function googleSignIn(auth: Auth, email: string, name: string) {
  await signOut(auth);
  const idToken = JSON.stringify({ sub: `google-${email}`, email, email_verified: true, name });
  return (await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))).user;
}
async function rejects(p: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(p, (e: any) => { assert.equal(e.code, `functions/${code}`); if (reason) assert.equal(e.details?.reason, reason); return true; });
}
const draft = (overrides: Record<string, unknown> = {}) => ({
  title: "Integration trivia", description: "Teams of four.", tagIds: ["org-tag-games"], coverImageURL: "catalog://default/games",
  startTime: new Date(Date.now() + 7 * 86_400_000).toISOString(), endTime: new Date(Date.now() + 7 * 86_400_000 + 5_400_000).toISOString(),
  venue: { name: "Pub", address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.44, longitude: -79.99 },
  costCents: 500, costNote: "", capacity: 10, isOutdoor: false, ...overrides,
});

test("organizer callables enforce authorization, idempotency, revisions and capacity against the emulator", async () => {
  const client = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, "organizer-client");
  const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const functions = getFunctions(client, "us-central1");
  const [hostname, port] = functionsHost.split(":");
  connectFunctionsEmulator(functions, hostname, Number(port));
  const resolve = httpsCallable(functions, "resolveMembershipV1");
  const create = httpsCallable(functions, "createEventV1");
  const update = httpsCallable(functions, "updateEventV1");
  const stamp = Date.now();
  const companyA = `org-alpha-${stamp}`;
  const companyB = `org-beta-${stamp}`;
  try {
    await db.collection("companies").doc(companyA).set({ name: "Alpha", emailDomain: `org-alpha-${stamp}.test` });
    await db.collection("companies").doc(companyB).set({ name: "Beta", emailDomain: `org-beta-${stamp}.test` });
    await db.collection("tags").doc("org-tag-games").set({ name: "Games", icon: "x", sortOrder: 1 });

    const request = (companyId: string, event = draft(), requestId = crypto.randomUUID()) => ({ contractVersion: 1, companyId, requestId, event });

    // Signed out.
    await signOut(auth);
    await rejects(create(request(companyA)), "unauthenticated");

    // An ordinary member cannot create or update.
    const member = await googleSignIn(auth, `member-${stamp}@org-alpha-${stamp}.test`, "Ordinary Member");
    await resolve({ contractVersion: 1 });
    await rejects(create(request(companyA)), "permission-denied", "NOT_ORGANIZER");

    // Manual organizer assignment is a server-side admin action, never a client write.
    const organizer = await googleSignIn(auth, `admin-${stamp}@org-alpha-${stamp}.test`, "Alex Organizer");
    await resolve({ contractVersion: 1 });
    await db.collection("users").doc(organizer.uid).update({ role: "admin" });
    assert.notEqual(member.uid, organizer.uid);

    // An organizer of another company is refused, and a supplied companyId alone never authorizes.
    await rejects(create(request(companyB)), "permission-denied", "COMPANY_MISMATCH");

    // Validation failures report the fields.
    await assert.rejects(create(request(companyA, draft({ capacity: 0 }))), (e: any) => {
      assert.equal(e.code, "functions/invalid-argument"); assert.deepEqual(e.details.fields, ["capacity"]); return true;
    });
    await rejects(create(request(companyA, draft({ tagIds: ["org-tag-missing"] }))), "invalid-argument", "TAG_NOT_FOUND");
    await rejects(create(request(companyA, draft({ startTime: "2020-01-01T10:00:00Z", endTime: "2020-01-01T11:00:00Z" }))), "invalid-argument");

    // Create: server assigns company, author, counts, status and revision.
    const requestId = crypto.randomUUID();
    const firstDraft = draft(); // built once: a retry resends the identical payload
    const created = (await create(request(companyA, firstDraft, requestId))).data as { eventId: string; revision: number };
    assert.equal(created.revision, 1);
    const eventRef = db.collection("companies").doc(companyA).collection("events").doc(created.eventId);
    const stored = (await eventRef.get()).data()!;
    assert.deepEqual(
      { companyId: stored.companyId, createdBy: stored.createdBy, attendeeCount: stored.attendeeCount, pointsValue: stored.pointsValue, status: stored.status, revision: stored.revision },
      { companyId: companyA, createdBy: organizer.uid, attendeeCount: 0, pointsValue: 0, status: "scheduled", revision: 1 });
    assert.ok(stored.startTime instanceof adminFirestore.Timestamp);

    // A retry returns the same event; the same key with another payload fails.
    assert.deepEqual((await create(request(companyA, firstDraft, requestId))).data, created);
    await rejects(create(request(companyA, { ...firstDraft, capacity: 11 }, requestId)), "invalid-argument", "REQUEST_REUSED");

    // Simultaneous replays create exactly one event.
    const racing = crypto.randomUUID();
    const racingDraft = draft({ title: "Racing" });
    const results = await Promise.all(Array.from({ length: 5 }, () => create(request(companyA, racingDraft, racing))));
    assert.equal(new Set(results.map((r) => (r.data as { eventId: string }).eventId)).size, 1);
    const racingEvents = await db.collection("companies").doc(companyA).collection("events").where("title", "==", "Racing").get();
    assert.equal(racingEvents.size, 1);

    // Update: revision increments; a stale expectedRevision is aborted and overwrites nothing.
    const edit = (expectedRevision: number, event = draft(), status = "scheduled", companyId = companyA) =>
      ({ contractVersion: 1, companyId, eventId: created.eventId, expectedRevision, event, status });
    const startTime = (stored.startTime as import("firebase-admin/firestore").Timestamp).toDate().toISOString();
    const keep = { startTime, endTime: (stored.endTime as import("firebase-admin/firestore").Timestamp).toDate().toISOString() };
    assert.equal(((await update(edit(1, draft({ ...keep, title: "Renamed" })))).data as { revision: number }).revision, 2);
    await rejects(update(edit(1, draft({ ...keep, title: "Stale" }))), "aborted", "REVISION_CONFLICT");
    assert.equal((await eventRef.get()).get("title"), "Renamed");

    // Other-company organizers and members cannot update; unknown events are not found.
    await rejects(update(edit(2, draft(keep), "scheduled", companyB)), "permission-denied", "COMPANY_MISMATCH");
    await rejects(update({ ...edit(2, draft(keep)), eventId: "missing" }), "not-found", "EVENT_NOT_FOUND");
    await googleSignIn(auth, `member-${stamp}@org-alpha-${stamp}.test`, "Ordinary Member");
    await rejects(update(edit(2, draft(keep))), "permission-denied", "NOT_ORGANIZER");
    await googleSignIn(auth, `admin-${stamp}@org-alpha-${stamp}.test`, "Alex Organizer");

    // Capacity cannot fall below attendees; start time is locked while people are going.
    await eventRef.update({ attendeeCount: 8 });
    await rejects(update(edit(2, draft({ ...keep, capacity: 5 }))), "failed-precondition", "CAPACITY_BELOW_ATTENDEES");
    await rejects(update(edit(2, draft({ capacity: 10, startTime: new Date(Date.parse(startTime) + 86_400_000).toISOString(), endTime: new Date(Date.parse(keep.endTime) + 86_400_000).toISOString() }))), "failed-precondition", "TIME_CHANGE_BLOCKED");

    // Cancel and restore; nothing is ever deleted.
    assert.equal(((await update(edit(2, draft({ ...keep, capacity: 8 }), "cancelled"))).data as { revision: number }).revision, 3);
    assert.equal((await eventRef.get()).get("status"), "cancelled");
    assert.equal(((await update(edit(3, draft({ ...keep, capacity: 8 }), "scheduled"))).data as { revision: number }).revision, 4);
    assert.equal((await eventRef.get()).exists, true);

    // The deduplication receipt is private server data.
    const receipt = await db.collection("companies").doc(companyA).collection("commandReceipts").doc(`${organizer.uid}_${requestId}`).get();
    assert.equal(receipt.exists, true);
  } finally {
    await signOut(auth);
  }
});
