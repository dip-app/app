import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { addEventAttendee, recordAttendance, removeEventAttendee } from "../../functions/src/modules/admin/application/attendees";
import { photoObjectPath, removeEventPhoto, removeEventPhotoComment } from "../../functions/src/modules/admin/application/moderation";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { caller, makeDeps, NOW, rid, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";

const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");
const organizer = caller("org1");

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}
const audits = (store: FakeAdminStore) => store.children("companies/alpha/auditLog").map(c => c.data);

function seedAlbum(store: FakeAdminStore, comments = 3) {
  store.seed("companies/alpha/events/past/photos/m1_0", { companyId: "alpha", eventId: "past", eventTitle: "Boat Ride", uploaderId: "m1", uploaderName: "Mia Member", caption: "Sunny", commentCount: comments });
  for (let i = 0; i < comments; i++) {
    store.seed(`companies/alpha/events/past/photos/m1_0/comments/c${i}`, { companyId: "alpha", photoId: "m1_0", authorId: "m2", authorName: "Max Member", text: `Nice ${i}` });
  }
}

describe("removeEventPhotoV1", () => {
  const request = (extra: Record<string, unknown> = {}) => ({ ...base, requestId: rid(), eventId: "past", photoId: "m1_0", reason: "Inappropriate", ...extra });

  test("deletes the photo, its comments and the storage object, frees the slot and audits", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store); seedAlbum(store);
    const result = await removeEventPhoto(deps, admin, request());
    assert.deepEqual(result, { contractVersion: 1, photoId: "m1_0", removed: true, commentsRemoved: 3, objectRemoved: true });
    assert.equal(store.get("companies/alpha/events/past/photos/m1_0"), undefined);
    assert.equal(store.children("companies/alpha/events/past/photos/m1_0/comments").length, 0);
    assert.deepEqual(objects.removed, ["companies/alpha/events/past/photos/m1/0"]);
    const [entry] = audits(store);
    assert.equal(entry!.action, "photo.remove");
    assert.equal(entry!.actorId, "admin1");
    assert.equal(entry!.actorName, "Ada Admin");
    assert.equal(entry!.reason, "Inappropriate");
    assert.equal(entry!.targetId, "past/m1_0");
  });

  test("an organizer may moderate", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedAlbum(store, 0);
    assert.equal((await removeEventPhoto(deps, organizer, request())).removed, true);
  });

  test("a replay returns the same result and appends no second audit entry; a reused key with other content fails", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store); seedAlbum(store);
    const body = request();
    const first = await removeEventPhoto(deps, admin, body);
    const writes = store.writes;
    const second = await removeEventPhoto(deps, admin, body);
    assert.deepEqual(second, first);
    assert.equal(audits(store).length, 1);
    assert.equal(store.writes, writes, "no further writes");
    assert.equal(objects.removed.length, 2, "cleanup is idempotent and re-runs");
    await fails(removeEventPhoto(deps, admin, { ...body, photoId: "m1_1" }), "failed-precondition", "REQUEST_REUSED");
  });

  test("removing a missing photo is idempotent (removed:false) and writes no audit entry", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const result = await removeEventPhoto(deps, admin, request());
    assert.equal(result.removed, false);
    assert.equal(audits(store).length, 0);
  });

  test("more comments than one transaction batch are all removed by the cleanup", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedAlbum(store, 0);
    for (let i = 0; i < 950; i++) store.seed(`companies/alpha/events/past/photos/m1_0/comments/k${String(i).padStart(4, "0")}`, { companyId: "alpha", text: "x" });
    const result = await removeEventPhoto(deps, admin, request());
    assert.equal(result.commentsRemoved, 950);
    assert.equal(store.children("companies/alpha/events/past/photos/m1_0/comments").length, 0);
  });

  test("tenant isolation: another company's admin cannot touch the album, and an unknown event is EVENT_NOT_FOUND", async () => {
    const { deps, store, objects } = makeDeps();
    seedCompany(store); seedAlbum(store);
    await fails(removeEventPhoto(deps, caller("bo"), request()), "permission-denied", "COMPANY_MISMATCH");
    await fails(removeEventPhoto(deps, caller("bo"), request({ companyId: "beta" })), "not-found", "EVENT_NOT_FOUND");
    await fails(removeEventPhoto(deps, admin, request({ eventId: "nope" })), "not-found", "EVENT_NOT_FOUND");
    assert.ok(store.get("companies/alpha/events/past/photos/m1_0"));
    assert.equal(objects.removed.length, 0);
  });

  test("the storage path is derived from the slot-addressed photo id only", () => {
    assert.equal(photoObjectPath("alpha", "past", "m1_19"), "companies/alpha/events/past/photos/m1/19");
    assert.equal(photoObjectPath("alpha", "past", "m1_20"), null);
    assert.equal(photoObjectPath("alpha", "past", "weird"), null);
  });
});

describe("removeEventPhotoCommentV1", () => {
  const request = (extra: Record<string, unknown> = {}) => ({ ...base, requestId: rid(), eventId: "past", photoId: "m1_0", commentId: "c1", ...extra });

  test("deletes the comment, fixes commentCount and audits", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedAlbum(store);
    assert.deepEqual(await removeEventPhotoComment(deps, admin, request()), { contractVersion: 1, commentId: "c1", removed: true, commentCount: 2 });
    assert.equal(store.get("companies/alpha/events/past/photos/m1_0")!.commentCount, 2);
    assert.equal(audits(store)[0]!.action, "photo.comment.remove");
  });

  test("replay is idempotent; a missing comment reports removed:false; a missing photo is PHOTO_NOT_FOUND", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedAlbum(store);
    const body = request();
    const first = await removeEventPhotoComment(deps, admin, body);
    assert.deepEqual(await removeEventPhotoComment(deps, admin, body), first);
    assert.equal(audits(store).length, 1);
    assert.equal((await removeEventPhotoComment(deps, admin, request({ commentId: "ghost" }))).removed, false);
    await fails(removeEventPhotoComment(deps, admin, request({ photoId: "zed_0" })), "not-found", "PHOTO_NOT_FOUND");
  });

  test("concurrent removals of different comments keep the count exact", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); seedAlbum(store);
    await Promise.all([0, 1, 2].map(i => removeEventPhotoComment(deps, i === 0 ? admin : organizer, request({ commentId: `c${i}` }))));
    assert.equal(store.get("companies/alpha/events/past/photos/m1_0")!.commentCount, 0);
    assert.equal(store.children("companies/alpha/events/past/photos/m1_0/comments").length, 0);
  });
});

describe("addEventAttendeeV1 / removeEventAttendeeV1", () => {
  const add = (extra: Record<string, unknown> = {}) => ({ ...base, requestId: rid(), eventId: "soon", userId: "m1", ...extra });

  test("RSVPs the member as going with trusted snapshots, bumps the count, optionally notifies, and audits", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const result = await addEventAttendee(deps, admin, add({ notify: true, requestId: "notify-0001" }));
    assert.deepEqual(result, { contractVersion: 1, eventId: "soon", userId: "m1", added: true, attendeeCount: 1, capacity: 2, capacityOverridden: false, notified: true });
    const rsvp = store.get("companies/alpha/events/soon/rsvps/m1")!;
    assert.equal(rsvp.status, "going");
    assert.equal(rsvp.userName, "Mia Member");
    assert.equal(rsvp.source, "admin");
    assert.equal(rsvp.managedBy, "admin1");
    assert.equal(rsvp.checkedIn, false);
    assert.deepEqual(rsvp.eventStartTime, new Date("2030-01-03T10:00:00Z"));
    assert.equal(store.get("companies/alpha/events/soon")!.attendeeCount, 1);
    assert.equal(store.get("users/m1/notifications/admin_notify-0001")!.type, "attendee_added");
    assert.equal(audits(store)[0]!.action, "attendee.add");
  });

  test("no notification unless asked; a replay and an already-going member change nothing", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const body = add();
    const first = await addEventAttendee(deps, admin, body);
    assert.equal(first.notified, false);
    assert.equal(store.children("users/m1/notifications").length, 0);
    assert.deepEqual(await addEventAttendee(deps, admin, body), first);
    const again = await addEventAttendee(deps, organizer, add());
    assert.equal(again.added, false);
    assert.equal(store.get("companies/alpha/events/soon")!.attendeeCount, 1);
    assert.equal(audits(store).length, 1);
  });

  test("a full event needs a capacity override reason, which raises the capacity and is audited", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await addEventAttendee(deps, admin, add({ userId: "m1" }));
    await addEventAttendee(deps, admin, add({ userId: "m2" }));
    await fails(addEventAttendee(deps, admin, add({ userId: "m3" })), "resource-exhausted", "EVENT_FULL");
    const result = await addEventAttendee(deps, admin, add({ userId: "m3", capacityOverrideReason: "VIP guest" }));
    assert.equal(result.capacityOverridden, true);
    assert.equal(result.capacity, 3);
    const event = store.get("companies/alpha/events/soon")!;
    assert.equal(event.capacity, 3);
    assert.equal(event.attendeeCount, 3);
    assert.equal(event.revision, 2);
    assert.ok(audits(store).some(a => a.reason === "VIP guest" && (a.changes as any[]).some(c => c.field === "capacity")));
  });

  test("concurrent adds for the last seat admit exactly one member", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/events/soon", { ...store.get("companies/alpha/events/soon")!, capacity: 1 });
    const results = await Promise.allSettled([addEventAttendee(deps, admin, add({ userId: "m1" })), addEventAttendee(deps, organizer, add({ userId: "m2" }))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.equal((rejected.reason as AdminError).reason, "EVENT_FULL");
    assert.equal(store.get("companies/alpha/events/soon")!.attendeeCount, 1);
  });

  test("closed events, deactivated members and other tenants' users are refused", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await fails(addEventAttendee(deps, admin, add({ eventId: "cancelled" })), "failed-precondition", "EVENT_CLOSED");
    await fails(addEventAttendee(deps, admin, add({ eventId: "past" })), "failed-precondition", "EVENT_CLOSED");
    await fails(addEventAttendee(deps, admin, add({ userId: "deact" })), "not-found", "MEMBER_NOT_FOUND");
    await fails(addEventAttendee(deps, admin, add({ userId: "bea" })), "not-found", "MEMBER_NOT_FOUND");
    await fails(addEventAttendee(deps, admin, add({ eventId: "bevent" })), "not-found", "EVENT_NOT_FOUND");
    await fails(addEventAttendee(deps, admin, add({ capacityOverrideReason: "x" })), "invalid-argument", "VALIDATION_FAILED");
    assert.equal(store.children("companies/alpha/events/soon/rsvps").length, 0);
  });

  test("re-adding a cancelled attendee reuses the RSVP row and keeps attendance data", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/events/soon/rsvps/m1", { companyId: "alpha", eventId: "soon", userId: "m1", status: "cancelled", checkedIn: false, checkedInAt: null, userName: "Mia Member" });
    const result = await addEventAttendee(deps, admin, add());
    assert.equal(result.added, true);
    assert.equal(store.get("companies/alpha/events/soon/rsvps/m1")!.status, "going");
  });

  test("remove cancels the RSVP, decrements the count, optionally notifies and is idempotent", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await addEventAttendee(deps, admin, add());
    const body = { ...base, requestId: rid(), eventId: "soon", userId: "m1", notify: true, reason: "Duplicate sign-up" };
    const result = await removeEventAttendee(deps, organizer, body);
    assert.deepEqual(result, { contractVersion: 1, eventId: "soon", userId: "m1", removed: true, attendeeCount: 0, notified: true });
    assert.equal(store.get("companies/alpha/events/soon/rsvps/m1")!.status, "cancelled");
    assert.equal(store.get("companies/alpha/events/soon")!.attendeeCount, 0);
    assert.deepEqual(await removeEventAttendee(deps, organizer, body), result);
    const notGoing = await removeEventAttendee(deps, organizer, { ...body, requestId: rid() });
    assert.equal(notGoing.removed, false);
    assert.equal(store.get("companies/alpha/events/soon")!.attendeeCount, 0, "never below zero");
    assert.equal(audits(store).filter(a => a.action === "attendee.remove").length, 1);
  });

  test("an ended event's attendance cannot be removed; other tenants are refused", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("companies/alpha/events/past/rsvps/m1", { companyId: "alpha", eventId: "past", userId: "m1", status: "going", checkedIn: false });
    store.seed("companies/alpha/events/past", { ...store.get("companies/alpha/events/past")!, attendeeCount: 1 });
    await fails(removeEventAttendee(deps, admin, { ...base, requestId: rid(), eventId: "past", userId: "m1" }), "failed-precondition", "EVENT_CLOSED");
    await fails(removeEventAttendee(deps, admin, { ...base, requestId: rid(), eventId: "soon", userId: "bea" }), "not-found", "MEMBER_NOT_FOUND");
  });
});

describe("recordAttendanceV1", () => {
  const record = (extra: Record<string, unknown> = {}) => ({ ...base, eventId: "live", userId: "m1", ...extra });
  function going(store: FakeAdminStore, eventId = "live", checkedIn = false) {
    store.seed(`companies/alpha/events/${eventId}/rsvps/m1`, { companyId: "alpha", eventId, userId: "m1", status: "going", checkedIn, checkedInAt: null });
  }

  test("checks the attendee in once and awards the event's points exactly once", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); going(store);
    assert.deepEqual(await recordAttendance(deps, organizer, record()), { contractVersion: 1, eventId: "live", userId: "m1", pointsAwarded: 5, checkedIn: true, changed: true });
    assert.equal(store.get("companies/alpha/events/live/rsvps/m1")!.checkedIn, true);
    assert.deepEqual(store.get("companies/alpha/events/live/rsvps/m1")!.checkedInAt, NOW);
    assert.equal(store.get("users/m1")!.pointsBalance, 105);
    assert.equal(store.get("companies/alpha/pointTransactions/attendance_live_m1")!.amount, 5);
    const again = await recordAttendance(deps, admin, record());
    assert.equal(again.pointsAwarded, 0);
    assert.equal(again.changed, false);
    assert.equal(store.get("users/m1")!.pointsBalance, 105);
    assert.equal(audits(store).length, 1);
  });

  test("concurrent check-ins award once", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); going(store);
    const results = await Promise.all([recordAttendance(deps, admin, record()), recordAttendance(deps, organizer, record())]);
    assert.equal(results.reduce((n, r) => n + r.pointsAwarded, 0), 5);
    assert.equal(store.get("users/m1")!.pointsBalance, 105);
  });

  test("an event that has not started, a cancelled event and a non-attendee are refused", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); going(store, "soon"); going(store, "cancelled");
    await fails(recordAttendance(deps, admin, record({ eventId: "soon" })), "failed-precondition", "EVENT_NOT_STARTED");
    await fails(recordAttendance(deps, admin, record({ eventId: "cancelled" })), "failed-precondition", "EVENT_CLOSED");
    await fails(recordAttendance(deps, admin, record()), "failed-precondition", "NOT_GOING");
    await fails(recordAttendance(deps, admin, record({ userId: "bea" })), "not-found", "MEMBER_NOT_FOUND");
  });

  test("a no-show can be recorded before points, but not after they were awarded", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store); going(store, "past", true);
    const miss = await recordAttendance(deps, admin, record({ eventId: "past", checkedIn: false }));
    assert.equal(miss.changed, true);
    assert.equal(store.get("companies/alpha/events/past/rsvps/m1")!.checkedIn, false);
    going(store);
    await recordAttendance(deps, admin, record());
    await fails(recordAttendance(deps, admin, record({ checkedIn: false })), "failed-precondition", "ATTENDANCE_LOCKED");
  });
});
