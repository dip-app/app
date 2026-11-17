import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, updateDoc } from "firebase/firestore";
import { FirestoreTagStatsStore } from "../../functions/src/modules/tags/infrastructure/firestoreTagStats";

// Run with: npm run test:tags:integration. Exercises the onUserInterestsWritten trigger against the emulators.
const projectId = "demo-dip";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
for (const host of [authHost, firestoreHost]) {
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)) throw new Error("Requires local emulators.");
}
if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) throw new Error("Requires demo-dip.");
const req = createRequire(require.resolve("../../functions/package.json"));
const adminApp = req("firebase-admin/app") as typeof import("firebase-admin/app");
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(value)})`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("interest tag counts follow every writer of users/{uid}", { timeout: 300_000 }, async (t) => {
  const stamp = `tags-${Date.now()}`;
  const app = adminApp.initializeApp({ projectId }, stamp);
  const db = adminFirestore.getFirestore(app);
  const companyId = `${stamp}-alpha`;
  const bulkCompany = `${stamp}-bulk`;
  const [cook, run, chess] = [`${stamp}-cook`, `${stamp}-run`, `${stamp}-chess`] as const;
  for (const [index, id] of [cook, run, chess].entries()) await db.doc(`tags/${id}`).set({ name: `Tag ${index}`, icon: "star", sortOrder: index });

  const count = async (company: string, tagId: string) => {
    const snapshot = await db.doc(`companies/${company}/tagStats/${tagId}`).get();
    const value: unknown = snapshot.get("memberCount");
    return typeof value === "number" ? value : 0;
  };
  const expectCount = (company: string, tagId: string, expected: number) =>
    eventually(() => count(company, tagId), (value) => value === expected, `${tagId} == ${expected}`);
  const profile = (company: string, extra: Record<string, unknown> = {}) => ({
    companyId: company, displayName: "Synthetic Member", email: `${stamp}@synthetic.test`, photoURL: "", avatarId: "avatar-1",
    department: "Engineering", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20, availability: [],
    friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: adminFirestore.Timestamp.now(), ...extra,
  });

  const client = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, `${stamp}-client`);
  const auth = getAuth(client); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const firestore = getFirestore(client);
  const [fsHost, fsPort] = firestoreHost!.split(":"); connectFirestoreEmulator(firestore, fsHost!, Number(fsPort));
  const email = `${stamp}@synthetic.test`;
  const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: "Member" })));
  const memberRef = db.doc(`users/${user.uid}`);
  await memberRef.set(profile(companyId));
  const clientWrite = (interestTagIds: string[]) => updateDoc(doc(firestore, `users/${user.uid}`), { interestTagIds });

  await t.test("a member's own client write increments; replace and remove decrement", async () => {
    await clientWrite([cook]);
    await expectCount(companyId, cook, 1);
    await clientWrite([run]);
    await expectCount(companyId, cook, 0);
    await expectCount(companyId, run, 1);
    await clientWrite([]);
    await expectCount(companyId, run, 0);
  });

  await t.test("an unknown tag never creates a stat doc", async () => {
    await clientWrite([`${stamp}-ghost`, cook]);
    await expectCount(companyId, cook, 1);
    assert.equal((await db.doc(`companies/${companyId}/tagStats/${stamp}-ghost`).get()).exists, false);
    await clientWrite([]);
    await expectCount(companyId, cook, 0);
  });

  await t.test("admin writes (updateMemberV1 and resetMemberProfileV1 shapes) adjust counts", async () => {
    await memberRef.update({ interestTagIds: [cook, chess], department: "Ops", revision: 1 });
    await expectCount(companyId, cook, 1);
    await expectCount(companyId, chess, 1);
    await memberRef.update({ interestTagIds: [], jobTitle: "", city: "", revision: 2 });
    await expectCount(companyId, cook, 0);
    await expectCount(companyId, chess, 0);
  });

  await t.test("deactivation removes the member from the counts and reactivation restores them", async () => {
    await memberRef.update({ interestTagIds: [cook, run] });
    await expectCount(companyId, cook, 1);
    await memberRef.update({ status: "deactivated" });
    await expectCount(companyId, cook, 0);
    await expectCount(companyId, run, 0);
    await memberRef.update({ status: "active" });
    await expectCount(companyId, cook, 1);
    await expectCount(companyId, run, 1);
  });

  await t.test("deleting the user document decrements", async () => {
    await memberRef.delete();
    await expectCount(companyId, cook, 0);
    await expectCount(companyId, run, 0);
  });

  await t.test("15 users adding the same tag concurrently end at exactly 15", async () => {
    const refs = Array.from({ length: 15 }, (_, i) => db.doc(`users/${stamp}-bulk-${i}`));
    await Promise.all(refs.map((ref) => ref.set(profile(bulkCompany))));
    await Promise.all(refs.map((ref) => ref.update({ interestTagIds: [cook] })));
    await expectCount(bulkCompany, cook, 15);
    await sleep(1500);
    assert.equal(await count(bulkCompany, cook), 15);
  });

  t.after(async () => { await deleteApp(client); await adminApp.deleteApp(app); });

  await t.test("replaying a receipt id is a duplicate and does not change counts", async () => {
    const store = new FirestoreTagStatsStore(db);
    const replayCompany = `${stamp}-replay`;
    const deltas = new Map([[replayCompany, new Map([[cook, 1], [run, -1]])]]);
    assert.equal(await store.applyDeltas("replay-1", replayCompany, deltas), "applied");
    assert.equal(await store.applyDeltas("replay-1", replayCompany, deltas), "duplicate");
    assert.equal(await count(replayCompany, cook), 1);
    assert.equal(await count(replayCompany, run), -1);
    const receipt = (await db.doc(`companies/${replayCompany}/tagStatReceipts/replay-1`).get()).data()!;
    assert.ok(receipt.expireAt.toMillis() > Date.now() + 6 * 86_400_000);
    assert.deepEqual((await store.listStats(replayCompany)).map((s) => s.memberCount).sort(), [-1, 1]);
  });
});
