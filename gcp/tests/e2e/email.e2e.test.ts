import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { runAdminDigests } from "../../functions/src/modules/email/application/adminDigest";
import { routerEmailChannel } from "../../functions/src/modules/email/application/routerChannel";
import { runWeeklyThemeEmails } from "../../functions/src/modules/email/application/weeklyThemeEmails";
import { inviteUid } from "../../functions/src/modules/email/domain/ics";
import { validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { FirestoreDigestSource } from "../../functions/src/modules/email/infrastructure/firestoreDigestSource";
import { FirestoreEmailStore } from "../../functions/src/modules/email/infrastructure/firestoreEmailStore";
import { sendDueRemindersViaRouter } from "../../functions/src/modules/notifications/application/handlers";
import { cachedPreferences } from "../../functions/src/modules/notifications/application/preferenceCache";
import {
  FirestoreDeliveryReceipts, FirestoreLocales, FirestoreMembership, FirestorePushRateLimiter,
} from "../../functions/src/modules/notifications/infrastructure/firestoreDelivery";
import { EmulatorOutboxMessaging } from "../../functions/src/modules/notifications/infrastructure/messaging";
import { FirestoreNotificationsStore } from "../../functions/src/modules/notifications/infrastructure/firestoreNotificationsStore";
import { FirestorePreferences } from "../../functions/src/modules/notifications/infrastructure/firestorePreferences";
import { FirestoreThemes } from "../../functions/src/modules/notifications/infrastructure/firestoreThemes";

/*
 * Email end-to-end suite (docs/ops/email-runbook.md, "Pre-release check"). Run with: npm run test:email:e2e.
 *
 * Drives every email DIP sends through the trigger production uses: callables over the Auth and Functions emulators
 * (resolveMembershipV1, sendInviteV1, respondToInviteV1, setRsvpV1, createEventV1, updateEventV1, addEventAttendeeV1,
 * setMemberStatusV1, submitChallengeV1, approveChallengeV1, rejectChallengeV1, upsertRosterEntryV1,
 * sendRosterInviteEmailV1, updateBugReportV1, setMyLocaleV1), the Firestore triggers they fire (RSVP, event update,
 * user created, outbox created) and, for the three scheduled jobs (reminders, weekly theme email, admin digest), the
 * job's own application function with the production Firestore adapters and a chosen clock (the emulator has no
 * scheduler). The functions emulator never reaches a provider: `EmulatorOutboxEmailProvider` records every message in
 * `emulatorEmailOutbox` (subject, From, Reply-To, HTML, text, headers, attachments; the address only as a hash).
 *
 * Every step asserts the exact set of emails that went out (recipient and template), then that nothing else arrives
 * during a quiet period: exactly one email per recipient per situation, no stray or duplicate sends.
 */

const projectId = "demo-dip";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
/**
 * The Functions emulator address: FUNCTIONS_EMULATOR_HOST when set, else asked from the emulator hub that
 * `firebase emulators:exec` advertises (so a run on non-default ports never calls another emulator on 5001).
 */
async function discoverFunctionsHost(): Promise<string> {
  if (process.env.FUNCTIONS_EMULATOR_HOST) return process.env.FUNCTIONS_EMULATOR_HOST;
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) return "127.0.0.1:5001";
  const list = await (await fetch(`http://${hub}/emulators`)).json() as Record<string, { host: string; port: number }>;
  const functions = list.functions;
  if (!functions) throw new Error("The functions emulator is not running.");
  return `${functions.host}:${functions.port}`;
}
const LOCAL = /^(127\.0\.0\.1|localhost):[0-9]+$/;
for (const host of [authHost, firestoreHost]) {
  if (!host || !LOCAL.test(host)) throw new Error("Requires local emulators (npm run test:email:e2e).");
}
if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) throw new Error("Requires demo-dip.");

const req = createRequire(require.resolve("../../functions/package.json"));
const adminApp = req("firebase-admin/app") as typeof import("firebase-admin/app");
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const adminAuth = req("firebase-admin/auth") as typeof import("firebase-admin/auth");
const { createHash } = req("node:crypto") as typeof import("node:crypto");
const sha = (value: string) => createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(250);
  }
}

interface Sent {
  id: string; toHash: string; subject: string; template: string; outboxId: string; from: string | null; replyTo: string | null;
  headers: Record<string, string>; html: string; text: string; attachments: Array<{ filename: string; contentType: string; content: string }>;
}

interface Person { key: string; uid: string; email: string; hash: string; name: string; call: (name: string, data: unknown) => Promise<any>; app: FirebaseApp }

/** One line of an unfolded iCalendar file (`KEY:value` or `KEY;params:value`). */
function icsLine(ics: string, key: string): string | undefined {
  return ics.split("\r\n").find((line) => line.startsWith(`${key}:`) || line.startsWith(`${key};`));
}

test("every email goes out exactly once from its real trigger (emulators)", { timeout: 900_000 }, async (t) => {
  const functionsHost = await discoverFunctionsHost();
  if (!LOCAL.test(functionsHost)) throw new Error("Requires a local functions emulator.");
  const functionsBase = `http://${functionsHost}/${projectId}/us-central1`;
  const stamp = `e2e${Date.now().toString(36)}`;
  const app = adminApp.initializeApp({ projectId }, stamp);
  const db = adminFirestore.getFirestore(app);
  const Timestamp = adminFirestore.Timestamp;
  const companyA = `${stamp}-acme`;
  const companyB = `${stamp}-beta`;
  const companyC = `${stamp}-capped`;
  const domainOf = { [companyA]: `${stamp}-acme.test`, [companyB]: `${stamp}-beta.test`, [companyC]: `${stamp}-capped.test` } as Record<string, string>;
  const people: Person[] = [];
  const clients: FirebaseApp[] = [];

  t.after(async () => {
    for (const person of people) await adminAuth.getAuth(app).deleteUser(person.uid).catch(() => undefined);
    for (const client of clients) await deleteApp(client).catch(() => undefined);
    await adminApp.deleteApp(app).catch(() => undefined);
  });

  // --- Clients and people ------------------------------------------------------------------------------------------
  function client(key: string) {
    const clientApp = initializeApp({ projectId, apiKey: "demo-key", appId: "demo-app" }, `${stamp}-${key}`);
    clients.push(clientApp);
    const auth = getAuth(clientApp); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const functions = getFunctions(clientApp, "us-central1");
    const [fnHost, fnPort] = functionsHost.split(":"); connectFunctionsEmulator(functions, fnHost!, Number(fnPort));
    return { app: clientApp, auth, call: async (name: string, data: unknown) => (await httpsCallable(functions, name)(data)).data as any };
  }
  /** Google sign-in on the Auth emulator, then the real first membership resolve (creates `users/{uid}`). */
  async function join(key: string, name: string, companyId: string, localPart = `${key}.${stamp}`): Promise<Person> {
    const c = client(key);
    const email = `${localPart}@${domainOf[companyId]}`;
    const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: `google-${email}`, email, email_verified: true, name }));
    const { user } = await signInWithCredential(c.auth, credential);
    await c.call("resolveMembershipV1", { contractVersion: 1 });
    const person = { key, uid: user.uid, email, hash: sha(email), name, call: c.call, app: c.app };
    people.push(person);
    return person;
  }

  // --- Email ledger ------------------------------------------------------------------------------------------------
  const seen = new Set<string>();
  const readAll = async (): Promise<Sent[]> => (await db.collection("emulatorEmailOutbox").get()).docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Sent, "id">) }));
  const fresh = async () => (await readAll()).filter((s) => !seen.has(s.id));
  const pendingOutbox = async () => (await db.collection("emailOutbox").where("status", "in", ["queued", "sending"]).get()).size;
  /** Waits until no outbox email is queued or sending and nothing new arrived for `quietMs` (bounded). */
  async function quiet(quietMs = 3000, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    let stableSince = Date.now();
    for (;;) {
      const [sent, pending] = await Promise.all([db.collection("emulatorEmailOutbox").count().get(), pendingOutbox()]);
      const total = sent.data().count * 1000 + pending;
      if (total !== last || pending > 0) { last = total; stableSince = Date.now(); }
      if (pending === 0 && Date.now() - stableSince >= quietMs) return;
      if (Date.now() > deadline) throw new Error("Timed out waiting for the email outbox to settle");
      await sleep(300);
    }
  }
  const nameOf = (hash: string) => people.find((p) => p.hash === hash)?.key ?? extraNames.get(hash) ?? hash.slice(0, 8);
  const extraNames = new Map<string, string>();
  const label = (list: Array<{ toHash: string; template: string }>) => list.map((s) => `${nameOf(s.toHash)}:${s.template}`).sort();
  /**
   * Runs `action`, then asserts that exactly `expected` (recipient, template) emails went out because of it: waits for
   * them, waits for a quiet period, and fails on anything missing, extra or duplicated.
   */
  type Expected = Array<[{ hash: string }, string]>;
  async function expectEmails(step: string, expected: Expected | (() => Expected), action?: () => Promise<unknown>): Promise<Sent[]> {
    await quiet(1500);
    const before = await fresh();
    for (const s of before) seen.add(s.id);
    // A late email from the previous step (after its quiet period) is a duplicate or a slow trigger: report it here.
    assert.deepEqual(label(before), [], `${step}: late emails from the previous step`);
    let want: Array<{ toHash: string; template: string }> = [];
    let got: Sent[] = [];
    try {
      if (action) await action();
      want = (typeof expected === "function" ? expected() : expected).map(([who, template]) => ({ toHash: who.hash, template }));
      // On a timeout the comparison below reports which emails are missing or extra.
      if (want.length > 0) await eventually(fresh, (list) => list.length >= want.length, `${step}: ${want.length} email(s)`, 60_000).catch(() => undefined);
    } finally {
      // Whatever this step produced is consumed even when it fails, so a failure never cascades into later steps.
      await quiet();
      got = await fresh();
      for (const s of got) seen.add(s.id);
    }
    assert.deepEqual(label(got), label(want), `${step}: exactly the expected emails`);
    for (const s of got) assertCommon(step, s);
    return got;
  }
  const one = (list: Sent[], who: { hash: string }, template: string) => {
    const match = list.filter((s) => s.toHash === who.hash && s.template === template);
    assert.equal(match.length, 1, `one ${template} to ${nameOf(who.hash)}`);
    return match[0]!;
  };
  /** Shared layout, headers and privacy for every email. */
  function assertCommon(step: string, s: Sent) {
    const where = `${step} ${s.template} to ${nameOf(s.toHash)}`;
    assert.match(s.headers["List-Unsubscribe"] ?? "", /^<https:\/\/letsdip\.work\/u\/[A-Za-z0-9._-]+>$/, `${where}: List-Unsubscribe`);
    assert.equal(s.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click", `${where}: one-click`);
    if (s.template !== "admin_suggestions") {
      assert.ok(s.html.includes("https://letsdip.work/img/email/header.png"), `${where}: shared header`);
      assert.ok(s.html.includes("https://letsdip.work/img/email/footer.png"), `${where}: shared footer art`);
    }
    assert.ok(s.html.includes("support@letsdip.work") && s.text.includes("support@letsdip.work"), `${where}: footer contact`);
    assert.match(s.text, /Sent by DIP|Enviado por DIP/, `${where}: footer text`);
    assert.ok(s.text.length > 40 && !/undefined|NaN|\[object Object\]|\{[a-zA-Z]+\}/.test(s.subject + s.text), `${where}: no template holes`);
    const all = JSON.stringify(s).toLowerCase();
    for (const p of people) assert.ok(!all.includes(p.email.toLowerCase()), `${where}: no address stored in the record`);
    const calendar = s.template === "calendar_invite" || s.template === "calendar_cancel";
    assert.equal(s.attachments.length, calendar ? 1 : 0, `${where}: attachments`);
    if (calendar) {
      assert.equal(s.from, "DIP Events <events@letsdip.work>");
      assert.equal(s.replyTo, "support@letsdip.work");
    } else {
      assert.equal(s.from, null, `${where}: default notify@ sender`);
    }
  }
  /** Calendar file checks; returns the parsed UID and SEQUENCE. */
  function calendar(s: Sent, method: "REQUEST" | "CANCEL", eventId: string, who: Person) {
    const file = s.attachments[0]!;
    assert.equal(file.filename, "invite.ics");
    assert.equal(file.contentType, `text/calendar; charset=UTF-8; method=${method}`);
    const ics = file.content;
    assert.equal(icsLine(ics, "METHOD"), `METHOD:${method}`);
    const uid = icsLine(ics, "UID")!.slice(4);
    assert.equal(uid, inviteUid(eventId, who.uid), "UID is stable per event and member");
    assert.equal(icsLine(ics, "STATUS"), method === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED");
    assert.equal(icsLine(ics, "ORGANIZER"), 'ORGANIZER;CN="DIP Events":mailto:events@letsdip.work');
    assert.match(icsLine(ics, "ATTENDEE")!, /PARTSTAT=ACCEPTED;RSVP=FALSE.*:mailto:\[recipient\]$/);
    assert.equal(icsLine(ics, "URL"), `URL:https://letsdip.work/e/${eventId}`);
    assert.equal(ics.includes("BEGIN:VALARM"), method === "REQUEST");
    return { uid, sequence: Number(icsLine(ics, "SEQUENCE")!.slice(9)), ics };
  }
  const outboxOf = async (uid: string) => (await db.collection("emailOutbox").where("uid", "==", uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>);
  const prefs = (person: Person, email: Record<string, boolean>) =>
    db.doc(`users/${person.uid}/settings/notifications`).set({ contractVersion: 1, email, updatedAt: Timestamp.now() }, { merge: true });

  // --- Companies ---------------------------------------------------------------------------------------------------
  const companyDoc = (name: string, domain: string) => ({ name, emailDomain: domain, logoURL: "", city: "Pittsburgh, PA", officeLatitude: 40.44, officeLongitude: -79.99, createdAt: Timestamp.now() });
  await db.doc(`companies/${companyA}`).set(companyDoc("Acme E2E", domainOf[companyA]!));
  await db.doc(`companies/${companyB}`).set(companyDoc("Beta E2E", domainOf[companyB]!));
  await db.doc(`companies/${companyC}`).set(companyDoc("Capped E2E", domainOf[companyC]!));
  await db.doc(`emailSettings/${companyA}`).set({ enabled: true, dailyCap: 500, timeZone: "America/Chicago" });
  await db.doc(`emailSettings/${companyB}`).set({ enabled: true, dailyCap: 500 });
  await db.doc(`emailSettings/${companyC}`).set({ enabled: true, dailyCap: 2 });

  // --- People (real first sign-in) -> one welcome each --------------------------------------------------------------
  let ada!: Person, olga!: Person, sam!: Person, rita!: Person, quinn!: Person, dee!: Person, pete!: Person, bob!: Person;
  await t.test("welcome: the first sign-in sends exactly one welcome per member, in every company with email on", async () => {
    const got = await expectEmails("welcome", () => [ada, olga, sam, rita, quinn, dee, pete, bob].map((p) => [p, "welcome"] as [Person, string]), async () => {
      ada = await join("ada", "Ada Admin", companyA);
      olga = await join("olga", "Olga Organizer", companyA);
      sam = await join("sam", "Sam Sender", companyA);
      rita = await join("rita", "Rita Receiver", companyA);
      quinn = await join("quinn", "Quinn Quiet", companyA);
      dee = await join("dee", "Dee Departing", companyA);
      pete = await join("pete", "Pete Pusher", companyA);
      bob = await join("bob", "Bob Beta", companyB);
    });
    for (const s of got) {
      assert.equal(s.subject, s.toHash === bob.hash ? "Welcome to DIP at Beta E2E" : "Welcome to DIP at Acme E2E");
      assert.ok(s.html.includes('href="https://letsdip.work/"'), "Get DIP button for members");
    }
    // A second sign-in (membership resolve) creates nothing and sends nothing.
    await expectEmails("welcome replay", [], () => sam.call("resolveMembershipV1", { contractVersion: 1 }));
  });

  await t.test("roles and language are set through the product paths", async () => {
    await db.doc(`users/${ada.uid}`).update({ role: "admin" });
    await db.doc(`users/${olga.uid}`).update({ role: "organizer" });
    await rita.call("setMyLocaleV1", { contractVersion: 1, locale: "es" });
    // Quinn keeps coworker-invite emails off; Pete has the iOS-written old default `reminders: false` stored explicitly.
    await prefs(quinn, { invites: false });
    await prefs(pete, { invites: true, event_updates: true, reminders: false, challenges: true, discovery: false, calendar_invites: true });
    await expectEmails("setup", []);
  });

  await t.test("caps: a company daily cap of 2 sends two welcomes and skips the third", async () => {
    await quiet(1500);
    for (const key of ["cap1", "cap2", "cap3"]) await join(key, `Cap ${key}`, companyC);
    const capped = people.filter((p) => p.key.startsWith("cap"));
    await eventually(() => Promise.all(capped.map((p) => outboxOf(p.uid))), (docs) => docs.flat().filter((d) => !["queued", "sending"].includes(d.status)).length === 3, "3 settled capped welcomes", 90_000);
    await quiet();
    const got = await fresh();
    for (const s of got) seen.add(s.id);
    assert.equal(got.length, 2, "only two welcomes under a cap of 2");
    assert.ok(got.every((s) => s.template === "welcome" && capped.some((p) => p.hash === s.toHash)));
    const skipped = (await Promise.all(capped.map((p) => outboxOf(p.uid)))).flat().filter((d) => d.status === "skipped");
    assert.deepEqual(skipped.map((d) => d.reason), ["company_cap"]);
  });

  // --- Events ------------------------------------------------------------------------------------------------------
  const venue = (name: string, address: string) => ({ name, address, locality: "Pittsburgh, PA", latitude: 40.44, longitude: -79.99 });
  const draft = (title: string, startMs: number, durationMs: number, place = venue("Clay Studio", "12 Kiln St")) => ({
    title, description: "End-to-end email check.", tagIds: [], coverImageURL: "catalog://default/games",
    startTime: new Date(startMs).toISOString(), endTime: new Date(startMs + durationMs).toISOString(),
    venue: place, costCents: 0, costNote: "", capacity: 20, isOutdoor: false,
  });
  const create = async (by: Person, event: ReturnType<typeof draft>) =>
    (await by.call("createEventV1", { contractVersion: 1, companyId: companyA, requestId: randomUUID(), event })).eventId as string;
  const eventDoc = (eventId: string) => db.doc(`companies/${companyA}/events/${eventId}`);
  const update = async (by: Person, eventId: string, event: ReturnType<typeof draft>, status = "scheduled") => {
    const revision = (await eventDoc(eventId).get()).get("revision") as number;
    return by.call("updateEventV1", { contractVersion: 1, companyId: companyA, eventId, expectedRevision: revision, event, status });
  };
  const rsvp = (who: Person, eventId: string, status: "going" | "cancelled") =>
    who.call("setRsvpV1", { contractVersion: 1, companyId: companyA, eventId, status });
  const subscription = (eventId: string, who: Person) => eventDoc(eventId).collection("subscriptions").doc(who.uid);
  const subscribed = (eventId: string, list: Person[]) =>
    eventually(() => Promise.all(list.map((p) => subscription(eventId, p).get())), (snaps) => snaps.every((s) => s.exists), "default subscriptions");

  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const potteryStart = Date.now() + 3 * DAY;
  const pottery = draft("Pottery Night", potteryStart, 2 * HOUR);
  let potteryId = "";
  const uids = new Map<string, string>(); // member key -> calendar UID on the pottery event
  const sequences = new Map<string, number>();

  await t.test("coworker invite: the invitee gets one email with when and where; the sender gets none", async () => {
    potteryId = await create(olga, pottery);
    await expectEmails("event created", []);
    const requestId = `inv-${stamp}-1`;
    const sent = await expectEmails("invite", [[rita, "invite_received"]],
      () => sam.call("sendInviteV1", { contractVersion: 1, companyId: companyA, eventId: potteryId, toUserId: rita.uid, message: "Join us", requestId }));
    const mail = one(sent, rita, "invite_received");
    assert.equal(mail.subject, "Sam te invitó a Pottery Night", "Spanish for a Spanish-speaking member");
    assert.ok(mail.text.includes("Clay Studio") && mail.text.includes("12 Kiln St"), "Where row with venue name and address");
    assert.ok(mail.html.includes(`https://letsdip.work/e/${potteryId}`), "button opens the event");
    assert.match(mail.text, /CST/, "times in the company zone (America/Chicago) with its abbreviation");
    // Replaying the same request, inviting across tenants, and inviting someone with invite emails off send nothing.
    await expectEmails("invite replay", [],
      () => sam.call("sendInviteV1", { contractVersion: 1, companyId: companyA, eventId: potteryId, toUserId: rita.uid, message: "Join us", requestId }));
    await expectEmails("cross-tenant invite", [], () => assert.rejects(
      sam.call("sendInviteV1", { contractVersion: 1, companyId: companyA, eventId: potteryId, toUserId: bob.uid, message: "", requestId: `inv-${stamp}-bob` })));
    await expectEmails("invite to a member with invite emails off", [],
      () => sam.call("sendInviteV1", { contractVersion: 1, companyId: companyA, eventId: potteryId, toUserId: quinn.uid, message: "", requestId: `inv-${stamp}-2` }));
  });

  await t.test("invite accepted: the inviter gets one email; the invitee gets the calendar invite (REQUEST, SEQUENCE 0)", async () => {
    const sent = await expectEmails("accept", [[sam, "invite_answered"], [rita, "calendar_invite"]],
      () => rita.call("respondToInviteV1", { contractVersion: 1, companyId: companyA, inviteId: `${potteryId}_${rita.uid}`, response: "accepted" }));
    const answered = one(sent, sam, "invite_answered");
    assert.equal(answered.subject, "Rita accepted your invite to Pottery Night");
    assert.ok(answered.text.includes("Clay Studio"), "venue on the accepted email");
    const invite = one(sent, rita, "calendar_invite");
    assert.equal(invite.subject, "Invitación de calendario: Pottery Night");
    const ics = calendar(invite, "REQUEST", potteryId, rita);
    assert.equal(ics.sequence, 0);
    assert.equal(icsLine(ics.ics, "LOCATION"), "LOCATION:Clay Studio\\, 12 Kiln St\\, Pittsburgh\\, PA");
    assert.equal(icsLine(ics.ics, "DTSTART"), `DTSTART:${new Date(potteryStart).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
    uids.set("rita", ics.uid); sequences.set("rita", 0);
    await expectEmails("accept replay", [],
      () => rita.call("respondToInviteV1", { contractVersion: 1, companyId: companyA, inviteId: `${potteryId}_${rita.uid}`, response: "accepted" }));
    await expectEmails("decline", [],
      () => quinn.call("respondToInviteV1", { contractVersion: 1, companyId: companyA, inviteId: `${potteryId}_${quinn.uid}`, response: "declined" }));
  });

  await t.test("joining sends each member one calendar invite", async () => {
    // Organizers manage events in the portal and cannot RSVP (setRsvpV1 accepts members and admins), so the admin
    // is the attendee who also edits the event.
    for (const who of [ada, pete, dee]) {
      const sent = await expectEmails(`join ${who.key}`, [[who, "calendar_invite"]], () => rsvp(who, potteryId, "going"));
      const ics = calendar(one(sent, who, "calendar_invite"), "REQUEST", potteryId, who);
      assert.equal(ics.sequence, 0);
      assert.equal(one(sent, who, "calendar_invite").subject, "Calendar invite: Pottery Night");
      uids.set(who.key, ics.uid); sequences.set(who.key, 0);
    }
    await expectEmails("join replay", [], () => rsvp(pete, potteryId, "going"));
    await subscribed(potteryId, [rita, ada, pete, dee]);
  });

  await t.test("a deactivated member gets nothing more", async () => {
    await expectEmails("deactivate", [], () => ada.call("setMemberStatusV1",
      { contractVersion: 1, companyId: companyA, requestId: randomUUID(), userId: dee.uid, status: "deactivated", reason: "Left the company" }));
  });

  await t.test("venue change: going members get one update email and one updated calendar invite; the editor gets no update email", async () => {
    const moved = { ...pottery, venue: venue("Kiln House", "40 Wheel Ave") };
    const sent = await expectEmails("venue change", [
      [rita, "event_changed"], [pete, "event_changed"],
      [rita, "calendar_invite"], [pete, "calendar_invite"], [ada, "calendar_invite"],
    ], () => update(ada, potteryId, moved));
    const changed = one(sent, pete, "event_changed");
    assert.equal(changed.subject, "Updated: Pottery Night (location changed)");
    assert.ok(changed.text.includes("Kiln House") && changed.text.includes("40 Wheel Ave"), "new place");
    assert.ok(changed.text.includes("Clay Studio"), "old place shown struck through");
    assert.equal(one(sent, rita, "event_changed").subject, "Actualizado: Pottery Night (cambios en el lugar)");
    for (const who of [rita, pete, ada]) {
      const mail = one(sent, who, "calendar_invite");
      const ics = calendar(mail, "REQUEST", potteryId, who);
      assert.equal(ics.uid, uids.get(who.key), "same calendar entry");
      assert.equal(ics.sequence, sequences.get(who.key)! + 1, "SEQUENCE increments");
      assert.ok(icsLine(ics.ics, "LOCATION")!.includes("Kiln House"));
      sequences.set(who.key, ics.sequence);
    }
    assert.match(one(sent, pete, "calendar_invite").subject, /^Updated invite: Pottery Night$/);
    assert.ok(!(await outboxOf(dee.uid)).some((d) => d.template === "event_changed"), "no update email queued for a deactivated member");
  });

  await t.test("leaving sends CANCEL; rejoining sends a fresh REQUEST on the same entry", async () => {
    const left = await expectEmails("leave", [[pete, "calendar_cancel"]], () => rsvp(pete, potteryId, "cancelled"));
    const cancel = one(left, pete, "calendar_cancel");
    assert.equal(cancel.subject, "Removed from your calendar: Pottery Night");
    const c = calendar(cancel, "CANCEL", potteryId, pete);
    assert.equal(c.uid, uids.get("pete"));
    assert.equal(c.sequence, sequences.get("pete")! + 1);
    sequences.set("pete", c.sequence);
    const back = await expectEmails("rejoin", [[pete, "calendar_invite"]], () => rsvp(pete, potteryId, "going"));
    const r = calendar(one(back, pete, "calendar_invite"), "REQUEST", potteryId, pete);
    assert.equal(r.uid, uids.get("pete"));
    assert.equal(r.sequence, sequences.get("pete")! + 1);
    sequences.set("pete", r.sequence);
    await subscribed(potteryId, [pete]);
  });

  await t.test("cancel: one canceled email per going member (not the editor) and a CANCEL for every calendar entry", async () => {
    const sent = await expectEmails("cancel", [
      [rita, "event_canceled"], [pete, "event_canceled"],
      [rita, "calendar_cancel"], [pete, "calendar_cancel"], [ada, "calendar_cancel"],
    ], () => update(ada, potteryId, { ...pottery, venue: venue("Kiln House", "40 Wheel Ave") }, "cancelled"));
    assert.equal(one(sent, pete, "event_canceled").subject, "Canceled: Pottery Night");
    assert.equal(one(sent, rita, "event_canceled").subject, "Cancelado: Pottery Night");
    for (const who of [rita, pete, ada]) {
      const mail = one(sent, who, "calendar_cancel");
      const c = calendar(mail, "CANCEL", potteryId, who);
      assert.equal(c.uid, uids.get(who.key));
      assert.equal(c.sequence, sequences.get(who.key)! + 1);
      sequences.set(who.key, c.sequence);
    }
  });

  await t.test("reopening a canceled event puts it back in going members' calendars", async () => {
    const sent = await expectEmails("reopen", [[rita, "calendar_invite"], [pete, "calendar_invite"], [ada, "calendar_invite"]],
      () => update(ada, potteryId, { ...pottery, venue: venue("Kiln House", "40 Wheel Ave") }, "scheduled"));
    for (const who of [rita, pete, ada]) {
      const r = calendar(one(sent, who, "calendar_invite"), "REQUEST", potteryId, who);
      assert.equal(r.uid, uids.get(who.key));
      assert.equal(r.sequence, sequences.get(who.key)! + 1);
    }
  });

  let gamesId = "";
  await t.test("added by an admin: one 'you were added' email plus the calendar invite; never to the admin who added themself", async () => {
    gamesId = await create(olga, draft("Board Games", Date.now() + 4 * DAY, 3 * HOUR, venue("Game Room", "7 Dice Rd")));
    const add = (who: Person, notify: boolean, requestId = randomUUID()) =>
      ada.call("addEventAttendeeV1", { contractVersion: 1, companyId: companyA, requestId, eventId: gamesId, userId: who.uid, notify });
    const requestId = randomUUID();
    const sent = await expectEmails("admin add", [[quinn, "attendee_added"], [quinn, "calendar_invite"]], () => add(quinn, true, requestId));
    const added = one(sent, quinn, "attendee_added");
    assert.equal(added.subject, "You were added to Board Games");
    assert.ok(added.text.includes("Game Room") && added.text.includes("7 Dice Rd"), "Where row on the added email");
    await expectEmails("admin add replay", [], () => add(quinn, true, requestId));
    await expectEmails("admin add without notice", [[sam, "calendar_invite"]], () => add(sam, false));
    await expectEmails("admin adds themself", [[ada, "calendar_invite"]], () => add(ada, true));
  });

  // --- Reminders (scheduler job, production adapters, real clock) -------------------------------------------------
  const store = new FirestoreNotificationsStore(db);
  const emailStore = new FirestoreEmailStore(db);
  const runReminders = () => sendDueRemindersViaRouter({
    store, recipients: store, upcoming: store, messaging: new EmulatorOutboxMessaging(db), devices: store,
    preferences: cachedPreferences(new FirestorePreferences(db)), receipts: new FirestoreDeliveryReceipts(db),
    rateLimiter: new FirestorePushRateLimiter(db), members: new FirestoreMembership(db), locales: new FirestoreLocales(db),
    inbox: store, clock: { now: () => new Date() },
    email: routerEmailChannel({
      outbox: emailStore.outbox, companies: emailStore.companies, preferences: emailStore.preferences,
      clock: { now: () => new Date() }, validate: validateVariables, config: { enabled: true },
    }),
  } as never);

  let runId = "";
  await t.test("24 h reminder email: on by default for everyone going, in their language; the per-event level still applies", async () => {
    runId = await create(olga, draft("Morning Run", Date.now() + 23 * HOUR, HOUR, venue("River Trail", "1 Riverside Dr")));
    for (const who of [rita, sam, pete, quinn]) await expectEmails(`join run ${who.key}`, [[who, "calendar_invite"]], () => rsvp(who, runId, "going"));
    await subscribed(runId, [rita, sam, pete, quinn]);
    // Sam turned this activity's notifications off (per-event override).
    await subscription(runId, sam).set({ level: "none", updatedAt: Timestamp.now() });
    const sent = await expectEmails("24 h reminders", [[rita, "event_reminder"], [pete, "event_reminder"], [quinn, "event_reminder"]], runReminders);
    const english = one(sent, quinn, "event_reminder");
    assert.equal(english.subject, "Tomorrow: Morning Run");
    assert.ok(english.text.includes("River Trail") && english.text.includes("1 Riverside Dr"), "Where row");
    assert.match(english.text, /CST/, "company zone");
    assert.match(english.text, /day-before reminder emails are on/, "footer names the day-before switch");
    assert.equal(one(sent, rita, "event_reminder").subject, "Mañana: Morning Run");
    const doc = (await outboxOf(quinn.uid)).find((d) => d.template === "event_reminder")!;
    assert.equal(doc.category, "day_before_reminders");
    assert.equal((doc.notAfter as any).toMillis(), (await eventDoc(runId).get()).get("startTime").toMillis(), "never sent after the start");
    await expectEmails("24 h reminders, second scheduler run", [], runReminders);
  });

  await t.test("1 h reminder email: off by default, sent to members who opted in", async () => {
    const walkId = await create(olga, draft("Lunch Walk", Date.now() + 50 * 60_000, HOUR, venue("Main Lobby", "100 Office Pl")));
    for (const who of [rita, quinn]) await expectEmails(`join walk ${who.key}`, [[who, "calendar_invite"]], () => rsvp(who, walkId, "going"));
    await subscribed(walkId, [rita, quinn]);
    await prefs(quinn, { reminders: true });
    const sent = await expectEmails("1 h reminders", [[quinn, "event_reminder"]], runReminders);
    assert.equal(one(sent, quinn, "event_reminder").subject, "Starting in about an hour: Lunch Walk");
    await expectEmails("1 h reminders, second scheduler run", [], runReminders);
  });

  await t.test("one-click unsubscribe turns off exactly that switch, and the next email of that kind is not sent", async () => {
    const answered = (await readAll()).find((s) => s.toHash === sam.hash && s.template === "invite_answered")!;
    const token = answered.headers["List-Unsubscribe"]!.slice(1, -1).split("/u/")[1]!;
    const response = await fetch(`${functionsBase}/emailUnsubscribeV1/u/${token}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    });
    assert.equal(response.status, 200);
    const email = (await db.doc(`users/${sam.uid}/settings/notifications`).get()).get("email") as Record<string, boolean>;
    assert.equal(email.invites, false);
    assert.equal(email.event_updates, undefined, "other switches untouched");
    await expectEmails("invite after unsubscribe", [], async () => {
      await rita.call("sendInviteV1", { contractVersion: 1, companyId: companyA, eventId: potteryId, toUserId: sam.uid, message: "", requestId: `inv-${stamp}-3` });
    });
    const reminder = (await readAll()).find((s) => s.toHash === rita.hash && s.template === "event_reminder")!;
    const reminderToken = reminder.headers["List-Unsubscribe"]!.slice(1, -1).split("/u/")[1]!;
    assert.equal((await fetch(`${functionsBase}/emailUnsubscribeV1/u/${reminderToken}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    })).status, 200);
    const ritaEmail = (await db.doc(`users/${rita.uid}/settings/notifications`).get()).get("email") as Record<string, boolean>;
    assert.deepEqual(ritaEmail, { day_before_reminders: false });
  });

  // --- Weekly theme: review emails and the opt-in announcement ------------------------------------------------------
  const themeId = `theme-${stamp}`;
  await t.test("submission reviewed: approved and changes requested email the submitter only when push will not reach them", async () => {
    await db.doc(`companies/${companyA}/challenges/${themeId}`).set({
      companyId: companyA, title: "Hydration Week", description: "Drink water every day this week.", tagIds: [], type: "weekly",
      goal: 5, goalUnit: "glasses", coverImageURL: "catalog://theme/fitness", startDate: Timestamp.fromMillis(Date.now() - HOUR),
      endDate: Timestamp.fromMillis(Date.now() + 6 * DAY), pointsReward: 20, participantCount: 0, completedCount: 0, revision: 1,
    });
    await pete.call("registerDeviceV1", { contractVersion: 1, token: `e2e-token-${stamp}`, platform: "ios", appVersion: "1.0 (1)" });
    for (const who of [rita, pete, quinn]) await who.call("submitChallengeV1", { contractVersion: 1, companyId: companyA, challengeId: themeId, progress: 5, caption: "Done" });
    const review = (command: string, who: Person, extra: Record<string, unknown> = {}) =>
      ada.call(command, { contractVersion: 1, companyId: companyA, challengeId: themeId, userId: who.uid, ...extra });
    const approved = await expectEmails("approve", [[rita, "challenge_reviewed"]], () => review("approveChallengeV1", rita));
    assert.equal(one(approved, rita, "challenge_reviewed").subject, "Aprobada: Hydration Week");
    const changes = await expectEmails("changes requested", [[quinn, "challenge_reviewed"]], () => review("rejectChallengeV1", quinn, { reason: "Add a photo" }));
    const mail = one(changes, quinn, "challenge_reviewed");
    assert.equal(mail.subject, "Changes requested: Hydration Week");
    assert.ok(!mail.text.includes("Add a photo"), "the reviewer's reason is never emailed");
    await expectEmails("push covers a member with a device", [], () => review("approveChallengeV1", pete));
    await expectEmails("approve replay", [], () => review("approveChallengeV1", rita));
  });

  await t.test("weekly theme email: off by default, one per opted-in member, rerun sends nothing", async () => {
    const themes = new FirestoreThemes(db);
    const run = () => runWeeklyThemeEmails({
      themes, members: themes, companies: emailStore.companies, preferences: emailStore.preferences,
      enqueue: { outbox: emailStore.outbox, clock: { now: () => new Date() }, validate: validateVariables },
      config: { enabled: true }, now: () => new Date(),
    });
    await expectEmails("weekly theme, nobody opted in", [], run);
    await prefs(ada, { weekly_themes: true });
    await prefs(rita, { weekly_themes: true });
    const sent = await expectEmails("weekly theme", [[ada, "weekly_theme"], [rita, "weekly_theme"]], run);
    assert.equal(one(sent, ada, "weekly_theme").subject, "This week's theme: Hydration Week");
    assert.equal(one(sent, rita, "weekly_theme").subject, "Tema de la semana: Hydration Week");
    assert.ok(one(sent, ada, "weekly_theme").html.includes("img/email/ideas/fitness.png"), "theme art");
    await expectEmails("weekly theme rerun", [], run);
  });

  // --- Roster invitation, digest, problem report ---------------------------------------------------------------------
  const newbieEmail = `newbie.${stamp}@${domainOf[companyA]}`;
  const newbie = { hash: sha(newbieEmail) };
  extraNames.set(newbie.hash, "newbie(roster)");
  let entryId = "";
  await t.test("roster invitation: one email to the roster address in the admin's language, refused again within the hour", async () => {
    entryId = (await ada.call("upsertRosterEntryV1", { contractVersion: 1, companyId: companyA, requestId: randomUUID(),
      entry: { email: newbieEmail, displayName: "Nia Newbie", role: "organizer" } })).entryId;
    assert.equal(entryId, newbie.hash);
    const sent = await expectEmails("roster invite", [[newbie, "roster_invite"]],
      () => ada.call("sendRosterInviteEmailV1", { contractVersion: 1, companyId: companyA, requestId: randomUUID(), entryId }));
    const mail = one(sent, newbie, "roster_invite");
    assert.equal(mail.subject, "Ada invited you to join Acme E2E on DIP");
    assert.ok(mail.text.includes("[recipient]"), "the sign-in address is in the email (redacted in the emulator record)");
    assert.ok(mail.html.includes("https://letsdip.work/admin/"), "organizers get the admin portal button");
    assert.ok(!JSON.stringify(mail).includes(newbieEmail));
    await expectEmails("roster invite too soon", [], () => assert.rejects(
      ada.call("sendRosterInviteEmailV1", { contractVersion: 1, companyId: companyA, requestId: randomUUID(), entryId }),
      (e: any) => e.details?.reason === "INVITE_EMAIL_TOO_SOON"));
  });

  let nia!: Person;
  await t.test("the invited person's first sign-in claims the roster entry and sends one welcome with the portal step", async () => {
    const got = await expectEmails("roster claim", () => [[nia, "welcome"]], async () => { nia = await join("nia", "Nia Newbie", companyA, `newbie.${stamp}`); });
    assert.equal(got[0]!.toHash, newbie.hash, "the roster address and the account address are the same person");
    assert.ok(got[0]!.html.includes("https://letsdip.work/admin/"), "organizer welcome points at the admin portal");
    assert.equal((await db.doc(`companies/${companyA}/roster/${entryId}`).get()).get("status"), "claimed");
  });

  await t.test("admin roster digest: off by default; one email the next local morning to the admin who opted in", async () => {
    const tomorrow9 = (() => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date()).map((p) => [p.type, p.value]));
      // 09:00 America/Chicago (CST, UTC-6) on the next local day.
      return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1, 15, 0, 0));
    })();
    const run = () => runAdminDigests({
      source: new FirestoreDigestSource(db), companies: emailStore.companies, preferences: emailStore.preferences,
      enqueue: { outbox: emailStore.outbox, clock: { now: () => new Date() }, validate: validateVariables },
      config: { enabled: true, defaultTimeZone: "America/New_York" },
    }, tomorrow9);
    await expectEmails("digest, nobody opted in", [], run);
    await prefs(ada, { admin_digest: true });
    const sent = await expectEmails("digest", [[ada, "admin_digest"]], run);
    const mail = one(sent, ada, "admin_digest");
    assert.match(mail.subject, /^DIP roster update for /);
    assert.ok(mail.text.includes("Nia Newbie"), "the invited person who joined");
    await expectEmails("digest rerun", [], run);
  });

  await t.test("problem report resolved: one email to the reporter, never twice", async () => {
    const reportId = `report-${stamp}`;
    await db.doc(`bugReports/${reportId}`).set({ uid: rita.uid, category: "bug", description: "Private report text", createdAt: Timestamp.now(), platform: "ios", appVersion: "1.0 (1)" });
    const triage = (status: string) => ada.call("updateBugReportV1", { contractVersion: 1, companyId: companyA, requestId: randomUUID(), reportId, status });
    const sent = await expectEmails("resolved", [[rita, "bug_report_resolved"]], () => triage("resolved"));
    const mail = one(sent, rita, "bug_report_resolved");
    assert.equal(mail.subject, "Se resolvió el problema que reportaste");
    assert.ok(!mail.text.includes("Private report text"), "never the report text");
    await expectEmails("reopen and resolve again", [], async () => { await triage("triaged"); await triage("resolved"); });
  });

  // --- Whole-run invariants ----------------------------------------------------------------------------------------
  await t.test("whole run: one message per outbox document, tenant isolation, nothing after deactivation, no failures", async () => {
    await quiet();
    const all = await readAll();
    const perOutbox = new Map<string, number>();
    for (const s of all) perOutbox.set(s.outboxId, (perOutbox.get(s.outboxId) ?? 0) + 1);
    assert.deepEqual([...perOutbox].filter(([, n]) => n !== 1), [], "every outbox document sent at most once");
    assert.deepEqual(all.filter((s) => s.toHash === bob.hash).map((s) => s.template), ["welcome"], "the other company's member got only their welcome");
    const deeSends = all.filter((s) => s.toHash === dee.hash).map((s) => s.template).sort();
    assert.deepEqual(deeSends, ["calendar_invite", "welcome"], "nothing after deactivation");
    const outbox = (await db.collection("emailOutbox").get()).docs.map((d) => d.data()).filter((d) => [companyA, companyB, companyC].includes(d.companyId));
    assert.deepEqual(outbox.filter((d) => !["sent", "skipped", "expired"].includes(d.status)).map((d) => `${d.template}:${d.status}:${d.reason}`), [],
      "no outbox document failed, stuck or ended unknown");
  });
});
