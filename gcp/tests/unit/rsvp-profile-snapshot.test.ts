import { strict as assert } from "node:assert";
import { test } from "node:test";
import { refreshRsvpSnapshots, type ProfileSnapshotStore, type SnapshotUpdate } from "../../functions/src/modules/participation/application/refreshProfileSnapshots";
import { inRefreshWindow, profileSnapshot, snapshotChanged, snapshotPatch } from "../../functions/src/modules/participation/domain/profileSnapshot";

const now = new Date("2030-01-31T12:00:00Z");
const user = { companyId: "alpha", displayName: "Alex", avatarId: "av", department: "Engineering", jobTitle: "Software Engineer (Part-Time)" };

test("snapshot carries name, avatar, department and job title; missing optional fields become empty", () => {
  assert.deepEqual(profileSnapshot(user), { userName: "Alex", userAvatarId: "av", userDepartment: "Engineering", userJobTitle: "Software Engineer (Part-Time)" });
  assert.deepEqual(profileSnapshot({ displayName: "Sam" }), { userName: "Sam", userAvatarId: "", userDepartment: "", userJobTitle: "" });
  assert.equal(profileSnapshot({ displayName: "" }), null);
  assert.equal(profileSnapshot(undefined), null);
});

test("only edits to shown fields count as a change", () => {
  assert.equal(snapshotChanged(user, { ...user, jobTitle: "Lead" }), true);
  assert.equal(snapshotChanged(user, { ...user, department: "" }), true);
  assert.equal(snapshotChanged(user, { ...user, city: "Pittsburgh", pointsBalance: 5 }), false);
  assert.equal(snapshotChanged({}, user), true);
  assert.equal(snapshotChanged(user, { ...user, displayName: "" }), false);
});

test("patches contain only differing fields and are null when current", () => {
  const snap = profileSnapshot(user)!;
  assert.equal(snapshotPatch({ userName: "Alex", userAvatarId: "av", userDepartment: "Engineering", userJobTitle: "Software Engineer (Part-Time)" }, snap), null);
  assert.deepEqual(snapshotPatch({ userName: "Alex", userAvatarId: "av", userDepartment: "", status: "going" }, snap),
    { userDepartment: "Engineering", userJobTitle: "Software Engineer (Part-Time)" });
});

test("refresh window is 30 days back or in the future", () => {
  assert.equal(inRefreshWindow(new Date("2030-01-01T12:00:01Z"), now), true);
  assert.equal(inRefreshWindow(new Date("2029-12-01T00:00:00Z"), now), false);
  assert.equal(inRefreshWindow(new Date("2030-06-01T00:00:00Z"), now), true);
  assert.equal(inRefreshWindow(null, now), false);
});

class FakeStore implements ProfileSnapshotStore {
  applied: SnapshotUpdate[] = [];
  queried: string[] = [];
  constructor(private events: Array<{ eventId: string; endTime: Date | null }>, private rsvps: Record<string, Record<string, unknown>>) {}
  async recentEvents(companyId: string) { this.queried.push(companyId); return this.events; }
  async rsvpsFor(_c: string, _u: string, ids: string[]) {
    return ids.filter(id => this.rsvps[id]).map(id => ({ eventId: id, data: this.rsvps[id] }));
  }
  async applyUpdates(updates: SnapshotUpdate[]) { this.applied.push(...updates); }
}
const rsvp = (over: Record<string, unknown> = {}) => ({ companyId: "alpha", userId: "u1", userName: "Alex", userAvatarId: "av", userDepartment: "", status: "going", ...over });

test("a profile edit refreshes this user's stale RSVPs on recent events only, patching just the snapshot fields", async () => {
  const store = new FakeStore(
    [{ eventId: "e1", endTime: new Date("2030-02-01T00:00:00Z") }, { eventId: "old", endTime: new Date("2029-11-01T00:00:00Z") }, { eventId: "e2", endTime: new Date("2030-03-01T00:00:00Z") }],
    { e1: rsvp(), old: rsvp(), e2: rsvp({ userDepartment: "Engineering", userJobTitle: "Software Engineer (Part-Time)" }) });
  const result = await refreshRsvpSnapshots(store, "u1", { ...user, jobTitle: "" }, user, now);
  assert.deepEqual(result, { events: 2, updated: 1, skipped: false });
  assert.deepEqual(store.applied, [{ companyId: "alpha", eventId: "e1", uid: "u1",
    patch: { userDepartment: "Engineering", userJobTitle: "Software Engineer (Part-Time)" } }]);
  assert.ok(store.applied.every(update => !("status" in update.patch) && !("attendeeCount" in update.patch)));
});

test("unchanged profiles, missing company and foreign rows write nothing (idempotent)", async () => {
  const store = new FakeStore([{ eventId: "e1", endTime: new Date("2030-02-01T00:00:00Z") }], { e1: rsvp({ userId: "someone-else" }) });
  assert.deepEqual(await refreshRsvpSnapshots(store, "u1", user, { ...user, city: "x" }, now), { events: 0, updated: 0, skipped: true });
  assert.deepEqual(await refreshRsvpSnapshots(store, "u1", user, { ...user, jobTitle: "Lead", companyId: undefined }, now), { events: 0, updated: 0, skipped: true });
  assert.equal(store.queried.length, 0);
  assert.equal((await refreshRsvpSnapshots(store, "u1", user, { ...user, jobTitle: "Lead" }, now)).updated, 0);
  assert.equal(store.applied.length, 0);
  const second = new FakeStore([{ eventId: "e1", endTime: new Date("2030-02-01T00:00:00Z") }],
    { e1: rsvp({ userDepartment: "Engineering", userJobTitle: "Lead" }) });
  assert.equal((await refreshRsvpSnapshots(second, "u1", user, { ...user, jobTitle: "Lead" }, now)).updated, 0);
});

test("a join snapshots the job title from the member profile", async () => {
  // Covered end to end in participation.test.ts; this guards the empty default for members without a title.
  assert.equal(profileSnapshot({ displayName: "Sam", department: "HR" })?.userJobTitle, "");
});
