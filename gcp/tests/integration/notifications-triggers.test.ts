import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, orderBy, limit, getDocs } from "firebase/firestore";

// Run with: npm run test:notifications:integration. The emulator never contacts FCM: pushes are recorded in
// the server-only `emulatorPushOutbox` collection (EmulatorOutboxMessaging).
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
const { createHash } = req("node:crypto") as typeof import("node:crypto");
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const denied = (promise: Promise<unknown>) => assert.rejects(promise, (error: any) => error.code === "permission-denied");

test("chat push, change history, default subscriptions and device registry against the emulators", { timeout: 300_000 }, async (t) => {
  const stamp = `notify-${Date.now()}`;
  const app = adminApp.initializeApp({ projectId }, stamp);
  const db = adminFirestore.getFirestore(app);
  const companyId = `${stamp}-alpha`;
  const eventRef = db.doc(`companies/${companyId}/events/run`);
  const createdUsers: string[] = [];
  const clients = Array.from({ length: 4 }, (_, i) => {
    const client = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, `${stamp}-${i}`);
    const auth = getAuth(client); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(client, "us-central1");
    const [fnHost, fnPort] = functionsHost.split(":"); connectFunctionsEmulator(functions, fnHost!, Number(fnPort));
    const firestore = getFirestore(client);
    const [fsHost, fsPort] = firestoreHost!.split(":"); connectFirestoreEmulator(firestore, fsHost!, Number(fsPort));
    const call = (name: string) => httpsCallable(functions, name);
    return { app: client, auth, firestore, call };
  });
  const [a, b, organizer, outsider] = clients as [typeof clients[number], typeof clients[number], typeof clients[number], typeof clients[number]];
  const tokens = { a: `integration-token-a-${stamp}`, b: `integration-token-b-${stamp}`, bStale: `invalid-token-b-${stamp}` };
  const outbox = (type: string) => db.collection("emulatorPushOutbox").where("data.eventId", "==", "run")
    .where("data.companyId", "==", companyId).where("data.type", "==", type).get();
  try {
    const uids: string[] = [];
    for (const [index, client] of [a, b, organizer, outsider].entries()) {
      const email = `${stamp}-${index}@synthetic.test`;
      const { user } = await signInWithCredential(client.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: `Member ${index}` })));
      createdUsers.push(user.uid); uids.push(user.uid);
      await db.doc(`users/${user.uid}`).set({ companyId: index === 3 ? `${stamp}-beta` : companyId, role: index === 2 ? "admin" : "member",
        displayName: `Member ${index}`, avatarId: `avatar-${index}`, department: "Engineering", pointsBalance: 0 });
    }
    const [uidA, uidB, uidOrganizer] = uids as [string, string, string, string];
    const start = adminFirestore.Timestamp.fromMillis(Date.now() + 3 * 86_400_000);
    const end = adminFirestore.Timestamp.fromMillis(start.toMillis() + 3_600_000);
    await eventRef.set({ companyId, title: "Sunset run", description: "Easy pace", tagIds: [], coverImageURL: "catalog://default/outdoors",
      startTime: start, endTime: end, venue: { name: "Park", address: "1 Main", locality: "PGH", latitude: 40, longitude: -80 },
      costCents: 0, costNote: "", capacity: 10, pointsValue: 0, isOutdoor: true, status: "scheduled", attendeeCount: 0,
      createdBy: uidOrganizer, createdAt: adminFirestore.Timestamp.now(), revision: 1 });

    await t.test("device registry: auth/membership denial, idempotent register, direct access denied", async () => {
      const register = (client: typeof a, token: string) => client.call("registerDeviceV1")({ contractVersion: 1, token, platform: "ios", appVersion: "1.0 (1)" });
      // A signed-in user without a membership document is refused; a signed-out caller is unauthenticated.
      await db.doc(`users/${createdUsers[3]!}`).delete();
      await assert.rejects(register(outsider, `stranger-token-${stamp}`),
        (error: any) => error.code === "functions/permission-denied" && error.details.reason === "MEMBERSHIP_REQUIRED");
      await outsider.auth.signOut();
      await assert.rejects(register(outsider, `stranger-token-${stamp}`), (error: any) => error.code === "functions/unauthenticated");
      const result = (await register(a, tokens.a)).data as { deviceId: string };
      assert.deepEqual(result, { contractVersion: 1, deviceId: sha(tokens.a) });
      assert.deepEqual((await register(a, tokens.a)).data, result);
      await register(b, tokens.b); await register(b, tokens.bStale);
      const stored = (await db.doc(`users/${uidA}/devices/${sha(tokens.a)}`).get()).data()!;
      assert.deepEqual(Object.keys(stored).sort(), ["appVersion", "platform", "token", "tokenHash", "updatedAt"]);
      await assert.rejects(register(a, "bad"), (error: any) => error.code === "functions/invalid-argument");
      await denied(getDoc(doc(a.firestore, `users/${uidA}/devices/${sha(tokens.a)}`)));
      await denied(setDoc(doc(a.firestore, `users/${uidA}/devices/forged`), { token: "t", platform: "ios", appVersion: "1", updatedAt: serverTimestamp() }));
    });

    await t.test("joining creates the default `changes` subscription; the owner may raise it to `all`", async () => {
      await a.call("setRsvpV1")({ contractVersion: 1, companyId, eventId: "run", status: "going" });
      await b.call("setRsvpV1")({ contractVersion: 1, companyId, eventId: "run", status: "going" });
      for (const uid of [uidA, uidB]) {
        const sub = await eventually(() => db.doc(`${eventRef.path}/subscriptions/${uid}`).get(), (s) => s.exists, `default subscription ${uid}`);
        assert.equal(sub.get("level"), "changes");
      }
      await setDoc(doc(b.firestore, `${eventRef.path}/subscriptions/${uidB}`), { level: "all", updatedAt: serverTimestamp() });
      await denied(setDoc(doc(a.firestore, `${eventRef.path}/subscriptions/${uidB}`), { level: "none", updatedAt: serverTimestamp() }));
    });

    await t.test("a chat message pushes to `all` subscribers except the author and prunes invalid tokens", async () => {
      const messageId = `msg-${stamp}`;
      await setDoc(doc(a.firestore, `${eventRef.path}/messages/${messageId}`), { companyId, eventId: "run", authorId: uidA,
        authorName: "Member 0", authorAvatarId: "avatar-0", text: "Running five minutes late", createdAt: serverTimestamp() });
      await denied(setDoc(doc(a.firestore, `${eventRef.path}/messages/${messageId}`), { companyId, eventId: "run", authorId: uidA,
        authorName: "Member 0", authorAvatarId: "avatar-0", text: "duplicate", createdAt: serverTimestamp() }));
      await denied(setDoc(doc(outsider.firestore, `${eventRef.path}/messages/x-${messageId}`), { text: "hi" }));
      const pushes = await eventually(() => outbox("chat"), (s) => s.size >= 1, "chat push");
      assert.equal(pushes.size, 1);
      const push = pushes.docs[0]!.data();
      assert.deepEqual([...push.tokenHashes].sort(), [sha(tokens.b), sha(tokens.bStale)].sort());
      assert.equal(push.body, "Member 0: Running five minutes late");
      assert.equal(push.data.deepLink, "dip://events/run/chat");
      await eventually(() => db.doc(`users/${uidB}/devices/${sha(tokens.bStale)}`).get(), (s) => !s.exists, "invalid token cleanup");
      assert.equal((await db.doc(`users/${uidB}/devices/${sha(tokens.b)}`).get()).exists, true);
      const history = await getDocs(query(collection(b.firestore, `${eventRef.path}/messages`), orderBy("createdAt"), limit(50)));
      assert.deepEqual(history.docs.map((d) => d.id), [messageId]);
    });

    await t.test("an organizer edit appends one changeLog entry and pushes the change; clients cannot write changeLog", async () => {
      const draft = { title: "Sunrise run", description: "Easy pace", tagIds: [], coverImageURL: "catalog://default/outdoors",
        startTime: start.toDate().toISOString(), endTime: end.toDate().toISOString(),
        venue: { name: "Lake", address: "1 Main", locality: "PGH", latitude: 40, longitude: -80 },
        costCents: 0, costNote: "", capacity: 10, isOutdoor: true };
      const result = (await organizer.call("updateEventV1")({ contractVersion: 1, companyId, eventId: "run", expectedRevision: 1, event: draft, status: "scheduled" })).data;
      assert.deepEqual(result, { contractVersion: 1, eventId: "run", revision: 2 });
      const event = await eventually(() => eventRef.get(), (s) => Array.isArray(s.get("changeLog")) && s.get("changeLog").length > 0, "changeLog");
      assert.equal(event.get("updatedBy"), uidOrganizer);
      const [entry] = event.get("changeLog");
      assert.equal(entry.by, uidOrganizer); assert.equal(entry.revision, 2);
      assert.ok(entry.at instanceof adminFirestore.Timestamp);
      assert.deepEqual(entry.changes, [{ field: "title", from: "Sunset run", to: "Sunrise run" }, { field: "venue.name", from: "Park", to: "Lake" }]);
      const pushes = await eventually(() => outbox("event_changed"), (s) => s.size >= 1, "change push");
      assert.deepEqual([...pushes.docs[0]!.get("tokenHashes")].sort(), [sha(tokens.a), sha(tokens.b)].sort());
      assert.equal(pushes.docs[0]!.get("body"), "Updated: name, location.");
      // Counter/bookkeeping writes do not log; give the trigger time to (not) act, then recheck.
      await eventRef.update({ attendeeCount: adminFirestore.FieldValue.increment(0) });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      assert.equal((await eventRef.get()).get("changeLog").length, 1);
      assert.equal((await outbox("event_changed")).size, 1);
      await denied(updateDoc(doc(organizer.firestore, eventRef.path), { changeLog: [] }));
    });

    await t.test("leaving removes the subscription; unregister removes the device", async () => {
      await a.call("setRsvpV1")({ contractVersion: 1, companyId, eventId: "run", status: "cancelled" });
      await eventually(() => db.doc(`${eventRef.path}/subscriptions/${uidA}`).get(), (s) => !s.exists, "subscription removal");
      assert.deepEqual((await a.call("unregisterDeviceV1")({ contractVersion: 1, token: tokens.a })).data, { contractVersion: 1, removed: true });
      assert.equal((await db.doc(`users/${uidA}/devices/${sha(tokens.a)}`).get()).exists, false);
    });
  } finally {
    await Promise.all(clients.map((client) => deleteApp(client.app)));
    await db.recursiveDelete(eventRef);
    const pushes = await db.collection("emulatorPushOutbox").where("data.companyId", "==", companyId).get();
    for (const push of pushes.docs) await push.ref.delete();
    for (const uid of createdUsers) { await db.recursiveDelete(db.doc(`users/${uid}`)); await adminAuth.getAuth(app).deleteUser(uid).catch(() => undefined); }
    await adminApp.deleteApp(app);
  }
});
