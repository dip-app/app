import { strict as assert } from "node:assert";
import { test } from "node:test";
import { finalizeEventPhoto } from "../../functions/src/modules/photos/application/finalizeEventPhoto";
import type { Document, PhotoCaller, PhotoObjects, PhotoStore, PhotoTransaction } from "../../functions/src/modules/photos/application/ports";
import { PhotoError } from "../../functions/src/modules/photos/domain/errors";
import {
  MAX_PHOTO_BYTES, parseFinalizeRequest, photoStoragePath, sniffImageType, validateUpload,
} from "../../functions/src/modules/photos/domain/photoPolicy";
import { handleFinalizeEventPhoto, handlePhotoCommentCreated, toHttpsError } from "../../functions/src/modules/photos/transport/photoFunctions";
import type { StoredObject } from "../../functions/src/modules/photos/domain/photoPolicy";

const NOW = new Date("2030-01-02T12:00:00Z");
const now = () => NOW;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HEIC = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const caller = (uid = "alice"): PhotoCaller => ({ uid, emailVerified: true, signInProvider: "google.com" });
const path = (uid = "alice", slot = 0, c = "alpha", e = "boat") => photoStoragePath(c, e, uid, slot);
const request = (overrides: Record<string, unknown> = {}, uid = "alice", slot = 0) => ({
  contractVersion: 1, companyId: "alpha", eventId: "boat", photoId: `${uid}_${slot}`, storagePath: path(uid, slot), caption: "", ...overrides,
});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

/** Optimistic transaction double with version checks (real SDK evidence is in the emulator integration test). */
class Store implements PhotoStore {
  docs = new Map<string, { data: Document; version: number }>();
  writes = 0;
  private version = 0;
  seed(p: string, data: Document) { this.docs.set(p, { data: structuredClone(data), version: ++this.version }); }
  get(p: string) { return this.docs.get(p)?.data; }
  async runTransaction<T>(work: (tx: PhotoTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const seen = new Map<string, number>();
      const pending: [string, Document][] = [];
      const read = async (p: string) => {
        await tick();
        const entry = this.docs.get(p); seen.set(p, entry?.version ?? 0);
        return entry ? structuredClone(entry.data) : null;
      };
      const event = (c: string, e: string) => `companies/${c}/events/${e}`;
      const tx: PhotoTransaction = {
        getMember: u => read(`users/${u}`), getEvent: (c, e) => read(event(c, e)),
        getRsvp: (c, e, u) => read(`${event(c, e)}/rsvps/${u}`), getPhoto: (c, e, p) => read(`${event(c, e)}/photos/${p}`),
        createPhoto: (c, e, p, data) => { pending.push([`${event(c, e)}/photos/${p}`, { ...data, createdAt: "SERVER_TIME" }]); },
      };
      const result = await work(tx); await tick();
      if ([...seen].some(([p, v]) => (this.docs.get(p)?.version ?? 0) !== v)) continue;
      for (const [p, data] of pending) {
        if (this.docs.has(p)) throw new Error("ALREADY_EXISTS");
        this.seed(p, data); this.writes++;
      }
      return result;
    }
    throw new Error("contention");
  }
}

class Objects implements PhotoObjects {
  objects = new Map<string, StoredObject>();
  removed: string[] = [];
  inspected: string[] = [];
  put(p: string, head: Uint8Array = JPEG, contentType = "image/jpeg", size = 2048) { this.objects.set(p, { size, contentType, head }); }
  async inspect(p: string) { this.inspected.push(p); await tick(); return this.objects.get(p) ?? null; }
  async remove(p: string) { this.removed.push(p); this.objects.delete(p); }
}

function setup() {
  const store = new Store();
  const objects = new Objects();
  store.seed("users/alice", { companyId: "alpha", role: "member", displayName: "Alice", avatarId: "a1" });
  store.seed("users/bob", { companyId: "alpha", role: "member", displayName: "Bob", avatarId: "b1" });
  store.seed("users/olga", { companyId: "beta", role: "member", displayName: "Olga", avatarId: "o1" });
  const event = (end: string, status = "scheduled", c = "alpha") => ({
    companyId: c, title: "Boat Ride", status, startTime: new Date("2030-01-01T10:00:00Z"), endTime: new Date(end),
  });
  store.seed("companies/alpha/events/boat", event("2030-01-01T12:00:00Z"));
  store.seed("companies/alpha/events/live", event("2030-01-02T13:00:00Z"));
  store.seed("companies/alpha/events/cancelled", event("2030-01-01T12:00:00Z", "cancelled"));
  store.seed("companies/beta/events/boat", event("2030-01-01T12:00:00Z", "scheduled", "beta"));
  for (const e of ["boat", "live", "cancelled"]) {
    store.seed(`companies/alpha/events/${e}/rsvps/alice`, { companyId: "alpha", eventId: e, userId: "alice", status: "going" });
  }
  store.seed("companies/alpha/events/boat/rsvps/bob", { companyId: "alpha", eventId: "boat", userId: "bob", status: "cancelled" });
  store.seed("companies/beta/events/boat/rsvps/olga", { companyId: "beta", eventId: "boat", userId: "olga", status: "going" });
  objects.put(path());
  return { store, objects };
}

async function rejects(promise: Promise<unknown>, code: string, reason: string, fields?: string[]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PhotoError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.reason, reason);
    if (fields) assert.deepEqual([...error.fields], fields);
    return true;
  });
}

test("a going attendee finalizes an uploaded photo after the event; server owns every derived field", async () => {
  const { store, objects } = setup();
  const result = await finalizeEventPhoto(store, objects, caller(), request({ caption: "On the lake" }), now);
  assert.deepEqual(result, { contractVersion: 1, photoId: "alice_0", created: true });
  assert.deepEqual(store.get("companies/alpha/events/boat/photos/alice_0"), {
    companyId: "alpha", eventId: "boat", eventTitle: "Boat Ride", eventDate: new Date("2030-01-01T10:00:00Z"),
    uploaderId: "alice", uploaderName: "Alice", uploaderAvatarId: "a1", storagePath: path(), downloadURL: "",
    caption: "On the lake", commentCount: 0, sizeBytes: 2048, contentType: "image/jpeg", createdAt: "SERVER_TIME",
  });
});

test("replays are idempotent and concurrent finalizations create one document", async () => {
  const { store, objects } = setup();
  const results = await Promise.all(Array.from({ length: 5 }, () => finalizeEventPhoto(store, objects, caller(), request(), now)));
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(store.writes, 1);
  assert.deepEqual(await finalizeEventPhoto(store, objects, caller(), request(), now), { contractVersion: 1, photoId: "alice_0", created: false });
  assert.equal(store.writes, 1);
});

test("authentication, verified email and Google provider are required", async () => {
  const { store, objects } = setup();
  await rejects(finalizeEventPhoto(store, objects, null, request(), now), "unauthenticated", "UNAUTHENTICATED");
  await rejects(finalizeEventPhoto(store, objects, { ...caller(), emailVerified: false }, request(), now), "permission-denied", "EMAIL_NOT_VERIFIED");
  await rejects(finalizeEventPhoto(store, objects, { ...caller(), signInProvider: "password" }, request(), now), "permission-denied", "PROVIDER_NOT_ALLOWED");
  assert.equal(objects.inspected.length, 0);
});

test("tenant isolation: another company's member is refused before any event or object is read", async () => {
  const { store, objects } = setup();
  objects.put(path("olga", 0, "alpha"));
  await rejects(finalizeEventPhoto(store, objects, caller("olga"), request({}, "olga"), now), "permission-denied", "MEMBERSHIP_CONFLICT");
  await rejects(finalizeEventPhoto(store, objects, caller("olga"),
    request({ eventId: "missing", storagePath: photoStoragePath("alpha", "missing", "olga", 0) }, "olga"), now), "permission-denied", "MEMBERSHIP_CONFLICT");
  assert.equal(objects.inspected.length, 0);
  // Their own company works as usual.
  objects.put(photoStoragePath("beta", "boat", "olga", 3));
  assert.equal((await finalizeEventPhoto(store, objects, caller("olga"),
    { ...request({}, "olga", 3), companyId: "beta", storagePath: photoStoragePath("beta", "boat", "olga", 3) }, now)).created, true);
});

test("field ownership: photoId and storagePath must name the caller's own slot; unknown fields are rejected", async () => {
  const { store, objects } = setup();
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ photoId: "bob_0" }), now), "invalid-argument", "VALIDATION_FAILED", ["photoId"]);
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ storagePath: path("bob") }), now), "invalid-argument", "VALIDATION_FAILED", ["storagePath"]);
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ storagePath: path("alice", 1) }), now), "invalid-argument", "VALIDATION_FAILED", ["storagePath"]);
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ storagePath: photoStoragePath("beta", "boat", "alice", 0) }), now),
    "invalid-argument", "VALIDATION_FAILED", ["storagePath"]);
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ uploaderId: "bob", commentCount: 9, downloadURL: "https://x" }), now),
    "invalid-argument", "VALIDATION_FAILED", ["commentCount", "downloadURL", "uploaderId"]);
  for (const photoId of ["alice_20", "alice_-1", "alice_01", "alice", "alice_0.jpg"]) {
    await rejects(finalizeEventPhoto(store, objects, caller(), request({ photoId }), now), "invalid-argument", "VALIDATION_FAILED");
  }
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ caption: " padded" }), now), "invalid-argument", "VALIDATION_FAILED", ["caption"]);
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ caption: "x".repeat(281) }), now), "invalid-argument", "VALIDATION_FAILED", ["caption"]);
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ contractVersion: 2, companyId: "a/b" }), now),
    "invalid-argument", "VALIDATION_FAILED", ["companyId", "contractVersion"]);
  await rejects(finalizeEventPhoto(store, objects, caller(), [], now), "invalid-argument", "VALIDATION_FAILED");
  assert.equal(store.writes, 0);
});

test("eligibility: going RSVP, ended event, not cancelled, event exists", async () => {
  const { store, objects } = setup();
  objects.put(path("bob"));
  await rejects(finalizeEventPhoto(store, objects, caller("bob"), request({}, "bob"), now), "permission-denied", "NOT_ATTENDEE");
  const at = (e: string) => request({ eventId: e, storagePath: photoStoragePath("alpha", e, "alice", 0) });
  objects.put(photoStoragePath("alpha", "live", "alice", 0));
  objects.put(photoStoragePath("alpha", "cancelled", "alice", 0));
  await rejects(finalizeEventPhoto(store, objects, caller(), at("live"), now), "failed-precondition", "EVENT_NOT_ENDED");
  await rejects(finalizeEventPhoto(store, objects, caller(), at("cancelled"), now), "failed-precondition", "EVENT_CANCELLED");
  await rejects(finalizeEventPhoto(store, objects, caller(), at("missing"), now), "not-found", "EVENT_NOT_FOUND");
  assert.equal(store.writes, 0);
});

test("the uploaded object must exist and be a real accepted image; invalid objects are deleted", async () => {
  const { store, objects } = setup();
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ photoId: "alice_1", storagePath: path("alice", 1) }), now),
    "failed-precondition", "UPLOAD_NOT_FOUND");
  objects.put(path("alice", 2), new Uint8Array([0x47, 0x49, 0x46, 0x38]), "image/jpeg");
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ photoId: "alice_2", storagePath: path("alice", 2) }), now),
    "failed-precondition", "UPLOAD_INVALID");
  assert.deepEqual(objects.removed, [path("alice", 2)]);
  objects.put(path("alice", 3), JPEG, "image/jpeg", MAX_PHOTO_BYTES + 1);
  await rejects(finalizeEventPhoto(store, objects, caller(), request({ photoId: "alice_3", storagePath: path("alice", 3) }), now),
    "failed-precondition", "UPLOAD_INVALID");
  assert.equal(store.writes, 0);
});

test("a slot already published by someone else's data is a conflict, never overwritten", async () => {
  const { store, objects } = setup();
  store.seed("companies/alpha/events/boat/photos/alice_0", { companyId: "alpha", uploaderId: "alice", storagePath: "other/path" });
  await rejects(finalizeEventPhoto(store, objects, caller(), request(), now), "failed-precondition", "PHOTO_CONFLICT");
});

test("stored data that breaks invariants fails closed as internal", async () => {
  const { store, objects } = setup();
  store.seed("companies/alpha/events/boat", { companyId: "alpha", title: "Boat", status: "scheduled", startTime: null, endTime: null });
  await rejects(finalizeEventPhoto(store, objects, caller(), request(), now), "internal", "INVALID_STORED_DATA");
});

test("request parsing derives the slot only from the caller's own photoId", () => {
  assert.equal(parseFinalizeRequest(request({}, "alice", 19), "alice").slot, 19);
  assert.equal(parseFinalizeRequest({ ...request(), caption: undefined }, "alice").caption, "");
  assert.throws(() => parseFinalizeRequest(request({}, "alice", 0), "bob"));
});

test("file signatures must match the declared content type", () => {
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(HEIC), "image/heic");
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3])), null);
  assert.equal(validateUpload({ size: 10, contentType: "image/png", head: PNG }), "image/png");
  assert.equal(validateUpload({ size: 10, contentType: "image/heic", head: HEIC }), "image/heic");
  assert.throws(() => validateUpload({ size: 10, contentType: "image/png", head: JPEG }));
  assert.throws(() => validateUpload({ size: 10, contentType: null, head: JPEG }));
  assert.throws(() => validateUpload({ size: 0, contentType: "image/jpeg", head: JPEG }));
  assert.equal(validateUpload({ size: MAX_PHOTO_BYTES, contentType: "image/jpeg", head: JPEG }), "image/jpeg");
});

test("transport maps reasons without leaking internals", async () => {
  const { store, objects } = setup();
  await assert.rejects(handleFinalizeEventPhoto(store, objects, { auth: undefined, data: request() }, now), (error: any) => {
    assert.equal(error.code, "unauthenticated");
    assert.equal(error.details.reason, "UNAUTHENTICATED");
    return true;
  });
  const internal = toHttpsError(new Error("secret stack"));
  assert.equal(internal.code, "internal");
  assert.equal(internal.message, "Something went wrong. Try again later.");
  assert.equal(toHttpsError(new PhotoError("internal", "INVALID_STORED_DATA", "x")).code, "internal");
  const auth = { uid: "alice", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } } as any;
  assert.equal((await handleFinalizeEventPhoto(store, objects, { auth, data: request() }, now)).created, true);
});

test("comment trigger recounts the addressed photo only", async () => {
  const calls: string[][] = [];
  const counter = { recount: async (c: string, e: string, p: string) => { calls.push([c, e, p]); return true; } };
  await handlePhotoCommentCreated(counter, { companyId: "alpha", eventId: "boat", photoId: "alice_0", commentId: "x" });
  await handlePhotoCommentCreated(counter, { companyId: "alpha", eventId: "", photoId: "alice_0" });
  assert.deepEqual(calls, [["alpha", "boat", "alice_0"]]);
});
