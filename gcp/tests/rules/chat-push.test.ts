import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, serverTimestamp, setDoc, doc, collection, query, orderBy, limit, getDocs, updateDoc, deleteDoc, getDoc } from "firebase/firestore";

// Activity chat, notification preferences and server-only push data (notifications module).
let env: RulesTestEnvironment;
const company = "chat-alpha";
const other = "chat-beta";
const HOUR = 3_600_000;
const db = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const profile = (c: string, name: string) => ({ companyId: c, role: "member", displayName: name, avatarId: `avatar-${name}` });
const event = (status: string, startOffset: number, endOffset: number) => ({
  companyId: company, title: "Run", status, startTime: Timestamp.fromMillis(Date.now() + startOffset),
  endTime: Timestamp.fromMillis(Date.now() + endOffset), attendeeCount: 2, capacity: 10, revision: 1,
});
const rsvp = (userId: string, status: string, c = company) => ({ companyId: c, eventId: "open", userId, status });
const messages = (eventId = "open", c = company) => `companies/${c}/events/${eventId}/messages`;
const message = (uid: string, name: string, overrides: Record<string, unknown> = {}, eventId = "open") => ({
  companyId: company, eventId, authorId: uid, authorName: name, authorAvatarId: `avatar-${name}`,
  text: "On my way", createdAt: serverTimestamp(), ...overrides,
});
let counter = 0;
const id = () => `client-msg-${Date.now()}-${++counter}`;

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: {
    host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8"),
  }});
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await store.doc("users/going").set(profile(company, "Going"));
    await store.doc("users/coworker").set(profile(company, "Coworker"));
    await store.doc("users/left").set(profile(company, "Left"));
    await store.doc("users/bystander").set(profile(company, "Bystander"));
    await store.doc("users/outsider").set(profile(other, "Outsider"));
    for (const [eventId, data] of Object.entries({
      open: event("scheduled", 2 * HOUR, 3 * HOUR),
      cancelled: event("cancelled", 2 * HOUR, 3 * HOUR),
      recent: event("scheduled", -5 * HOUR, -2 * HOUR), // ended 2 h ago: still within the 24 h grace
      closed: event("scheduled", -30 * HOUR, -26 * HOUR), // ended 26 h ago: closed
    })) {
      await store.doc(`companies/${company}/events/${eventId}`).set(data);
      await store.doc(`companies/${company}/events/${eventId}/rsvps/going`).set({ ...rsvp("going", "going"), eventId });
    }
    await store.doc(`companies/${company}/events/open/rsvps/coworker`).set(rsvp("coworker", "going"));
    await store.doc(`companies/${company}/events/open/rsvps/left`).set(rsvp("left", "cancelled"));
    await store.doc(`companies/${company}/events/open/messages/seeded`).set({
      companyId: company, eventId: "open", authorId: "coworker", authorName: "Coworker", authorAvatarId: "avatar-Coworker",
      text: "Hello", createdAt: Timestamp.now(),
    });
    await store.doc(`companies/${other}/events/x`).set({ ...event("scheduled", 2 * HOUR, 3 * HOUR), companyId: other });
    await store.doc(`companies/${other}/events/x/rsvps/outsider`).set({ ...rsvp("outsider", "going", other), eventId: "x" });
    await store.doc("users/going/devices/abc").set({ token: "t", tokenHash: "abc", platform: "ios", appVersion: "1", updatedAt: Timestamp.now() });
    await store.doc(`companies/${company}/events/open/pushReceipts/chat_seeded`).set({ createdAt: Timestamp.now() });
  });
});
after(async () => { await env?.cleanup(); });

test("a going participant can create a valid own message and read the bounded history", async () => {
  await assertSucceeds(setDoc(doc(db("going"), `${messages()}/${id()}`), message("going", "Going")));
  await assertSucceeds(getDocs(query(collection(db("going"), messages()), orderBy("createdAt", "desc"), limit(100))));
  await assertSucceeds(getDoc(doc(db("going"), `${messages()}/seeded`)));
  // A missing message ID is observable, so a client can confirm whether an ambiguous retry landed.
  await assertSucceeds(getDoc(doc(db("going"), `${messages()}/never-written`)));
});

test("list queries must be bounded to at most 100", async () => {
  await assertFails(getDocs(query(collection(db("going"), messages()), orderBy("createdAt"))));
  await assertFails(getDocs(query(collection(db("going"), messages()), orderBy("createdAt"), limit(101))));
});

test("signed-out, unverified and other-company callers are denied", async () => {
  const anonymous = env.unauthenticatedContext().firestore();
  for (const client of [anonymous, db("going", false), db("outsider")]) {
    await assertFails(getDoc(doc(client, `${messages()}/seeded`)));
    await assertFails(getDocs(query(collection(client, messages()), limit(10))));
    await assertFails(setDoc(doc(client, `${messages()}/${id()}`), message("outsider", "Outsider")));
  }
  // The outsider's own going RSVP in another company does not open this company's chat.
  await assertFails(setDoc(doc(db("outsider"), `${messages("x", other)}/${id()}`), { ...message("outsider", "Outsider"), companyId: company }));
});

test("non-participants and cancelled RSVPs cannot read or write the chat", async () => {
  for (const uid of ["bystander", "left"]) {
    const name = uid === "left" ? "Left" : "Bystander";
    await assertFails(getDoc(doc(db(uid), `${messages()}/seeded`)));
    await assertFails(getDocs(query(collection(db(uid), messages()), limit(10))));
    await assertFails(setDoc(doc(db(uid), `${messages()}/${id()}`), message(uid, name)));
  }
});

test("author spoofing and forged display fields are denied", async () => {
  const client = db("going");
  await assertFails(setDoc(doc(client, `${messages()}/${id()}`), message("coworker", "Coworker")));
  await assertFails(setDoc(doc(client, `${messages()}/${id()}`), message("going", "Coworker")));
  await assertFails(setDoc(doc(client, `${messages()}/${id()}`), message("going", "Going", { authorAvatarId: "avatar-ceo" })));
  await assertFails(setDoc(doc(client, `${messages()}/${id()}`), message("going", "Going", { companyId: other })));
  await assertFails(setDoc(doc(client, `${messages()}/${id()}`), message("going", "Going", { eventId: "cancelled" })));
});

test("text, timestamp, field allowlist and message ID are validated", async () => {
  const client = db("going");
  const denied = [
    { text: "" }, { text: "   " }, { text: " padded " }, { text: "x".repeat(1001) }, { text: 42 },
    { createdAt: Timestamp.fromMillis(0) }, { attachments: [] }, { pinned: true },
  ];
  for (const patch of denied) await assertFails(setDoc(doc(client, `${messages()}/${id()}`), message("going", "Going", patch)));
  const { authorAvatarId: _omitted, ...missingField } = message("going", "Going");
  await assertFails(setDoc(doc(client, `${messages()}/${id()}`), missingField));
  await assertSucceeds(setDoc(doc(client, `${messages()}/${id()}`), message("going", "Going", { text: "x".repeat(1000) })));
  await assertFails(setDoc(doc(client, `${messages()}/short`), message("going", "Going")));
});

test("messages cannot be edited, deleted or overwritten by a retry with the same ID", async () => {
  const client = db("going");
  const messageId = id();
  await assertSucceeds(setDoc(doc(client, `${messages()}/${messageId}`), message("going", "Going")));
  await assertFails(setDoc(doc(client, `${messages()}/${messageId}`), message("going", "Going")));
  await assertFails(updateDoc(doc(client, `${messages()}/${messageId}`), { text: "edited" }));
  await assertFails(deleteDoc(doc(client, `${messages()}/${messageId}`)));
  await assertFails(deleteDoc(doc(db("coworker"), `${messages()}/seeded`)));
});

test("chat is closed for cancelled events and 24 h after the end; ended-event history stays readable", async () => {
  const client = db("going");
  await assertFails(setDoc(doc(client, `${messages("cancelled")}/${id()}`), message("going", "Going", {}, "cancelled")));
  await assertFails(setDoc(doc(client, `${messages("closed")}/${id()}`), message("going", "Going", {}, "closed")));
  await assertSucceeds(setDoc(doc(client, `${messages("recent")}/${id()}`), message("going", "Going", {}, "recent")));
  await assertSucceeds(getDocs(query(collection(client, messages("closed")), limit(50))));
  await assertFails(setDoc(doc(client, `${messages("missing")}/${id()}`), message("going", "Going", {}, "missing")));
});

test("subscription: owner with an RSVP (going or past) sets a valid level with a server timestamp", async () => {
  const path = (uid: string, eventId = "open") => `companies/${company}/events/${eventId}/subscriptions/${uid}`;
  await assertSucceeds(getDoc(doc(db("going"), path("going"))));
  for (const level of ["all", "changes", "reminders", "none"]) {
    await assertSucceeds(setDoc(doc(db("going"), path("going")), { level, updatedAt: serverTimestamp() }));
  }
  await assertSucceeds(setDoc(doc(db("left"), path("left")), { level: "none", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db("bystander"), path("bystander")), { level: "all", updatedAt: serverTimestamp() }));
});

test("subscription: invalid level, extra fields, client time, other users, other companies and deletes are denied", async () => {
  const path = (uid: string) => `companies/${company}/events/open/subscriptions/${uid}`;
  const client = db("going");
  await assertFails(setDoc(doc(client, path("going")), { level: "everything", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(client, path("going")), { level: "all", updatedAt: serverTimestamp(), unread: 0 }));
  await assertFails(setDoc(doc(client, path("going")), { level: "all", updatedAt: Timestamp.fromMillis(0) }));
  await assertFails(setDoc(doc(client, path("going")), { level: "all" }));
  await assertFails(setDoc(doc(client, path("coworker")), { level: "none", updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(client, path("coworker"))));
  await assertFails(getDocs(query(collection(client, `companies/${company}/events/open/subscriptions`), limit(10))));
  await assertFails(deleteDoc(doc(client, path("going"))));
  await assertFails(getDoc(doc(db("outsider"), path("outsider"))));
  await assertFails(setDoc(doc(db("outsider"), path("outsider")), { level: "all", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db("going", false), path("going")), { level: "all", updatedAt: serverTimestamp() }));
});

test("device registry, push receipts, outbox and the event changeLog are server-only", async () => {
  const client = db("going");
  await assertFails(getDoc(doc(client, "users/going/devices/abc")));
  await assertFails(getDocs(query(collection(client, "users/going/devices"), limit(10))));
  await assertFails(setDoc(doc(client, "users/going/devices/def"), { token: "t", platform: "ios", appVersion: "1", updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(client, "users/going/devices/abc")));
  await assertFails(getDoc(doc(client, `companies/${company}/events/open/pushReceipts/chat_seeded`)));
  await assertFails(setDoc(doc(client, `companies/${company}/events/open/pushReceipts/x`), { createdAt: serverTimestamp() }));
  await assertFails(getDocs(query(collection(client, "emulatorPushOutbox"), limit(10))));
  await assertFails(updateDoc(doc(client, `companies/${company}/events/open`), { changeLog: [] }));
  await assertFails(updateDoc(doc(client, `companies/${company}/events/open`), { messageCount: 1 }));
});
