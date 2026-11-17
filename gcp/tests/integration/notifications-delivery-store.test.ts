import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { FirestoreDeliveryReceipts, FirestorePushRateLimiter } from "../../functions/src/modules/notifications/infrastructure/firestoreDelivery";
import { PUSH_RATE_LIMITS } from "../../functions/src/modules/notifications/domain/rateLimit";

// Emulator-backed test of the router's server-only stores (notificationReceipts, pushRateLimits).
// Run: firebase emulators:exec --project demo-dip --only firestore "node --import tsx --test --test-concurrency=1 gcp/tests/integration/notifications-delivery-store.test.ts"

const PROJECT = "demo-dip";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST)) throw new Error("Expected a local Firestore emulator.");
if ((process.env.GCLOUD_PROJECT ?? PROJECT) !== PROJECT) throw new Error(`Refusing to run outside project ${PROJECT}.`);
process.env.GCLOUD_PROJECT = PROJECT;

const functionsRequire = createRequire(require.resolve("../../functions/package.json"));
const { initializeApp, deleteApp, getApps } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

let app: ReturnType<typeof initializeApp>;
let db: ReturnType<typeof getFirestore>;
const now = new Date("2026-03-01T10:15:00Z");

before(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });
beforeEach(async () => {
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(response.ok, `emulator reset failed: ${response.status}`);
});

describe("FirestoreDeliveryReceipts", () => {
  test("10 parallel claims of one id yield exactly one winner, with an expiry", async () => {
    const receipts = new FirestoreDeliveryReceipts(db, () => now);
    const results = await Promise.all(Array.from({ length: 10 }, () => receipts.claim("event-e1-rev3")));
    assert.equal(results.filter(Boolean).length, 1);
    const doc = await db.doc(`notificationReceipts/${createHash("sha256").update("event-e1-rev3", "utf8").digest("hex")}`).get();
    assert.ok(doc.exists);
    assert.equal(doc.get("expireAt").toMillis(), now.getTime() + 30 * 24 * 3600 * 1000);
    assert.equal(await receipts.claim("event-e1-rev3"), false);
    assert.equal(await receipts.claim("another"), true);
  });

  test("two-phase: processing blocks until the lease expires, done never reopens, legacy receipts count as done", async () => {
    let clock = now;
    const receipts = new FirestoreDeliveryReceipts(db, () => clock);
    assert.equal(await receipts.claim("n1"), true);
    assert.equal(await receipts.isDone("n1"), false);
    clock = new Date(now.getTime() + 60_000);
    assert.equal(await receipts.claim("n1"), false);
    clock = new Date(now.getTime() + 6 * 60_000);
    assert.equal(await receipts.claim("n1"), true, "lease expired");
    await receipts.complete("n1");
    assert.equal(await receipts.isDone("n1"), true);
    clock = new Date(now.getTime() + 24 * 3600 * 1000);
    assert.equal(await receipts.claim("n1"), false);
    const legacyId = createHash("sha256").update("legacy", "utf8").digest("hex");
    await db.doc(`notificationReceipts/${legacyId}`).set({ createdAt: new Date(), expireAt: new Date(now.getTime() + 1000) });
    assert.equal(await receipts.isDone("legacy"), true);
    assert.equal(await receipts.claim("legacy"), false);
  });
});

describe("FirestorePushRateLimiter", () => {
  test("30 contending admits for one uid admit exactly the hourly cap", async () => {
    const limiter = new FirestorePushRateLimiter(db);
    // Three waves of 10 concurrent transactions on one document: real contention, but below the emulator's lock
    // timeout (30 at once intermittently failed with "ABORTED: Transaction lock timeout" in CI).
    const results: Set<string>[] = [];
    for (let wave = 0; wave < 3; wave++) {
      results.push(...await Promise.all(Array.from({ length: 10 }, () => limiter.admit(["u1"], now))));
    }
    assert.equal(results.filter((set) => set.has("u1")).length, PUSH_RATE_LIMITS.perHour);
    const doc = await db.doc("pushRateLimits/u1").get();
    assert.equal(doc.get("hourCount"), PUSH_RATE_LIMITS.perHour);
    assert.equal(doc.get("hourKey"), "2026-03-01T10");
    assert.equal(doc.get("expireAt").toMillis(), now.getTime() + 2 * 24 * 3600 * 1000);
  });

  test("users are independent and a new hour admits again", async () => {
    const limiter = new FirestorePushRateLimiter(db);
    for (let i = 0; i < PUSH_RATE_LIMITS.perHour; i++) await limiter.admit(["u1"], now);
    const blocked = await limiter.admit(["u1", "u2"], now);
    assert.deepEqual([...blocked], ["u2"]);
    const later = await limiter.admit(["u1"], new Date("2026-03-01T11:00:00Z"));
    assert.deepEqual([...later], ["u1"]);
  });

  test("a batch of many uids is admitted with bounded concurrency", async () => {
    const limiter = new FirestorePushRateLimiter(db);
    const uids = Array.from({ length: 60 }, (_, i) => `bulk${i}`);
    const allowed = await limiter.admit(uids, now);
    assert.equal(allowed.size, 60);
  });
});
