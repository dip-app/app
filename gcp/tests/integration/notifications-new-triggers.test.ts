import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

// Run with: npm run test:notifications:integration. PUSH-4 triggers (attendee added, invite accepted, challenge
// reviewed) always use the router. The emulator never contacts FCM: pushes are recorded in `emulatorPushOutbox`.
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

test("attendee added, invite accepted and challenge reviewed pushes through the router", { timeout: 300_000 }, async (t) => {
  const stamp = `newpush-${Date.now()}`;
  const app = adminApp.initializeApp({ projectId }, stamp);
  const db = adminFirestore.getFirestore(app);
  const companyId = `${stamp}-alpha`;
  const names = ["Ada Admin", "Sam Sender", "Fran Friend", "Quinn Quiet"];
  const clients = names.map((_, i) => {
    const client = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, `${stamp}-${i}`);
    const auth = getAuth(client); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(client, "us-central1");
    const [fnHost, fnPort] = functionsHost.split(":"); connectFunctionsEmulator(functions, fnHost!, Number(fnPort));
    return { app: client, auth, call: (name: string) => httpsCallable(functions, name) };
  });
  const [organizer, sender, friend, quiet] = clients as [typeof clients[number], typeof clients[number], typeof clients[number], typeof clients[number]];
  const uids: string[] = [];
  const tokens = names.map((_, i) => `new-trigger-token-${i}-${stamp}`);
  const outbox = (type: string) => db.collection("emulatorPushOutbox").where("data.companyId", "==", companyId).where("data.type", "==", type).get();
  const hashesOf = (snapshot: FirebaseFirestore.QuerySnapshot) => snapshot.docs.flatMap((d) => d.data().tokenHashes as string[]);
  t.after(async () => {
    const pushes = await db.collection("emulatorPushOutbox").where("data.companyId", "==", companyId).get();
    for (const push of pushes.docs) await push.ref.delete();
    await db.recursiveDelete(db.doc(`companies/${companyId}`)).catch(() => undefined);
    for (const uid of uids) {
      await db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => undefined);
      await adminAuth.getAuth(app).deleteUser(uid).catch(() => undefined);
    }
    for (const client of clients) await deleteApp(client.app).catch(() => undefined);
    await adminApp.deleteApp(app).catch(() => undefined);
  });

  for (const [index, client] of clients.entries()) {
    const email = `${stamp}-${index}@synthetic.test`;
    const { user } = await signInWithCredential(client.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: names[index] })));
    uids.push(user.uid);
    await db.doc(`users/${user.uid}`).set({ companyId, role: index === 0 ? "admin" : "member", displayName: names[index], avatarId: `avatar-${index}`,
      department: "Ops", jobTitle: "", pointsBalance: 0 });
    await client.call("registerDeviceV1")({ contractVersion: 1, token: tokens[index], platform: "ios", appVersion: "1.0 (1)" });
  }
  const [uidAdmin, uidSender, uidFriend, uidQuiet] = uids as [string, string, string, string];
  // Quinn keeps the challenge category off in the notification preferences.
  await db.doc(`users/${uidQuiet}/settings/notifications`).set({ contractVersion: 1, push: { challenges: false }, updatedAt: adminFirestore.Timestamp.now() });
  const future = adminFirestore.Timestamp.fromMillis(Date.now() + 3 * 86_400_000);
  const event = (title: string) => ({
    companyId, title, description: "", tagIds: [], coverImageURL: "catalog://default/outdoors", startTime: future,
    endTime: adminFirestore.Timestamp.fromMillis(future.toMillis() + 3_600_000),
    venue: { name: "Park", address: "1 Main", locality: "PGH", latitude: 40, longitude: -80 }, costCents: 0, costNote: "", capacity: 10, pointsValue: 0,
    isOutdoor: true, status: "scheduled", attendeeCount: 0, createdBy: uidAdmin, createdAt: adminFirestore.Timestamp.now(), revision: 1,
  });
  await db.doc(`companies/${companyId}/events/workshop`).set(event("Pottery Workshop"));
  await db.doc(`companies/${companyId}/events/dinner`).set(event("Pasta Night"));

  await t.test("an admin adding a member pushes to that member only, in the event_updates category", async () => {
    const requestId = `${stamp}-add-1`;
    const body = { contractVersion: 1, companyId, requestId, eventId: "workshop", userId: uidFriend, notify: true };
    await organizer.call("addEventAttendeeV1")(body);
    const pushes = await eventually(() => outbox("attendee_added"), (s) => s.size >= 1, "attendee_added push");
    assert.equal(pushes.size, 1);
    const push = pushes.docs[0]!.data();
    assert.deepEqual(push.tokenHashes, [sha(tokens[2]!)]);
    assert.equal(push.title, "You were added to an activity");
    assert.equal(push.body, "An organizer added you to Pottery Workshop.");
    assert.equal(push.data.deepLink, "dip://events/workshop");
    assert.equal(push.data.category, "event_updates");
    assert.equal(push.category, "event_updates");
    assert.equal(push.data.eventId, "workshop");
    assert.ok((await db.doc(`users/${uidFriend}/notifications/admin_${requestId}`).get()).exists);
    // Replaying the request, or a notify:false add, sends nothing more.
    await organizer.call("addEventAttendeeV1")(body);
    await organizer.call("addEventAttendeeV1")({ ...body, requestId: `${stamp}-add-2`, userId: uidQuiet, notify: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal((await outbox("attendee_added")).size, 1);
  });

  await t.test("an accepted invite pushes to the sender; a declined one stays silent", async () => {
    const send = (to: string, requestId: string, eventId = "dinner") =>
      sender.call("sendInviteV1")({ contractVersion: 1, companyId, eventId, toUserId: to, message: "Join us", requestId });
    await send(uidFriend, `${stamp}-inv-1`);
    await send(uidQuiet, `${stamp}-inv-2`);
    await friend.call("respondToInviteV1")({ contractVersion: 1, companyId, inviteId: `dinner_${uidFriend}`, response: "accepted" });
    const pushes = await eventually(() => outbox("invite_answered"), (s) => s.size >= 1, "invite_answered push");
    assert.equal(pushes.size, 1);
    const push = pushes.docs[0]!.data();
    assert.deepEqual(push.tokenHashes, [sha(tokens[1]!)]);
    assert.equal(push.body, "Fran Friend accepted your invite to Pasta Night.");
    assert.equal(push.data.deepLink, "dip://events/dinner");
    assert.equal(push.data.category, "invites");
    assert.equal(push.data.inviteId, `dinner_${uidFriend}`);
    const notice = (await db.doc(`users/${uidSender}/notifications/invite_answered_dinner_${uidFriend}`).get()).data()!;
    assert.deepEqual([notice.type, notice.targetType, notice.targetId, notice.isRead], ["invite_answered", "event", "dinner", false]);
    await quiet.call("respondToInviteV1")({ contractVersion: 1, companyId, inviteId: `dinner_${uidQuiet}`, response: "declined" });
    await friend.call("respondToInviteV1")({ contractVersion: 1, companyId, inviteId: `dinner_${uidFriend}`, response: "accepted" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal((await outbox("invite_answered")).size, 1);
    assert.equal((await db.doc(`users/${uidSender}/notifications/invite_answered_dinner_${uidQuiet}`).get()).exists, false);
  });

  const challenge = {
    companyId, title: "Hydration Week", description: "Drink water", tagIds: [], type: "weekly", goal: 5, goalUnit: "glasses",
    coverImageURL: "catalog://theme/fitness", startDate: adminFirestore.Timestamp.fromMillis(Date.now() - 86_400_000),
    endDate: adminFirestore.Timestamp.fromMillis(Date.now() + 86_400_000), pointsReward: 20, participantCount: 0, completedCount: 0, revision: 1,
  };
  await db.doc(`companies/${companyId}/challenges/week1`).set(challenge);
  const submit = (client: typeof friend) => client.call("submitChallengeV1")({ contractVersion: 1, companyId, challengeId: "week1", progress: 3, caption: "Done" });
  const review = (command: string, userId: string, extra: Record<string, unknown> = {}) =>
    organizer.call(command)({ contractVersion: 1, companyId, challengeId: "week1", userId, ...extra });

  await t.test("approval and changes requested push to the submitter with a challenge deep link", async () => {
    await submit(friend); await submit(sender);
    await review("approveChallengeV1", uidFriend);
    const approved = await eventually(() => outbox("challenge_approved"), (s) => s.size >= 1, "challenge_approved push");
    assert.equal(approved.size, 1);
    const push = approved.docs[0]!.data();
    assert.deepEqual(push.tokenHashes, [sha(tokens[2]!)]);
    assert.equal(push.title, "Your submission was approved");
    assert.equal(push.body, "Hydration Week");
    assert.equal(push.data.deepLink, "dip://challenges/week1");
    assert.equal(push.data.category, "challenges");
    assert.equal("eventId" in push.data, false);
    assert.ok((await db.doc(`users/${uidFriend}/notifications/challenge_approved_week1`).get()).exists);

    await review("rejectChallengeV1", uidSender, { reason: "Please add detail" });
    const changes = await eventually(() => outbox("challenge_changes_requested"), (s) => s.size >= 1, "changes push");
    assert.equal(changes.size, 1);
    const second = changes.docs[0]!.data();
    assert.deepEqual(second.tokenHashes, [sha(tokens[1]!)]);
    assert.equal(second.title, "Changes requested on your submission");
    assert.equal(second.data.deepLink, "dip://challenges/week1");
    assert.doesNotMatch(JSON.stringify(second), /Please add detail/);
    assert.ok((await db.doc(`users/${uidSender}/notifications/challenge_changes_week1_1`).get()).exists);

    await review("approveChallengeV1", uidFriend); // replay: no second push
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal((await outbox("challenge_approved")).size, 1);
  });

  await t.test("a member with the challenges push category off gets no challenge push but keeps the in-app notice", async () => {
    await submit(quiet);
    await review("approveChallengeV1", uidQuiet);
    await eventually(() => db.doc(`users/${uidQuiet}/notifications/challenge_approved_week1`).get(), (s) => s.exists, "in-app notice");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const all = [...hashesOf(await outbox("challenge_approved")), ...hashesOf(await outbox("challenge_changes_requested"))];
    assert.equal(all.includes(sha(tokens[3]!)), false);
    assert.equal((await outbox("challenge_approved")).size, 1);
  });
});
