import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";
import { pruneStaleDevices } from "../../functions/src/modules/notifications/application/pruneDevices";
import { FirestoreNotificationsStore } from "../../functions/src/modules/notifications/infrastructure/firestoreNotificationsStore";

// Emulator-only (Admin SDK, Firestore): the stale-token prune query with real collection-group semantics.
// Run: firebase emulators:exec --project demo-dip --only firestore "node --import tsx --test --test-concurrency=1 gcp/tests/integration/notifications-prune.test.ts"

const PROJECT = "demo-dip";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!["127.0.0.1:8080", "127.0.0.1:18080"].includes(HOST ?? "")) throw new Error("Expected a local test emulator.");
if ((process.env.GCLOUD_PROJECT ?? PROJECT) !== PROJECT) throw new Error(`Refusing to run outside project ${PROJECT}.`);
process.env.GCLOUD_PROJECT = PROJECT;

const functionsRequire = createRequire(require.resolve("../../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

const DAY = 86_400_000;
let app: ReturnType<typeof initializeApp>;
let db: ReturnType<typeof getFirestore>;

before(() => { app = initializeApp({ projectId: PROJECT }, `prune-${Date.now()}`); db = getFirestore(app); });
after(async () => { await deleteApp(app); });

describe("pruneStaleDevices on Firestore", () => {
  test("deletes tokens unseen for 61 days, keeps fresh ones and other collections named devices", async () => {
    const now = new Date();
    const ago = (days: number) => Timestamp.fromMillis(now.getTime() - days * DAY);
    const device = (uid: string, id: string, days: number) =>
      db.collection("users").doc(uid).collection("devices").doc(id).set({ token: `tok-${id}`, tokenHash: id, lastSeenAt: ago(days) });
    await device("prune-a", "stale1", 61);
    await device("prune-a", "fresh1", 1);
    await device("prune-b", "stale2", 90);
    // Same collection id elsewhere, also stale: must never be touched.
    await db.collection("companies").doc("c").collection("devices").doc("stale3").set({ lastSeenAt: ago(90) });
    await db.collection("users").doc("prune-a").collection("other").doc("x").collection("devices").doc("stale4").set({ lastSeenAt: ago(90) });

    const store = new FirestoreNotificationsStore(db);
    const result = await pruneStaleDevices({ stale: store, devices: store, clock: { now: () => now } }, { maxAgeDays: 60, pageSize: 2, maxPages: 5 });
    assert.equal(result.removed, 2);

    const exists = async (path: string) => (await db.doc(path).get()).exists;
    assert.equal(await exists("users/prune-a/devices/stale1"), false);
    assert.equal(await exists("users/prune-b/devices/stale2"), false);
    assert.equal(await exists("users/prune-a/devices/fresh1"), true);
    assert.equal(await exists("companies/c/devices/stale3"), true);
    assert.equal(await exists("users/prune-a/other/x/devices/stale4"), true);
  });
});
