import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, orderBy, limit, getDocs,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator, ref, uploadBytes, getBytes } from "firebase/storage";

// Run with: npm run test:photos:integration (finalizeEventPhotoV1 and onPhotoCommentCreated are exported
// from the functions root). Exercises the real client SDKs against storage.rules, firestore.rules and the callable.
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
const adminStorage = req("firebase-admin/storage") as typeof import("firebase-admin/storage");
const adminAuth = req("firebase-admin/auth") as typeof import("firebase-admin/auth");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
async function rejects(promise: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(promise, (error: any) => {
    // Storage codes carry their own prefix ("storage/..."), Firestore codes have none, callables use "functions/".
    assert.equal(error.code, code.includes("/") || code.startsWith("firestore:") ? code.replace("firestore:", "") : `functions/${code}`, String(error));
    if (reason) assert.equal(error.details?.reason, reason);
    return true;
  });
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("album upload, finalize, read and comment flow through the real SDKs and rules", { timeout: 180_000 }, async t => {
  const stamp = `photos-${Date.now()}`;
  const admin = adminApp.initializeApp({ projectId, storageBucket: bucket }, stamp);
  const db = adminFirestore.getFirestore(admin);
  const companyId = `${stamp}-alpha`;
  const otherCompany = `${stamp}-beta`;
  const eventId = "boat";
  const createdUsers: string[] = [];
  const clients = Array.from({ length: 4 }, (_, i) => {
    const app = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app", storageBucket: bucket }, `${stamp}-${i}`);
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(app, "us-central1");
    const [fnHost, fnPort] = functionsHost.split(":"); connectFunctionsEmulator(functions, fnHost!, Number(fnPort));
    const firestore = getFirestore(app);
    const [fsHost, fsPort] = firestoreHost!.split(":"); connectFirestoreEmulator(firestore, fsHost!, Number(fsPort));
    const storage = getStorage(app);
    const [stHost, stPort] = storageHost!.split(":"); connectStorageEmulator(storage, stHost!, Number(stPort));
    return { app, auth, firestore, storage, finalize: httpsCallable(functions, "finalizeEventPhotoV1") };
  });
  const [going, coworker, outsider, anonymous] = clients as [typeof clients[number], typeof clients[number], typeof clients[number], typeof clients[number]];
  try {
    const uids: string[] = [];
    for (const [index, client] of [going, coworker, outsider].entries()) {
      const email = `${stamp}-${index}@synthetic.test`;
      const token = JSON.stringify({ sub: email, email, email_verified: true, name: `Member ${index}` });
      const { user } = await signInWithCredential(client.auth, GoogleAuthProvider.credential(token));
      createdUsers.push(user.uid); uids.push(user.uid);
      await db.doc(`users/${user.uid}`).set({ companyId: index === 2 ? otherCompany : companyId, role: "member",
        displayName: `Member ${index}`, avatarId: `avatar-${index}`, department: "Engineering", pointsBalance: 0 });
    }
    const [uid, coworkerUid, outsiderUid] = uids as [string, string, string];
    const ended = adminFirestore.Timestamp.fromMillis(Date.now() - 3_600_000);
    await db.doc(`companies/${companyId}/events/${eventId}`).set({ companyId, title: "Boat Ride", status: "scheduled",
      startTime: adminFirestore.Timestamp.fromMillis(Date.now() - 7_200_000), endTime: ended, capacity: 10, attendeeCount: 1, revision: 1 });
    await db.doc(`companies/${companyId}/events/${eventId}/rsvps/${uid}`).set({ companyId, eventId, userId: uid, status: "going" });
    await db.doc(`companies/${companyId}/events/live`).set({ companyId, title: "Live", status: "scheduled",
      startTime: adminFirestore.Timestamp.fromMillis(Date.now() - 60_000), endTime: adminFirestore.Timestamp.fromMillis(Date.now() + 3_600_000) });
    await db.doc(`companies/${companyId}/events/live/rsvps/${uid}`).set({ companyId, eventId: "live", userId: uid, status: "going" });
    const objectPath = (owner: string, slot: number, e = eventId) => `companies/${companyId}/events/${e}/photos/${owner}/${slot}`;
    const payload = (slot: number, overrides: Record<string, unknown> = {}) => ({
      contractVersion: 1, companyId, eventId, photoId: `${uid}_${slot}`, storagePath: objectPath(uid, slot), caption: "", ...overrides,
    });

    await t.test("upload + finalize publishes the photo; replay is idempotent", async () => {
      await uploadBytes(ref(going.storage, objectPath(uid, 0)), JPEG, { contentType: "image/jpeg" });
      const first = await going.finalize(payload(0, { caption: "On the lake" }));
      assert.deepEqual(first.data, { contractVersion: 1, photoId: `${uid}_0`, created: true });
      const replay = await going.finalize(payload(0, { caption: "On the lake" }));
      assert.deepEqual(replay.data, { contractVersion: 1, photoId: `${uid}_0`, created: false });
      const stored = (await db.doc(`companies/${companyId}/events/${eventId}/photos/${uid}_0`).get()).data()!;
      assert.equal(stored.uploaderId, uid);
      assert.equal(stored.uploaderName, "Member 0");
      assert.equal(stored.downloadURL, "");
      assert.equal(stored.commentCount, 0);
      assert.equal(stored.sizeBytes, JPEG.length);
      assert.equal(stored.contentType, "image/jpeg");
      assert.ok(stored.createdAt instanceof adminFirestore.Timestamp);
    });

    await t.test("same-company members read the album and the bytes; other companies cannot", async () => {
      const album = query(collection(coworker.firestore, `companies/${companyId}/events/${eventId}/photos`), orderBy("createdAt", "desc"), limit(50));
      assert.equal((await getDocs(album)).size, 1);
      assert.deepEqual(new Uint8Array(await getBytes(ref(coworker.storage, objectPath(uid, 0)))), JPEG);
      await rejects(getBytes(ref(outsider.storage, objectPath(uid, 0))), "storage/unauthorized");
      // Uploaded but not finalized: only the uploader can read it.
      await uploadBytes(ref(going.storage, objectPath(uid, 9)), JPEG, { contentType: "image/jpeg" });
      assert.deepEqual(new Uint8Array(await getBytes(ref(going.storage, objectPath(uid, 9)))), JPEG);
      await rejects(getBytes(ref(coworker.storage, objectPath(uid, 9))), "storage/unauthorized");
      await rejects(getDocs(query(collection(outsider.firestore, `companies/${companyId}/events/${eventId}/photos`), limit(50))), "firestore:permission-denied");
    });

    await t.test("auth denial, tenant isolation and non-attendee denial", async () => {
      await rejects(anonymous.finalize(payload(1)), "unauthenticated");
      await rejects(outsider.finalize({ ...payload(1), photoId: `${outsiderUid}_1`, storagePath: objectPath(outsiderUid, 1) }), "permission-denied", "MEMBERSHIP_CONFLICT");
      await rejects(uploadBytes(ref(coworker.storage, objectPath(coworkerUid, 0)), JPEG, { contentType: "image/jpeg" }), "storage/unauthorized");
      await db.doc(`companies/${companyId}/events/${eventId}/rsvps/${coworkerUid}`).set({ companyId, eventId, userId: coworkerUid, status: "cancelled" });
      await rejects(coworker.finalize({ ...payload(1), photoId: `${coworkerUid}_1`, storagePath: objectPath(coworkerUid, 1) }), "permission-denied", "NOT_ATTENDEE");
      await rejects(uploadBytes(ref(outsider.storage, objectPath(outsiderUid, 0)), JPEG, { contentType: "image/jpeg" }), "storage/unauthorized");
    });

    await t.test("field ownership: another member's slot or forged fields are rejected", async () => {
      await rejects(going.finalize({ ...payload(1), photoId: `${coworkerUid}_1`, storagePath: objectPath(coworkerUid, 1) }), "invalid-argument", "VALIDATION_FAILED");
      await rejects(going.finalize(payload(1, { commentCount: 5 })), "invalid-argument", "VALIDATION_FAILED");
      await rejects(uploadBytes(ref(going.storage, objectPath(coworkerUid, 1)), JPEG, { contentType: "image/jpeg" }), "storage/unauthorized");
      await rejects(setDoc(doc(going.firestore, `companies/${companyId}/events/${eventId}/photos/${uid}_7`), { companyId }), "firestore:permission-denied");
      await rejects(updateDoc(doc(going.firestore, `companies/${companyId}/events/${eventId}/photos/${uid}_0`), { commentCount: 9 }), "firestore:permission-denied");
    });

    await t.test("missing, mislabeled and live-event uploads are refused; an invalid object is deleted", async () => {
      await rejects(going.finalize(payload(2)), "failed-precondition", "UPLOAD_NOT_FOUND");
      await uploadBytes(ref(going.storage, objectPath(uid, 3)), GIF, { contentType: "image/jpeg" });
      await rejects(going.finalize(payload(3)), "failed-precondition", "UPLOAD_INVALID");
      const [exists] = await adminStorage.getStorage(admin).bucket().file(objectPath(uid, 3)).exists();
      assert.equal(exists, false, "invalid object was removed, freeing the slot");
      await uploadBytes(ref(going.storage, objectPath(uid, 3)), JPEG, { contentType: "image/jpeg" });
      assert.equal(((await going.finalize(payload(3))).data as any).created, true);
      await rejects(uploadBytes(ref(going.storage, objectPath(uid, 0, "live")), JPEG, { contentType: "image/jpeg" }), "storage/unauthorized");
      await rejects(uploadBytes(ref(going.storage, objectPath(uid, 4)), new Uint8Array(10 * 1024 * 1024 + 1), { contentType: "image/jpeg" }), "storage/unauthorized");
    });

    await t.test("comments append through rules and the trigger keeps commentCount server-owned", async () => {
      const comments = `companies/${companyId}/events/${eventId}/photos/${uid}_0/comments`;
      const comment = (author: string, index: number) => ({ companyId, photoId: `${uid}_0`, authorId: author,
        authorName: `Member ${index}`, authorAvatarId: `avatar-${index}`, text: "Great day", createdAt: serverTimestamp() });
      await setDoc(doc(coworker.firestore, `${comments}/comment-${stamp}-a`), comment(coworkerUid, 1));
      await setDoc(doc(going.firestore, `${comments}/comment-${stamp}-b`), comment(uid, 0));
      // A retried write with the same ID is an update and is denied; it never duplicates.
      await rejects(setDoc(doc(going.firestore, `${comments}/comment-${stamp}-b`), comment(uid, 0)), "firestore:permission-denied");
      await rejects(setDoc(doc(outsider.firestore, `${comments}/comment-${stamp}-c`), { ...comment(outsiderUid, 2) }), "firestore:permission-denied");
      let count = 0;
      for (let attempt = 0; attempt < 40 && count !== 2; attempt++) {
        await sleep(250);
        count = (await getDoc(doc(going.firestore, `companies/${companyId}/events/${eventId}/photos/${uid}_0`))).get("commentCount");
      }
      assert.equal(count, 2);
    });
  } finally {
    await db.recursiveDelete(db.doc(`companies/${companyId}`));
    const files = adminStorage.getStorage(admin).bucket();
    await files.deleteFiles({ prefix: `companies/${companyId}/` }).catch(() => undefined);
    for (const user of createdUsers) {
      await db.doc(`users/${user}`).delete();
      await adminAuth.getAuth(admin).deleteUser(user).catch(() => undefined);
    }
    for (const client of clients) await deleteApp(client.app);
    await adminApp.deleteApp(admin);
  }
});
