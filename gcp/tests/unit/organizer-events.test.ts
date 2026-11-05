import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { createEvent, updateEvent, type Caller } from "../../functions/src/modules/organizer/application/organizerCommands";
import type { CommandReceipt, OrganizerStore, OrganizerTransaction, StoredEvent, StoredOrganizer } from "../../functions/src/modules/organizer/application/ports";
import { draftHash, parseCreateEventRequest, parseUpdateEventRequest, type ParsedDraft } from "../../functions/src/modules/organizer/domain/eventDraft";
import { OrganizerError } from "../../functions/src/modules/organizer/domain/errors";
import { handleCreateEvent, handleUpdateEvent, toHttpsError } from "../../functions/src/modules/organizer/transport/organizerCallables";

const NOW = new Date("2026-11-03T12:00:00.000Z");
const clock = { now: () => NOW };
const REQUEST_ID = "7d444840-9dc0-41f4-9d0c-4d1f4b3a9f10";

class FakeStore implements OrganizerStore {
  members = new Map<string, StoredOrganizer>([
    ["admin", { companyId: "acme", role: "admin" }],
    ["member", { companyId: "acme", role: "member" }],
    ["other-admin", { companyId: "globex", role: "admin" }],
  ]);
  tags = new Set(["tag-fitness", "tag-games"]);
  events = new Map<string, StoredEvent & { draft?: ParsedDraft; createdBy?: string }>();
  receipts = new Map<string, CommandReceipt>();
  /** Event paths (`company/event`) that have at least one RSVP record, active or cancelled. */
  rsvps = new Set<string>();
  writes: string[] = [];
  async runTransaction<T>(work: (tx: OrganizerTransaction) => Promise<T>): Promise<T> {
    const staged: Array<() => void> = [];
    const tx: OrganizerTransaction = {
      getMembership: async (uid) => this.members.get(uid) ?? null,
      getEvent: async (company, id) => this.events.get(`${company}/${id}`) ?? null,
      getReceipt: async (company, uid, requestId) => this.receipts.get(`${company}/${uid}_${requestId}`) ?? null,
      hasAnyRsvp: async (company, id) => this.rsvps.has(`${company}/${id}`),
      missingTagIds: async (ids) => ids.filter((id) => !this.tags.has(id)),
      createEvent: (company, id, uid, draft) => { staged.push(() => { this.writes.push(`create ${id}`); this.events.set(`${company}/${id}`, { revision: 1, attendeeCount: 0, startTime: draft.startTime, endTime: draft.endTime, status: "scheduled", draft, createdBy: uid }); }); },
      createReceipt: (company, uid, requestId, receipt) => { staged.push(() => this.receipts.set(`${company}/${uid}_${requestId}`, receipt)); },
      updateEvent: (company, id, draft, status, next) => { staged.push(() => { this.writes.push(`update ${id}`); const cur = this.events.get(`${company}/${id}`)!; this.events.set(`${company}/${id}`, { ...cur, draft, status, revision: next, startTime: draft.startTime, endTime: draft.endTime }); }); },
    };
    const result = await work(tx);
    staged.forEach((apply) => apply()); // nothing is applied when work throws
    return result;
  }
}

const admin: Caller = { uid: "admin", emailVerified: true, signInProvider: "google.com" };
const draftJson = (overrides: Record<string, unknown> = {}) => ({
  title: "  Trivia night  ", description: "Teams of four.", tagIds: ["tag-games"], coverImageURL: "catalog://default/games",
  startTime: "2026-11-10T22:00:00Z", endTime: "2026-11-10T23:30:00Z",
  venue: { name: "Pub", address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.44, longitude: -79.99 },
  costCents: 500, costNote: "", capacity: 10, isOutdoor: false, ...overrides,
});
const createRequest = (event: Record<string, unknown> = draftJson(), overrides: Record<string, unknown> = {}) =>
  ({ contractVersion: 1, companyId: "acme", requestId: REQUEST_ID, event, ...overrides });
const ids = (...values: string[]) => { let i = 0; return { eventId: () => values[i++] ?? `evt${i}` }; };
async function failure(promise: Promise<unknown>): Promise<OrganizerError> {
  try { await promise; } catch (error) { assert.ok(error instanceof OrganizerError, String(error)); return error; }
  throw new Error("expected a failure");
}

describe("request validation", () => {
  test("accepts a valid draft and trims text", () => {
    const parsed = parseCreateEventRequest(createRequest());
    assert.equal(parsed.event.title, "Trivia night");
    assert.equal(parsed.event.startTime.toISOString(), "2026-11-10T22:00:00.000Z");
  });
  test("rejects shape, version, ids and unknown fields", () => {
    const bad = (data: unknown) => assert.throws(() => parseCreateEventRequest(data), (e: any) => e instanceof OrganizerError && e.reason === "VALIDATION_FAILED");
    bad(null); bad([]); bad({ ...createRequest(), contractVersion: 2 }); bad({ ...createRequest(), extra: 1 });
    bad(createRequest(draftJson(), { companyId: "bad id!" })); bad(createRequest(draftJson(), { requestId: "not-a-uuid" }));
    bad(createRequest({ ...draftJson(), surprise: true }));
  });
  test("rejects field-level violations", () => {
    const fields = (overrides: Record<string, unknown>) => { try { parseCreateEventRequest(createRequest(draftJson(overrides))); return []; } catch (e: any) { return [...e.fields]; } };
    assert.deepEqual(fields({ title: "   " }), ["title"]);
    assert.deepEqual(fields({ title: "x".repeat(121) }), ["title"]);
    assert.deepEqual(fields({ description: "" }), ["description"]);
    assert.deepEqual(fields({ capacity: 0 }), ["capacity"]);
    assert.deepEqual(fields({ capacity: 10_001 }), ["capacity"]);
    assert.deepEqual(fields({ capacity: 2.5 }), ["capacity"]);
    assert.deepEqual(fields({ costCents: -1 }), ["costCents"]);
    assert.deepEqual(fields({ costCents: 10.5 }), ["costCents"]);
    assert.deepEqual(fields({ startTime: "2026-11-10 22:00" }), ["startTime"]);
    assert.deepEqual(fields({ startTime: "2026-11-10T22:00:00+01:00" }), ["startTime"]);
    assert.deepEqual(fields({ endTime: "2026-11-10T22:00:00Z" }), ["endTime"]);
    assert.deepEqual(fields({ coverImageURL: "https://evil.example/x.jpg" }), ["coverImageURL"]);
    assert.deepEqual(fields({ tagIds: ["a", "a"] }), ["tagIds"]);
    assert.deepEqual(fields({ venue: { name: "P", address: "A", locality: "L", latitude: 91, longitude: 0 } }), ["venue.latitude"]);
    assert.deepEqual(fields({ venue: { name: "P", address: "A", locality: "L", latitude: 0, longitude: -181 } }), ["venue.longitude"]);
    assert.deepEqual(fields({ venue: { name: "", address: "A", locality: "L", latitude: 0, longitude: 0 } }), ["venue.name"]);
  });
  test("update request needs a revision and a valid status", () => {
    const base = { contractVersion: 1, companyId: "acme", eventId: "e1", expectedRevision: 1, event: draftJson(), status: "scheduled" };
    assert.equal(parseUpdateEventRequest(base).status, "scheduled");
    for (const patch of [{ expectedRevision: 0 }, { expectedRevision: 1.5 }, { status: "deleted" }, { eventId: "" }]) {
      assert.throws(() => parseUpdateEventRequest({ ...base, ...patch }));
    }
  });
  test("draft hash ignores insignificant whitespace but not content", () => {
    const a = parseCreateEventRequest(createRequest()).event;
    const b = parseCreateEventRequest(createRequest(draftJson({ title: "Trivia night" }))).event;
    const c = parseCreateEventRequest(createRequest(draftJson({ capacity: 11 }))).event;
    assert.equal(draftHash(a), draftHash(b));
    assert.notEqual(draftHash(a), draftHash(c));
  });
});

describe("createEvent authorization", () => {
  test("signed-out, unverified and non-Google callers are rejected", async () => {
    const store = new FakeStore();
    assert.equal((await failure(createEvent(store, null, createRequest(), ids("e1"), clock))).code, "unauthenticated");
    assert.equal((await failure(createEvent(store, { ...admin, emailVerified: false }, createRequest(), ids("e1"), clock))).code, "permission-denied");
    assert.equal((await failure(createEvent(store, { ...admin, signInProvider: "password" }, createRequest(), ids("e1"), clock))).code, "permission-denied");
    assert.equal(store.events.size, 0);
  });
  test("ordinary members, unknown users and other-company admins cannot write", async () => {
    const store = new FakeStore();
    const member = await failure(createEvent(store, { ...admin, uid: "member" }, createRequest(), ids("e1"), clock));
    assert.equal(member.reason, "NOT_ORGANIZER");
    assert.equal((await failure(createEvent(store, { ...admin, uid: "ghost" }, createRequest(), ids("e1"), clock))).reason, "NOT_ORGANIZER");
    const other = await failure(createEvent(store, { ...admin, uid: "other-admin" }, createRequest(), ids("e1"), clock));
    assert.equal(other.reason, "COMPANY_MISMATCH");
    assert.equal(store.events.size, 0);
  });
  test("a supplied companyId alone is never authorization", async () => {
    const store = new FakeStore();
    const error = await failure(createEvent(store, admin, createRequest(draftJson(), { companyId: "globex" }), ids("e1"), clock));
    assert.equal(error.reason, "COMPANY_MISMATCH");
  });
});

describe("createEvent behavior", () => {
  test("assigns server-owned fields and returns revision 1", async () => {
    const store = new FakeStore();
    const result = await createEvent(store, admin, createRequest(), ids("evt-1"), clock);
    assert.deepEqual(result, { contractVersion: 1, eventId: "evt-1", revision: 1 });
    const stored = store.events.get("acme/evt-1")!;
    assert.equal(stored.revision, 1);
    assert.equal(stored.attendeeCount, 0);
    assert.equal(stored.status, "scheduled");
    assert.equal(stored.createdBy, "admin");
  });
  test("a retry with the same requestId returns the same event; another payload fails", async () => {
    const store = new FakeStore();
    const first = await createEvent(store, admin, createRequest(), ids("evt-1"), clock);
    const again = await createEvent(store, admin, createRequest(), ids("evt-2"), clock);
    assert.deepEqual(again, first);
    assert.equal(store.events.size, 1);
    const reused = await failure(createEvent(store, admin, createRequest(draftJson({ capacity: 99 })), ids("evt-3"), clock));
    assert.equal(reused.reason, "REQUEST_REUSED");
    assert.equal(store.events.size, 1);
  });
  test("new events must start in the future and use known tags", async () => {
    const store = new FakeStore();
    const past = await failure(createEvent(store, admin, createRequest(draftJson({ startTime: "2026-11-01T10:00:00Z", endTime: "2026-11-01T11:00:00Z" })), ids("e"), clock));
    assert.deepEqual([...past.fields], ["startTime"]);
    const tag = await failure(createEvent(store, admin, createRequest(draftJson({ tagIds: ["tag-nope"] })), ids("e"), clock));
    assert.equal(tag.reason, "TAG_NOT_FOUND");
    assert.equal(store.events.size, 0);
  });
});

describe("updateEvent", () => {
  async function seeded() {
    const store = new FakeStore();
    await createEvent(store, admin, createRequest(), ids("evt-1"), clock);
    return store;
  }
  const updateRequest = (overrides: Record<string, unknown> = {}, event: Record<string, unknown> = draftJson()) =>
    ({ contractVersion: 1, companyId: "acme", eventId: "evt-1", expectedRevision: 1, event, status: "scheduled", ...overrides });

  test("full-draft replacement increments the revision", async () => {
    const store = await seeded();
    const result = await updateEvent(store, admin, updateRequest({}, draftJson({ title: "Trivia night!", capacity: 20 })));
    assert.deepEqual(result, { contractVersion: 1, eventId: "evt-1", revision: 2 });
    assert.equal(store.events.get("acme/evt-1")!.draft!.title, "Trivia night!");
  });
  test("a stale revision is aborted and overwrites nothing", async () => {
    const store = await seeded();
    await updateEvent(store, admin, updateRequest({}, draftJson({ title: "First edit" })));
    const stale = await failure(updateEvent(store, admin, updateRequest({}, draftJson({ title: "Stale edit" }))));
    assert.equal(stale.code, "aborted");
    assert.equal(stale.reason, "REVISION_CONFLICT");
    assert.equal(store.events.get("acme/evt-1")!.draft!.title, "First edit");
  });
  test("members, other companies and signed-out callers cannot update", async () => {
    const store = await seeded();
    assert.equal((await failure(updateEvent(store, { ...admin, uid: "member" }, updateRequest()))).reason, "NOT_ORGANIZER");
    assert.equal((await failure(updateEvent(store, { ...admin, uid: "other-admin" }, updateRequest()))).reason, "COMPANY_MISMATCH");
    assert.equal((await failure(updateEvent(store, null, updateRequest()))).code, "unauthenticated");
    assert.equal((await failure(updateEvent(store, admin, updateRequest({ eventId: "missing" })))).reason, "EVENT_NOT_FOUND");
  });
  test("capacity cannot drop below attendees", async () => {
    const store = await seeded();
    store.events.get("acme/evt-1")!.attendeeCount = 8;
    const capacity = await failure(updateEvent(store, admin, updateRequest({}, draftJson({ capacity: 5 }))));
    assert.equal(capacity.reason, "CAPACITY_BELOW_ATTENDEES");
    await updateEvent(store, admin, updateRequest({}, draftJson({ capacity: 8 })));
  });
  test("any RSVP record, even a cancelled one, locks both start and end times", async () => {
    const store = await seeded();
    store.rsvps.add("acme/evt-1"); // attendeeCount stays 0: the only RSVP is cancelled
    const start = await failure(updateEvent(store, admin, updateRequest({}, draftJson({ startTime: "2026-11-11T22:00:00Z", endTime: "2026-11-11T23:30:00Z" }))));
    assert.equal(start.reason, "TIME_CHANGE_BLOCKED");
    assert.deepEqual([...start.fields], ["startTime", "endTime"]);
    const end = await failure(updateEvent(store, admin, updateRequest({}, draftJson({ endTime: "2026-11-10T23:45:00Z" }))));
    assert.equal(end.reason, "TIME_CHANGE_BLOCKED");
    // Everything else stays editable, and unchanged times are fine.
    await updateEvent(store, admin, updateRequest({}, draftJson({ title: "Renamed", capacity: 12, costCents: 0 })));
    assert.equal(store.events.get("acme/evt-1")!.draft!.title, "Renamed");
  });
  test("without any RSVP record the times can change", async () => {
    const store = await seeded();
    await updateEvent(store, admin, updateRequest({}, draftJson({ startTime: "2026-11-11T22:00:00Z", endTime: "2026-11-11T23:30:00Z" })));
    assert.equal(store.events.get("acme/evt-1")!.startTime.toISOString(), "2026-11-11T22:00:00.000Z");
  });
  test("events cancel and restore without deletion", async () => {
    const store = await seeded();
    await updateEvent(store, admin, updateRequest({ status: "cancelled" }));
    assert.equal(store.events.get("acme/evt-1")!.status, "cancelled");
    await updateEvent(store, admin, updateRequest({ status: "scheduled", expectedRevision: 2 }));
    assert.equal(store.events.get("acme/evt-1")!.status, "scheduled");
    assert.equal(store.events.size, 1);
  });
});

describe("transport mapping", () => {
  const unauthenticated = { auth: undefined, data: createRequest() };
  test("maps domain errors to callable errors with reasons and hides internals", async () => {
    const store = new FakeStore();
    await assert.rejects(handleCreateEvent(store, unauthenticated, ids("e"), clock), (e: any) => e.code === "unauthenticated");
    await assert.rejects(handleCreateEvent(store, { auth: { uid: "member", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } } as any, data: createRequest() }, ids("e"), clock),
      (e: any) => e.code === "permission-denied" && e.details.reason === "NOT_ORGANIZER");
    await assert.rejects(handleUpdateEvent(store, { auth: { uid: "admin", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } } as any, data: { contractVersion: 1 } }),
      (e: any) => e.code === "invalid-argument" && e.details.reason === "VALIDATION_FAILED" && Array.isArray(e.details.fields));
    const internal = toHttpsError(new Error("database password leaked"));
    assert.equal(internal.code, "internal");
    assert.ok(!internal.message.includes("password"));
  });
});
