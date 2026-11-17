import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { enqueueEmail } from "../../functions/src/modules/email/application/enqueueEmail";
import { signOpenToken } from "../../functions/src/modules/email/domain/openToken";
import { signUnsubscribeToken } from "../../functions/src/modules/email/domain/unsubscribeToken";
import { validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { FirestoreEmailStore } from "../../functions/src/modules/email/infrastructure/firestoreEmailStore";

// Run with: npm run test:email:integration. In the emulator the provider is EmulatorOutboxEmailProvider
// (records into `emulatorEmailOutbox`), the unsubscribe key and webhook password are emulator constants.
const projectId = "demo-dip";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
for (const host of [firestoreHost, functionsHost]) {
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host)) throw new Error("Requires local emulators.");
}
if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) throw new Error("Requires demo-dip.");
const EMULATOR_UNSUBSCRIBE_KEY = "emulator-only-unsubscribe-key-not-a-secret-0000"; // mirrors transport/emailFunctions.ts
const EMULATOR_WEBHOOK_PASSWORD = "emulator-only-webhook-password-0000";
const base = `http://${functionsHost}/${projectId}/us-central1`;

const req = createRequire(require.resolve("../../functions/package.json"));
const adminApp = req("firebase-admin/app") as typeof import("firebase-admin/app");
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("email outbox trigger, unsubscribe and webhook against the emulators", { timeout: 300_000 }, async (t) => {
  const stamp = `email-${Date.now()}`;
  const app = adminApp.initializeApp({ projectId }, stamp);
  const db = adminFirestore.getFirestore(app);
  const store = new FirestoreEmailStore(db);
  const deps = { outbox: store.outbox, clock: { now: () => new Date() }, validate: validateVariables };
  const companyId = `${stamp}-co`;
  const otherCompanyId = `${stamp}-other`; // no emailSettings document
  const seededUsers: string[] = [];
  const seededSuppressions: string[] = [];

  const addUser = async (name: string, email: string, company = companyId) => {
    const uid = `${stamp}-${name}`;
    await db.doc(`users/${uid}`).set({ companyId: company, email, displayName: `${name} Tester` });
    seededUsers.push(uid);
    return { uid, email, hash: sha(email.trim().toLowerCase()) };
  };
  const invite = (uid: string, company: string, revision: string) => enqueueEmail(deps, {
    template: "invite_received", uid, companyId: company, objectId: `evt-${stamp}`, revisionOrWindow: revision,
    variables: {
      eventId: `evt-${stamp}`, eventTitle: "Sunset hike", startTime: "2026-12-20T23:30:00Z", endTime: "2026-12-21T01:00:00Z",
      venueName: "Frick Park", coverImageURL: "catalog://default/hiking", inviterFirstName: "Priya",
    },
  });
  const outboxDoc = (id: string) => db.doc(`emailOutbox/${id}`).get();
  const settled = (id: string) => eventually(() => outboxDoc(id), (s) => s.exists && !["queued", "sending"].includes(s.get("status")), `outbox ${id}`);
  const sends = (id: string) => db.collection("emulatorEmailOutbox").where("outboxId", "==", id).get();

  try {
    await db.doc(`emailSettings/${companyId}`).set({ enabled: true, dailyCap: 100 });
    // The other company the mismatch case claims to belong to is enabled from the start, so only the tenant check can skip it.
    await db.doc(`emailSettings/${stamp}-someone-else`).set({ enabled: true, dailyCap: 100 });

    await t.test("happy path sends once, hashes the address, adds unsubscribe headers and an .ics", async () => {
      const user = await addUser("happy", `Happy.${stamp}@Synthetic.test`);
      const result = await invite(user.uid, companyId, "r1");
      assert.equal(result.enqueued, true);
      const done = await settled(result.id);
      assert.equal(done.get("status"), "sent");
      assert.equal(done.get("toHash"), user.hash);
      const emails = await eventually(() => sends(result.id), (s) => s.size >= 1, "emulator email");
      assert.equal(emails.size, 1);
      const sent = emails.docs[0]!.data();
      assert.equal(sent["toHash"], user.hash);
      assert.match(sent["headers"]["List-Unsubscribe"], /^<https:\/\/letsdip\.work\/u\/.+>$/);
      assert.equal(sent["headers"]["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
      assert.ok((sent["attachmentNames"] as string[]).some((n) => n.endsWith(".ics")), "ics attachment");
      for (const snapshot of [JSON.stringify(sent), JSON.stringify(done.data())]) {
        assert.ok(!snapshot.toLowerCase().includes(user.email.toLowerCase()), "no plain address stored");
      }
      // Idempotency: the same candidate again is a no-op and sends nothing more.
      const again = await invite(user.uid, companyId, "r1");
      assert.deepEqual({ enqueued: again.enqueued, reason: again.reason }, { enqueued: false, reason: "duplicate" });
      await sleep(2000);
      assert.equal((await sends(result.id)).size, 1);
      assert.equal((await outboxDoc(result.id)).get("status"), "sent");
    });

    await t.test("open pixel: counts opens on a sent email; an invalid token writes nothing", async () => {
      const user = await addUser("opens", `opens.${stamp}@synthetic.test`);
      const { id } = await invite(user.uid, companyId, "r1");
      assert.equal((await settled(id)).get("status"), "sent");
      const token = signOpenToken(EMULATOR_UNSUBSCRIBE_KEY, id, Math.floor(Date.now() / 1000));
      const url = `${base}/emailOpenV1/o/${token}.gif`;

      const first = await fetch(url);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get("content-type"), "image/gif");
      assert.equal((await first.arrayBuffer()).byteLength, 43);
      const afterFirst = await outboxDoc(id);
      assert.equal(afterFirst.get("openCount"), 1);
      const firstOpened = afterFirst.get("firstOpenedAt");
      assert.ok(firstOpened);

      assert.equal((await fetch(url)).status, 200);
      const afterSecond = await outboxDoc(id);
      assert.equal(afterSecond.get("openCount"), 2);
      assert.ok(afterSecond.get("firstOpenedAt").isEqual(firstOpened));
      assert.ok(afterSecond.get("lastOpenedAt"));

      const invalid = await fetch(`${base}/emailOpenV1/o/${token.slice(0, -2)}xx.gif`);
      assert.equal(invalid.status, 200);
      assert.equal((await outboxDoc(id)).get("openCount"), 2);
    });

    await t.test("preference off skips without sending", async () => {
      const user = await addUser("prefoff", `prefoff.${stamp}@synthetic.test`);
      await db.doc(`users/${user.uid}/settings/notifications`).set({ email: { invites: false } });
      const { id } = await invite(user.uid, companyId, "r1");
      const done = await settled(id);
      assert.deepEqual([done.get("status"), done.get("reason")], ["skipped", "preference_off"]);
      assert.equal((await sends(id)).size, 0);
    });

    await t.test("a suppressed address is skipped", async () => {
      const user = await addUser("suppressed", `suppressed.${stamp}@synthetic.test`);
      await db.doc(`emailSuppressions/${user.hash}`).set({ reason: "hard_bounce", count: 1 });
      seededSuppressions.push(user.hash);
      const { id } = await invite(user.uid, companyId, "r1");
      const done = await settled(id);
      assert.deepEqual([done.get("status"), done.get("reason")], ["skipped", "suppressed"]);
      assert.equal((await sends(id)).size, 0);
    });

    await t.test("tenant mismatch and company without settings are skipped", async () => {
      const member = await addUser("tenant", `tenant.${stamp}@synthetic.test`);
      const mismatch = await invite(member.uid, `${stamp}-someone-else`, "r1");
      const doneMismatch = await settled(mismatch.id);
      assert.deepEqual([doneMismatch.get("status"), doneMismatch.get("reason")], ["skipped", "tenant_mismatch"]);
      assert.equal((await sends(mismatch.id)).size, 0);

      const outsider = await addUser("nosettings", `nosettings.${stamp}@synthetic.test`, otherCompanyId);
      const { id } = await invite(outsider.uid, otherCompanyId, "r1");
      const done = await settled(id);
      assert.deepEqual([done.get("status"), done.get("reason")], ["skipped", "company_disabled"]);
      assert.equal((await sends(id)).size, 0);
    });

    await t.test("a rejected address fails and is suppressed", async () => {
      const user = await addUser("bounce", `bounce-${stamp}@synthetic.test`);
      const { id } = await invite(user.uid, companyId, "r1");
      const done = await settled(id);
      assert.equal(done.get("status"), "failed");
      assert.equal(done.get("reason"), "emulator_bounce");
      await eventually(() => db.doc(`emailSuppressions/${user.hash}`).get(), (s) => s.exists, "suppression");
      seededSuppressions.push(user.hash);
      assert.equal((await sends(id)).size, 0);
    });

    await t.test("unsubscribe: GET confirms only, POST one-click disables the category, bad tokens are 400", async () => {
      const user = await addUser("unsub", `unsub.${stamp}@synthetic.test`);
      const prefs = db.doc(`users/${user.uid}/settings/notifications`);
      await prefs.set({ contractVersion: 1, email: { reminders: true, challenges: false }, push: { chat: true } });
      const token = signUnsubscribeToken(EMULATOR_UNSUBSCRIBE_KEY, user.uid, "invites", Math.floor(Date.now() / 1000));
      const url = `${base}/emailUnsubscribeV1/u/${token}`;

      const get = await fetch(url);
      assert.equal(get.status, 200);
      assert.deepEqual((await prefs.get()).get("email"), { reminders: true, challenges: false });

      const post = await fetch(url, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
      assert.equal(post.status, 200);
      assert.equal(post.headers.get("location"), null);
      const after = (await prefs.get()).data()!;
      assert.deepEqual(after["email"], { reminders: true, challenges: false, invites: false });
      assert.deepEqual(after["push"], { chat: true });

      const tampered = await fetch(`${base}/emailUnsubscribeV1/u/${token.slice(0, -2)}xx`, { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
      assert.equal(tampered.status, 400);
      assert.equal((await fetch(`${base}/emailUnsubscribeV1/u/not-a-token`)).status, 400);
    });

    await t.test("webhook: a complaint suppresses and opts out everywhere; wrong credentials write nothing", async () => {
      const user = await addUser("complaint", `complaint.${stamp}@synthetic.test`);
      const sent = await invite(user.uid, companyId, "r1");
      assert.equal((await settled(sent.id)).get("status"), "sent");
      const url = `${base}/emailWebhookV1`;
      const body = JSON.stringify({ RecordType: "SpamComplaint", Email: user.email, Metadata: { outboxId: sent.id } });
      const basic = (password: string) => `Basic ${Buffer.from(`dip-email-webhook:${password}`).toString("base64")}`;

      const denied = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: basic("wrong-password-wrong-password-0000") }, body });
      assert.equal(denied.status, 401);
      assert.equal((await db.doc(`emailSuppressions/${user.hash}`).get()).exists, false);
      assert.equal((await db.doc(`users/${user.uid}/settings/notifications`).get()).exists, false);

      const ok = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: basic(EMULATOR_WEBHOOK_PASSWORD) }, body });
      assert.equal(ok.status, 200);
      seededSuppressions.push(user.hash);
      assert.equal((await db.doc(`emailSuppressions/${user.hash}`).get()).get("reason"), "complaint");
      assert.deepEqual((await db.doc(`users/${user.uid}/settings/notifications`).get()).get("email"),
        { invites: false, event_updates: false, reminders: false, challenges: false, discovery: false });
    });
  } finally {
    await Promise.allSettled([
      ...seededUsers.map((uid) => db.recursiveDelete(db.doc(`users/${uid}`))),
      ...seededSuppressions.map((hash) => db.doc(`emailSuppressions/${hash}`).delete()),
    ]);
    await adminApp.deleteApp(app);
  }
});
