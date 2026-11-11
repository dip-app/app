import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, collection, getDocs, limit, query, where, doc, getDoc, setDoc } from "firebase/firestore";

// Run with: npm run test:invites:integration (sendInviteV1, respondToInviteV1 and listCoworkersV1 are exported from the functions root).
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
async function rejects(promise: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error.code, `functions/${code}`);
    if (reason) assert.equal(error.details?.reason, reason);
    return true;
  });
}

test("SDK callables: invite, accept through the RSVP path, decline, directory, rules and isolation", { timeout: 180_000 }, async (t) => {
  const stamp = `invites-${Date.now()}`;
  const admin = adminApp.initializeApp({ projectId }, stamp);
  const db = adminFirestore.getFirestore(admin);
  const companyId = `${stamp}-alpha`;
  const otherCompany = `${stamp}-beta`;
  const eventId = "event";
  const eventRef = db.doc(`companies/${companyId}/events/${eventId}`);
  const names = ["Sam Sender", "Fran Friend", "Olive Outsider", "Lee Late"];
  const clients = names.map((_, i) => {
    const app = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, `${stamp}-${i}`);
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(app, "us-central1");
    const [fnHost, fnPort] = functionsHost.split(":"); connectFunctionsEmulator(functions, fnHost!, Number(fnPort));
    const firestore = getFirestore(app);
    const [fsHost, fsPort] = firestoreHost!.split(":"); connectFirestoreEmulator(firestore, fsHost!, Number(fsPort));
    return {
      auth, firestore,
      send: httpsCallable(functions, "sendInviteV1"), respond: httpsCallable(functions, "respondToInviteV1"),
      search: httpsCallable(functions, "listCoworkersV1"),
    };
  });
  const [sender, friend, outsider, late] = clients as [typeof clients[number], typeof clients[number], typeof clients[number], typeof clients[number]];
  const uids: string[] = [];
  for (const [index, client] of clients.entries()) {
    const email = `${stamp}-${index}@synthetic.test`;
    const token = JSON.stringify({ sub: email, email, email_verified: true, name: names[index] });
    const { user } = await signInWithCredential(client.auth, GoogleAuthProvider.credential(token));
    uids.push(user.uid);
    await db.doc(`users/${user.uid}`).set({
      companyId: index === 2 ? otherCompany : companyId, role: "member", displayName: names[index], avatarId: `avatar-${index}`,
      department: "Operations", email, pointsBalance: 50,
    });
  }
  const [uidSender, uidFriend, uidOutsider, uidLate] = uids as [string, string, string, string];
  const seed = async (overrides = {}) => {
    await db.recursiveDelete(eventRef);
    await db.recursiveDelete(db.collection(`companies/${companyId}/invites`));
    await eventRef.set({
      companyId, title: "Pasta Night", status: "scheduled", capacity: 2, attendeeCount: 1,
      startTime: adminFirestore.Timestamp.fromMillis(Date.now() + 86_400_000), ...overrides,
    });
  };
  const payload = (toUserId: string, requestId = `${stamp}-request-1`) => ({ contractVersion: 1, companyId, eventId, toUserId, message: "Come along!", requestId });
  await seed();
  try {
    await t.test("directory returns the minimal projection for the caller's company only", async () => {
      const found = (await sender.search({ contractVersion: 1, companyId, eventId, query: "fra" })).data as any;
      assert.deepEqual(found.coworkers, [{ userId: uidFriend, displayName: "Fran Friend", avatarId: "avatar-1", department: "Operations", state: "available" }]);
      const none = (await sender.search({ contractVersion: 1, companyId, eventId, query: "oli" })).data as any;
      assert.deepEqual(none.coworkers, []);
      await rejects(sender.search({ contractVersion: 1, companyId, eventId, query: "f" }), "invalid-argument", "VALIDATION_FAILED");
      await rejects(outsider.search({ contractVersion: 1, companyId, eventId, query: "fr" }), "permission-denied", "MEMBERSHIP_CONFLICT");
    });
    await t.test("sending is idempotent, notifies the recipient and is tenant isolated", async () => {
      await rejects(outsider.send(payload(uidFriend)), "permission-denied", "MEMBERSHIP_CONFLICT");
      await rejects(sender.send(payload(uidOutsider)), "not-found", "RECIPIENT_NOT_FOUND");
      await rejects(sender.send(payload(uidSender)), "failed-precondition", "CANNOT_INVITE_SELF");
      await rejects(sender.send({ ...payload(uidFriend), fromUserId: uidLate }), "invalid-argument", "VALIDATION_FAILED");
      const first = (await sender.send(payload(uidFriend))).data as any;
      assert.deepEqual(first, { contractVersion: 1, inviteId: `${eventId}_${uidFriend}`, status: "pending", created: true });
      const replay = (await sender.send(payload(uidFriend))).data as any;
      assert.equal(replay.created, false);
      await rejects(sender.send(payload(uidFriend, `${stamp}-request-2`)), "failed-precondition", "ALREADY_INVITED");
      const invite = (await db.doc(`companies/${companyId}/invites/${first.inviteId}`).get()).data()!;
      assert.equal(invite.status, "pending"); assert.equal(invite.fromUserId, uidSender); assert.equal(invite.toUserName, "Fran Friend");
      const notice = (await db.doc(`users/${uidFriend}/notifications/invite_${first.inviteId}`).get()).data()!;
      assert.equal(notice.isRead, false); assert.equal(notice.targetId, first.inviteId);
      const listed = (await sender.search({ contractVersion: 1, companyId, eventId, query: "fra" })).data as any;
      assert.equal(listed.coworkers[0].state, "invited");
    });
    await t.test("rules: sender and recipient read the invite, nobody else, and nobody writes", async () => {
      const id = `${eventId}_${uidFriend}`;
      assert.equal((await getDoc(doc(friend.firestore, `companies/${companyId}/invites/${id}`))).exists(), true);
      assert.equal((await getDoc(doc(sender.firestore, `companies/${companyId}/invites/${id}`))).exists(), true);
      await assert.rejects(getDoc(doc(late.firestore, `companies/${companyId}/invites/${id}`)));
      await assert.rejects(getDoc(doc(outsider.firestore, `companies/${companyId}/invites/${id}`)));
      const received = await getDocs(query(collection(friend.firestore, `companies/${companyId}/invites`), where("companyId", "==", companyId), where("toUserId", "==", uidFriend), limit(50)));
      assert.equal(received.size, 1);
      await assert.rejects(getDocs(query(collection(late.firestore, `companies/${companyId}/invites`), where("companyId", "==", companyId), where("toUserId", "==", uidFriend), limit(50))));
      await assert.rejects(setDoc(doc(friend.firestore, `companies/${companyId}/invites/${id}`), { status: "accepted" }, { merge: true }));
      assert.equal((await getDoc(doc(friend.firestore, `users/${uidFriend}/notifications/invite_${id}`))).exists(), true);
      await assert.rejects(getDoc(doc(sender.firestore, `users/${uidFriend}/notifications/invite_${id}`)));
    });
    await t.test("only the recipient responds; accepting joins and counts once; replays are safe", async () => {
      const inviteId = `${eventId}_${uidFriend}`;
      const body = { contractVersion: 1, companyId, inviteId, response: "accepted" };
      await rejects(sender.respond(body), "not-found", "INVITE_NOT_FOUND");
      await rejects(late.respond(body), "not-found", "INVITE_NOT_FOUND");
      await rejects(outsider.respond(body), "permission-denied", "MEMBERSHIP_CONFLICT");
      const [a, b] = await Promise.all([friend.respond(body), friend.respond(body)]);
      for (const result of [a.data, b.data] as any[]) assert.deepEqual(result, { contractVersion: 1, inviteId, status: "accepted", rsvpStatus: "going", attendeeCount: 2 });
      assert.equal((await eventRef.get()).get("attendeeCount"), 2);
      assert.equal((await eventRef.collection("rsvps").doc(uidFriend).get()).get("status"), "going");
      assert.equal((await db.doc(`companies/${companyId}/invites/${inviteId}`).get()).get("status"), "accepted");
      await rejects(friend.respond({ ...body, response: "declined" }), "failed-precondition", "INVITE_ALREADY_RESPONDED");
    });
    await t.test("a full event rejects acceptance as a whole and the invite stays pending", async () => {
      await seed({ attendeeCount: 1, capacity: 2 });
      await sender.send(payload(uidFriend));
      await eventRef.update({ attendeeCount: 2 });
      await rejects(friend.respond({ contractVersion: 1, companyId, inviteId: `${eventId}_${uidFriend}`, response: "accepted" }), "resource-exhausted", "EVENT_FULL");
      assert.equal((await db.doc(`companies/${companyId}/invites/${eventId}_${uidFriend}`).get()).get("status"), "pending");
      assert.equal((await eventRef.collection("rsvps").doc(uidFriend).get()).exists, false);
      assert.equal((await eventRef.get()).get("attendeeCount"), 2);
      await rejects(sender.send(payload(uidLate, `${stamp}-request-3`)), "failed-precondition", "EVENT_FULL");
    });
    await t.test("declining keeps the event untouched; cancelled and started events refuse invitations", async () => {
      await seed();
      await sender.send(payload(uidFriend));
      const declined = (await friend.respond({ contractVersion: 1, companyId, inviteId: `${eventId}_${uidFriend}`, response: "declined" })).data as any;
      assert.equal(declined.status, "declined");
      assert.equal((await eventRef.get()).get("attendeeCount"), 1);
      await seed({ status: "cancelled" });
      await rejects(sender.send(payload(uidLate)), "failed-precondition", "EVENT_CANCELLED");
      await seed({ startTime: adminFirestore.Timestamp.fromMillis(Date.now() - 60_000) });
      await rejects(sender.send(payload(uidLate)), "failed-precondition", "EVENT_CLOSED");
    });
  } finally {
    await db.recursiveDelete(eventRef);
    await db.recursiveDelete(db.collection(`companies/${companyId}/invites`));
  }
});
