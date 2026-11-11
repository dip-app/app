import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Timestamp, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, deleteDoc,
} from "firebase/firestore";

// Event photo albums: Storage upload/read rules (cross-service) and Firestore album + comment rules.
let env: RulesTestEnvironment;
const company = "album-alpha";
const other = "album-beta";
const HOUR = 3_600_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const profile = (c: string, name: string) => ({ companyId: c, role: "member", displayName: name, avatarId: `avatar-${name}` });
const event = (c: string, status: string, startOffset: number, endOffset: number) => ({
  companyId: c, title: "Boat ride", status, startTime: Timestamp.fromMillis(Date.now() + startOffset),
  endTime: Timestamp.fromMillis(Date.now() + endOffset), attendeeCount: 2, capacity: 10, revision: 1,
});
const rsvp = (c: string, eventId: string, userId: string, status: string) => ({ companyId: c, eventId, userId, status });
const photoDoc = (uploaderId: string, c = company) => ({
  companyId: c, eventId: "past", eventTitle: "Boat ride", eventDate: Timestamp.now(), uploaderId, uploaderName: "Going",
  uploaderAvatarId: "avatar-Going", storagePath: `companies/${c}/events/past/photos/${uploaderId}/0`, downloadURL: "",
  caption: "", commentCount: 0, createdAt: Timestamp.now(),
});
const comment = (uid: string, name: string, overrides: Record<string, unknown> = {}) => ({
  companyId: company, photoId: "album-going_0", authorId: uid, authorName: name, authorAvatarId: `avatar-${name}`,
  text: "Great day", createdAt: serverTimestamp(), ...overrides,
});
const objectPath = (eventId: string, uid: string, slot: string | number, c = company) => `companies/${c}/events/${eventId}/photos/${uid}/${slot}`;
const fs = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const st = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).storage();
const upload = (storage: ReturnType<typeof st>, path: string, bytes: Uint8Array = JPEG, contentType = "image/jpeg") =>
  storage.ref(path).put(bytes, { contentType });
let counter = 0;
const commentId = () => `client-comment-${Date.now()}-${++counter}`;
const comments = `companies/${company}/events/past/photos/album-going_0/comments`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-dip",
    firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") },
    storage: { host: "127.0.0.1", port: 9199, rules: readFileSync("gcp/storage.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await store.doc("users/album-going").set(profile(company, "Going"));
    await store.doc("users/album-coworker").set(profile(company, "Coworker"));
    await store.doc("users/album-left").set(profile(company, "Left"));
    await store.doc("users/album-outsider").set(profile(other, "Outsider"));
    for (const [eventId, data] of Object.entries({
      past: event(company, "scheduled", -5 * HOUR, -2 * HOUR),
      live: event(company, "scheduled", -1 * HOUR, 1 * HOUR),
      cancelled: event(company, "cancelled", -5 * HOUR, -2 * HOUR),
    })) {
      await store.doc(`companies/${company}/events/${eventId}`).set(data);
      await store.doc(`companies/${company}/events/${eventId}/rsvps/album-going`).set(rsvp(company, eventId, "album-going", "going"));
    }
    await store.doc(`companies/${company}/events/past/rsvps/album-left`).set(rsvp(company, "past", "album-left", "cancelled"));
    await store.doc(`companies/${other}/events/x`).set(event(other, "scheduled", -5 * HOUR, -2 * HOUR));
    await store.doc(`companies/${other}/events/x/rsvps/album-outsider`).set(rsvp(other, "x", "album-outsider", "going"));
    // A forged-looking RSVP row (wrong companyId field) must not open uploads.
    await store.doc(`companies/${company}/events/past/rsvps/album-outsider`).set(rsvp(other, "past", "album-outsider", "going"));
    await store.doc(`companies/${company}/events/past/photos/album-going_0`).set(photoDoc("album-going"));
    await store.doc(`${comments}/seeded`).set({ ...comment("album-coworker", "Coworker"), createdAt: Timestamp.now() });
    // Slot 19 is published (album document exists); slot 17 was uploaded but never finalized.
    await store.doc(`companies/${company}/events/past/photos/album-going_19`).set(photoDoc("album-going"));
    await context.storage().ref(objectPath("past", "album-going", 19)).put(JPEG, { contentType: "image/jpeg" });
    await context.storage().ref(objectPath("past", "album-going", 17)).put(JPEG, { contentType: "image/jpeg" });
  });
});
after(async () => { await env?.cleanup(); });

// --- Storage ---

test("a going attendee uploads an image into their own slot after the event ended", async () => {
  await assertSucceeds(upload(st("album-going"), objectPath("past", "album-going", 0)));
  await assertSucceeds(upload(st("album-going"), objectPath("past", "album-going", 1), new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png"));
  await assertSucceeds(upload(st("album-going"), objectPath("past", "album-going", 2), new Uint8Array([1, 2, 3]), "image/heic"));
});

test("objects are create-only: no overwrite and no client delete", async () => {
  await assertFails(upload(st("album-going"), objectPath("past", "album-going", 19)));
  await assertFails(st("album-going").ref(objectPath("past", "album-going", 19)).delete());
  await assertFails(st("album-going").ref(objectPath("past", "album-going", 19)).updateMetadata({ contentType: "image/png" }));
});

test("size and type limits are enforced on upload", async () => {
  await assertFails(upload(st("album-going"), objectPath("past", "album-going", 3), new Uint8Array(10 * 1024 * 1024 + 1)));
  await assertFails(upload(st("album-going"), objectPath("past", "album-going", 4), new Uint8Array()));
  for (const type of ["image/gif", "application/pdf", "text/plain", "image/jpeg; x=1", "video/mp4"]) {
    await assertFails(upload(st("album-going"), objectPath("past", "album-going", 5), JPEG, type));
  }
  // Exactly 10 MiB is accepted.
  await assertSucceeds(upload(st("album-going"), objectPath("past", "album-going", 6), new Uint8Array(10 * 1024 * 1024)));
});

test("only slots 0..19 exist", async () => {
  for (const slot of ["20", "99", "-1", "0.jpg", "a", "01", "photo"]) {
    await assertFails(upload(st("album-going"), objectPath("past", "album-going", slot)));
  }
  await assertFails(upload(st("album-going"), `companies/${company}/events/past/photos/album-going/7/nested`));
});

test("uploads into another member's folder are denied", async () => {
  await assertFails(upload(st("album-coworker"), objectPath("past", "album-going", 8)));
  await assertFails(upload(st("album-going"), objectPath("past", "album-coworker", 8)));
});

test("non-attendees, cancelled RSVPs, unverified and signed-out callers cannot upload", async () => {
  await assertFails(upload(st("album-coworker"), objectPath("past", "album-coworker", 0)));
  await assertFails(upload(st("album-left"), objectPath("past", "album-left", 0)));
  await assertFails(upload(st("album-going", false), objectPath("past", "album-going", 9)));
  await assertFails(upload(env.unauthenticatedContext().storage(), objectPath("past", "album-going", 9)));
});

test("uploads are refused before the event ends and for cancelled events", async () => {
  await assertFails(upload(st("album-going"), objectPath("live", "album-going", 0)));
  await assertFails(upload(st("album-going"), objectPath("cancelled", "album-going", 0)));
  await assertFails(upload(st("album-going"), objectPath("missing", "album-going", 0)));
});

test("cross-company: an outsider cannot upload into or read another company's album", async () => {
  // The outsider has a (malformed) RSVP row in this company's event and a valid RSVP in their own company.
  await assertFails(upload(st("album-outsider"), objectPath("past", "album-outsider", 0)));
  await assertFails(st("album-outsider").ref(objectPath("past", "album-going", 19)).getMetadata());
  await assertFails(st("album-outsider").ref(objectPath("past", "album-going", 19)).getDownloadURL());
  // Their own company's album is open to them.
  await assertSucceeds(upload(st("album-outsider"), objectPath("x", "album-outsider", 0, other)));
  await assertFails(upload(st("album-going"), objectPath("x", "album-going", 0, other)));
});

test("same-company members read album objects; listing folders stays denied", async () => {
  await assertSucceeds(st("album-coworker").ref(objectPath("past", "album-going", 19)).getMetadata());
  await assertSucceeds(st("album-going").ref(objectPath("past", "album-going", 19)).getMetadata());
  await assertFails(st("album-going", false).ref(objectPath("past", "album-going", 19)).getMetadata());
  await assertFails(env.unauthenticatedContext().storage().ref(objectPath("past", "album-going", 19)).getMetadata());
  await assertFails(st("album-going").ref(`companies/${company}/events/past/photos/album-going`).listAll());
});

test("unpublished objects are readable only by their uploader, never by colleagues", async () => {
  await assertSucceeds(st("album-going").ref(objectPath("past", "album-going", 17)).getMetadata());
  await assertFails(st("album-coworker").ref(objectPath("past", "album-going", 17)).getMetadata());
  await assertFails(st("album-coworker").ref(objectPath("past", "album-going", 17)).getDownloadURL());
  await assertFails(st("album-outsider").ref(objectPath("past", "album-going", 17)).getMetadata());
});

// --- Firestore album documents ---

test("same-company members read album documents with bounded lists", async () => {
  const album = collection(fs("album-coworker"), `companies/${company}/events/past/photos`);
  await assertSucceeds(getDocs(query(album, orderBy("createdAt", "desc"), limit(100))));
  await assertSucceeds(getDoc(doc(fs("album-coworker"), `companies/${company}/events/past/photos/album-going_0`)));
  await assertSucceeds(getDoc(doc(fs("album-coworker"), `companies/${company}/events/past/photos/missing`)));
  await assertFails(getDocs(query(album, orderBy("createdAt", "desc"))));
  await assertFails(getDocs(query(album, limit(101))));
});

test("album documents are denied across companies and to unverified callers", async () => {
  for (const client of [fs("album-outsider"), fs("album-going", false), env.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(client, `companies/${company}/events/past/photos/album-going_0`)));
    await assertFails(getDocs(query(collection(client, `companies/${company}/events/past/photos`), limit(10))));
  }
});

test("clients never write album documents or their server-owned counts", async () => {
  const ref = (uid: string) => doc(fs(uid), `companies/${company}/events/past/photos/album-going_0`);
  await assertFails(updateDoc(ref("album-going"), { commentCount: 99 }));
  await assertFails(updateDoc(ref("album-going"), { caption: "edited" }));
  await assertFails(deleteDoc(ref("album-going")));
  await assertFails(setDoc(doc(fs("album-going"), `companies/${company}/events/past/photos/album-going_5`), photoDoc("album-going")));
});

// --- Firestore comments ---

test("a same-company member appends a valid own comment and reads the bounded thread", async () => {
  await assertSucceeds(setDoc(doc(fs("album-coworker"), `${comments}/${commentId()}`), comment("album-coworker", "Coworker")));
  await assertSucceeds(setDoc(doc(fs("album-going"), `${comments}/${commentId()}`), comment("album-going", "Going", { text: "x".repeat(2000) })));
  await assertSucceeds(getDocs(query(collection(fs("album-coworker"), comments), orderBy("createdAt"), limit(100))));
  await assertSucceeds(getDoc(doc(fs("album-coworker"), `${comments}/seeded`)));
  await assertSucceeds(getDoc(doc(fs("album-coworker"), `${comments}/never-written`)));
  await assertFails(getDocs(query(collection(fs("album-coworker"), comments), orderBy("createdAt"))));
});

test("comments enforce author ownership, exact fields, trimmed bounded text and a server timestamp", async () => {
  const write = (data: Record<string, unknown>, id = commentId()) => setDoc(doc(fs("album-coworker"), `${comments}/${id}`), data);
  await assertFails(write(comment("album-going", "Going")));
  await assertFails(write(comment("album-coworker", "Someone else")));
  await assertFails(write(comment("album-coworker", "Coworker", { authorAvatarId: "avatar-forged" })));
  await assertFails(write(comment("album-coworker", "Coworker", { text: "" })));
  await assertFails(write(comment("album-coworker", "Coworker", { text: " padded " })));
  await assertFails(write(comment("album-coworker", "Coworker", { text: "x".repeat(2001) })));
  await assertFails(write(comment("album-coworker", "Coworker", { createdAt: Timestamp.fromMillis(Date.now() - HOUR) })));
  await assertFails(write(comment("album-coworker", "Coworker", { photoId: "album-going_1" })));
  await assertFails(write(comment("album-coworker", "Coworker", { companyId: other })));
  await assertFails(write({ ...comment("album-coworker", "Coworker"), likes: 3 }));
  await assertFails(write(comment("album-coworker", "Coworker"), "short"));
  await assertFails(write(comment("album-coworker", "Coworker"), "has space in id"));
});

test("comments need an existing photo, are append-only and closed to other companies", async () => {
  const missing = `companies/${company}/events/past/photos/missing_0/comments/${commentId()}`;
  await assertFails(setDoc(doc(fs("album-coworker"), missing), comment("album-coworker", "Coworker", { photoId: "missing_0" })));
  await assertFails(updateDoc(doc(fs("album-coworker"), `${comments}/seeded`), { text: "edited" }));
  await assertFails(deleteDoc(doc(fs("album-coworker"), `${comments}/seeded`)));
  await assertFails(setDoc(doc(fs("album-outsider"), `${comments}/${commentId()}`), {
    ...comment("album-outsider", "Outsider"), companyId: company }));
  await assertFails(getDocs(query(collection(fs("album-outsider"), comments), limit(10))));
  await assertFails(setDoc(doc(fs("album-coworker", false), `${comments}/${commentId()}`), comment("album-coworker", "Coworker")));
});
