import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { createChallenge, updateChallenge, type Caller } from "../../functions/src/modules/challenges/application/challengeCommands";
import type { ChallengeReceipt, ChallengeStore, ChallengeTransaction, StoredMembership } from "../../functions/src/modules/challenges/application/ports";
import {
  APPROVED_THEME_URLS, parseCreateChallengeRequest, parseUpdateChallengeRequest, rfc3339, windowChangeBlocked, windowsOverlap,
  type StoredChallenge,
} from "../../functions/src/modules/challenges/domain/challengeDraft";
import { ChallengeError } from "../../functions/src/modules/challenges/domain/errors";
import { handleCreateChallenge, handleUpdateChallenge, toHttpsError } from "../../functions/src/modules/challenges/transport/challengeCallables";

const NOW = new Date("2026-11-10T15:30:00.250Z");
const clock = { now: () => NOW };
const REQUEST_ID = "7d444840-9dc0-41f4-9d0c-4d1f4b3a9f10";
// Week of Nov 16 (America/New_York): Mon 00:00 EST = 05:00Z, ends the next Monday minus 1 s.
const NEXT_WEEK = { startDate: "2026-11-16T05:00:00Z", endDate: "2026-11-23T04:59:59Z" };
const THIS_WEEK = { startDate: "2026-11-09T05:00:00Z", endDate: "2026-11-16T04:59:59Z" };

class FakeStore implements ChallengeStore {
  members = new Map<string, StoredMembership>([
    ["admin", { companyId: "acme", role: "admin" }],
    ["admin2", { companyId: "acme", role: "admin" }],
    ["member", { companyId: "acme", role: "member" }],
    ["other-admin", { companyId: "globex", role: "admin" }],
  ]);
  tags = new Set(["tag-fitness", "tag-games"]);
  challenges = new Map<string, StoredChallenge>();
  receipts = new Map<string, ChallengeReceipt | { kind: string }>();
  writes: string[] = [];
  async runTransaction<T>(work: (tx: ChallengeTransaction) => Promise<T>): Promise<T> {
    const staged: Array<() => void> = [];
    const tx: ChallengeTransaction = {
      getMembership: async (uid) => this.members.get(uid) ?? null,
      getChallenge: async (company, id) => this.challenges.get(`${company}/${id}`) ?? null,
      getReceipt: async (company, uid, requestId) => this.receipts.get(`${company}/challenge_${uid}_${requestId}`) ?? null,
      missingTagIds: async (ids) => ids.filter((id) => !this.tags.has(id)),
      windowsEndingBetween: async (company, from, to) => [...this.challenges.entries()]
        .filter(([key, c]) => key.startsWith(`${company}/`) && c.endDate >= from && c.endDate <= to)
        .map(([key, c]) => ({ challengeId: key.split("/")[1], type: c.type, startDate: c.startDate, endDate: c.endDate })),
      createChallenge: (company, id, challenge) => { staged.push(() => { this.writes.push(`create ${id}`); this.challenges.set(`${company}/${id}`, challenge); }); },
      createReceipt: (company, uid, requestId, receipt) => { staged.push(() => this.receipts.set(`${company}/challenge_${uid}_${requestId}`, receipt)); },
      updateChallenge: (company, id, draft, next, updatedAt) => { staged.push(() => {
        this.writes.push(`update ${id}`);
        const cur = this.challenges.get(`${company}/${id}`)!;
        this.challenges.set(`${company}/${id}`, { ...cur, ...draft, revision: next, updatedAt });
      }); },
    };
    const result = await work(tx);
    staged.forEach((apply) => apply()); // nothing is applied when work throws
    return result;
  }
}

const admin: Caller = { uid: "admin", emailVerified: true, signInProvider: "google.com" };
const draftJson = (overrides: Record<string, unknown> = {}) => ({
  title: "  Fitness  ", description: "Get moving with coworkers this week.", tagIds: ["tag-fitness"], type: "weekly",
  goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness", ...NEXT_WEEK, pointsReward: 50, ...overrides,
});
const createRequest = (draft: Record<string, unknown> = draftJson(), overrides: Record<string, unknown> = {}) =>
  ({ contractVersion: 1, companyId: "acme", requestId: REQUEST_ID, draft, ...overrides });
const updateRequest = (expectedRevision: number, draft: Record<string, unknown> = draftJson(), overrides: Record<string, unknown> = {}) =>
  ({ contractVersion: 1, companyId: "acme", challengeId: "ch1", expectedRevision, draft, ...overrides });
const ids = (...values: string[]) => { let i = 0; return { challengeId: () => values[i++] ?? `ch${i}` }; };
async function failure(promise: Promise<unknown>): Promise<ChallengeError> {
  try { await promise; } catch (error) { assert.ok(error instanceof ChallengeError, String(error)); return error; }
  throw new Error("expected a failure");
}
function fieldsOf(draft: Record<string, unknown>): string[] {
  try { parseCreateChallengeRequest(createRequest(draft)); return []; } catch (e: any) { return [...e.fields]; }
}

describe("challenge request validation", () => {
  test("accepts a valid weekly draft and trims text", () => {
    const parsed = parseCreateChallengeRequest(createRequest());
    assert.equal(parsed.draft.title, "Fitness");
    assert.equal(parsed.draft.startDate.toISOString(), "2026-11-16T05:00:00.000Z");
    assert.equal(parsed.requestId, REQUEST_ID);
  });
  test("rejects shape, version, ids and unknown keys (request and draft)", () => {
    const bad = (data: unknown) => assert.throws(() => parseCreateChallengeRequest(data), (e: any) => e instanceof ChallengeError && e.reason === "VALIDATION_FAILED");
    bad(null); bad([]); bad("x"); bad({ ...createRequest(), contractVersion: 2 }); bad({ ...createRequest(), extra: 1 });
    bad(createRequest(draftJson(), { companyId: "bad id!" })); bad(createRequest(draftJson(), { requestId: "not-a-uuid" }));
    bad(createRequest({ ...draftJson(), participantCount: 5 }));
    bad(createRequest({ ...draftJson(), completedCount: 1 }));
    bad(createRequest({ ...draftJson(), revision: 7 }));
    const { goal: _goal, ...missingGoal } = draftJson();
    bad(createRequest(missingGoal));
    assert.deepEqual(fieldsOf({ ...draftJson(), participantCount: 5 }), ["draft.participantCount"]);
  });
  test("rejects field-level violations", () => {
    assert.deepEqual(fieldsOf(draftJson({ title: "   " })), ["title"]);
    assert.deepEqual(fieldsOf(draftJson({ title: "x".repeat(61) })), ["title"]);
    assert.deepEqual(fieldsOf(draftJson({ title: "x".repeat(60) })), []);
    assert.deepEqual(fieldsOf(draftJson({ description: "" })), ["description"]);
    assert.deepEqual(fieldsOf(draftJson({ description: "x".repeat(1001) })), ["description"]);
    assert.deepEqual(fieldsOf(draftJson({ type: "daily" })), ["type"]);
    assert.deepEqual(fieldsOf(draftJson({ goal: 0 })), ["goal"]);
    assert.deepEqual(fieldsOf(draftJson({ goal: -1 })), ["goal"]);
    assert.deepEqual(fieldsOf(draftJson({ goal: 10_001 })), ["goal"]);
    assert.deepEqual(fieldsOf(draftJson({ goal: "3" })), ["goal"]);
    assert.deepEqual(fieldsOf(draftJson({ goal: 2.5 })), []);
    assert.deepEqual(fieldsOf(draftJson({ goalUnit: "" })), ["goalUnit"]);
    assert.deepEqual(fieldsOf(draftJson({ goalUnit: "x".repeat(25) })), ["goalUnit"]);
    assert.deepEqual(fieldsOf(draftJson({ pointsReward: -1 })), ["pointsReward"]);
    assert.deepEqual(fieldsOf(draftJson({ pointsReward: 1001 })), ["pointsReward"]);
    assert.deepEqual(fieldsOf(draftJson({ pointsReward: 1.5 })), ["pointsReward"]);
    assert.deepEqual(fieldsOf(draftJson({ tagIds: ["a", "a"] })), ["tagIds"]);
    assert.deepEqual(fieldsOf(draftJson({ tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) })), ["tagIds"]);
    assert.deepEqual(fieldsOf(draftJson({ tagIds: ["bad/id"] })), ["tagIds"]);
    assert.deepEqual(fieldsOf(draftJson({ startDate: "2026-11-16 05:00" })), ["startDate"]);
    assert.deepEqual(fieldsOf(draftJson({ startDate: "2026-11-16T00:00:00-05:00" })), ["startDate"]);
    assert.deepEqual(fieldsOf(draftJson({ endDate: NEXT_WEEK.startDate })), ["endDate"]);
    assert.deepEqual(fieldsOf(draftJson({ endDate: "2026-11-30T05:00:01Z" })), ["endDate"]); // > 14 days
    assert.deepEqual(fieldsOf(draftJson({ endDate: "2026-11-30T05:00:00Z" })), []); // exactly 14 days
  });
  test("catalog URL policy: only approved theme catalog URLs, never photos or event covers", () => {
    assert.deepEqual([...APPROVED_THEME_URLS], ["catalog://theme/fitness"]);
    for (const url of ["https://example.com/fitness.png", "catalog://default/fitness", "catalog://theme/unknown", "catalog://theme/Fitness", "", "gs://bucket/x.png"]) {
      assert.deepEqual(fieldsOf(draftJson({ coverImageURL: url })), ["coverImageURL"], url);
    }
  });
  test("update request requires challengeId and a positive integer expectedRevision", () => {
    assert.equal(parseUpdateChallengeRequest(updateRequest(1)).expectedRevision, 1);
    for (const patch of [{ expectedRevision: 0 }, { expectedRevision: 1.5 }, { challengeId: "a/b" }, { status: "cancelled" }]) {
      assert.throws(() => parseUpdateChallengeRequest({ ...updateRequest(1), ...patch }), ChallengeError);
    }
  });
  test("window helpers", () => {
    const d = (s: string) => new Date(s);
    assert.equal(windowsOverlap(d(THIS_WEEK.startDate), d(THIS_WEEK.endDate), d(NEXT_WEEK.startDate), d(NEXT_WEEK.endDate)), false);
    assert.equal(windowsOverlap(d(THIS_WEEK.startDate), d(NEXT_WEEK.startDate), d(NEXT_WEEK.startDate), d(NEXT_WEEK.endDate)), true);
    assert.equal(rfc3339(d("2026-11-16T05:00:00Z")), "2026-11-16T05:00:00Z");
    assert.equal(rfc3339(d("2026-11-16T05:00:00.250Z")), "2026-11-16T05:00:00.250Z");
  });
});

describe("createChallengeV1", () => {
  test("signed-out callers are unauthenticated; unverified or non-Google callers and members are refused", async () => {
    const store = new FakeStore();
    assert.equal((await failure(createChallenge(store, null, createRequest(), ids(), clock))).code, "unauthenticated");
    for (const caller of [
      { ...admin, emailVerified: false }, { ...admin, signInProvider: "password" },
      { uid: "member", emailVerified: true, signInProvider: "google.com" }, { uid: "nobody", emailVerified: true, signInProvider: "google.com" },
    ]) {
      const error = await failure(createChallenge(store, caller, createRequest(), ids(), clock));
      assert.equal(error.code, "permission-denied");
      assert.equal(error.reason, "NOT_ORGANIZER");
    }
    assert.deepEqual(store.writes, []);
  });

  test("tenant isolation: a supplied companyId never authorizes another company", async () => {
    const store = new FakeStore();
    const error = await failure(createChallenge(store, admin, createRequest(draftJson(), { companyId: "globex" }), ids(), clock));
    assert.equal(error.reason, "COMPANY_MISMATCH");
    const other = await failure(createChallenge(store, { ...admin, uid: "other-admin" }, createRequest(), ids(), clock));
    assert.equal(other.reason, "COMPANY_MISMATCH");
    assert.deepEqual(store.writes, []);
  });

  test("creates with server-owned counts, author, timestamps and revision 1", async () => {
    const store = new FakeStore();
    const response = await createChallenge(store, admin, createRequest(), ids("ch1"), clock);
    assert.deepEqual(response, {
      contractVersion: 1, challengeId: "ch1", revision: 1, replayed: false,
      challenge: {
        id: "ch1", companyId: "acme", title: "Fitness", description: "Get moving with coworkers this week.", tagIds: ["tag-fitness"],
        type: "weekly", goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness", ...NEXT_WEEK, pointsReward: 50,
        participantCount: 0, completedCount: 0, revision: 1, createdBy: "admin",
        createdAt: "2026-11-10T15:30:00Z", updatedAt: "2026-11-10T15:30:00Z",
      },
    });
    const stored = store.challenges.get("acme/ch1")!;
    assert.equal(stored.participantCount, 0);
    assert.equal(stored.completedCount, 0);
  });

  test("a theme may start in the past (this week) but not have ended", async () => {
    const store = new FakeStore();
    assert.equal((await createChallenge(store, admin, createRequest(draftJson(THIS_WEEK)), ids("now"), clock)).challengeId, "now");
    const ended = await failure(createChallenge(new FakeStore(), admin, createRequest(draftJson({ startDate: "2026-11-02T05:00:00Z", endDate: "2026-11-09T04:59:59Z" })), ids(), clock));
    assert.equal(ended.reason, "VALIDATION_FAILED");
    assert.deepEqual(ended.fields, ["endDate"]);
  });

  test("idempotency: replay returns the same challenge; conflicting reuse fails and writes nothing", async () => {
    const store = new FakeStore();
    const first = await createChallenge(store, admin, createRequest(), ids("ch1"), clock);
    const replay = await createChallenge(store, admin, createRequest(draftJson({ title: "Fitness" })), ids("ch2"), clock);
    assert.deepEqual(replay, { ...first, replayed: true });
    assert.deepEqual(store.writes, ["create ch1"]);
    const reused = await failure(createChallenge(store, admin, createRequest(draftJson({ pointsReward: 60 })), ids("ch3"), clock));
    assert.equal(reused.reason, "REQUEST_REUSED");
    assert.deepEqual(reused.fields, ["requestId"]);
    // Upper-case UUIDs are the same key.
    const upper = await createChallenge(store, admin, createRequest(draftJson(), { requestId: REQUEST_ID.toUpperCase() }), ids("ch4"), clock);
    assert.equal(upper.challengeId, "ch1");
    assert.deepEqual(store.writes, ["create ch1"]);
  });

  test("a receipt written by another command kind is never treated as a challenge replay", async () => {
    const store = new FakeStore();
    store.receipts.set(`acme/challenge_admin_${REQUEST_ID}`, { kind: "event" });
    assert.equal((await failure(createChallenge(store, admin, createRequest(), ids(), clock))).reason, "REQUEST_REUSED");
  });

  test("unknown tags are refused", async () => {
    const error = await failure(createChallenge(new FakeStore(), admin, createRequest(draftJson({ tagIds: ["tag-missing"] })), ids(), clock));
    assert.equal(error.reason, "TAG_NOT_FOUND");
  });

  test("window overlap: one current weekly theme per company, reported with the conflicting week", async () => {
    const store = new FakeStore();
    await createChallenge(store, admin, createRequest(), ids("week47"), clock);
    const overlapping = draftJson({ startDate: "2026-11-20T05:00:00Z", endDate: "2026-11-27T04:59:59Z" });
    const error = await failure(createChallenge(store, admin, createRequest(overlapping, { requestId: crypto.randomUUID() }), ids("x"), clock));
    assert.equal(error.code, "failed-precondition");
    assert.equal(error.reason, "CHALLENGE_WINDOW_OVERLAP");
    assert.deepEqual(error.fields, ["startDate", "endDate"]);
    assert.deepEqual(error.conflict, { challengeId: "week47", ...NEXT_WEEK });
    // An enclosing window is caught too.
    const enclosing = draftJson({ startDate: "2026-11-15T05:00:00Z", endDate: "2026-11-24T04:59:59Z" });
    assert.equal((await failure(createChallenge(store, admin, createRequest(enclosing, { requestId: crypto.randomUUID() }), ids(), clock))).reason, "CHALLENGE_WINDOW_OVERLAP");
    // Adjacent weeks do not overlap, and another company is independent.
    await createChallenge(store, admin, createRequest(draftJson(THIS_WEEK), { requestId: crypto.randomUUID() }), ids("week46"), clock);
    store.members.set("globex-admin", { companyId: "globex", role: "admin" });
    await createChallenge(store, { ...admin, uid: "globex-admin" }, createRequest(draftJson(), { companyId: "globex" }), ids("g1"), clock);
    assert.deepEqual(store.writes, ["create week47", "create week46", "create g1"]);
  });
});

describe("updateChallengeV1", () => {
  async function seeded() {
    const store = new FakeStore();
    await createChallenge(store, admin, createRequest(), ids("ch1"), clock);
    return store;
  }
  test("replaces the draft, increments the revision and keeps server-owned fields", async () => {
    const store = await seeded();
    store.challenges.get("acme/ch1")!.participantCount = 0;
    const later = { now: () => new Date("2026-11-11T09:00:00Z") };
    const response = await updateChallenge(store, admin, updateRequest(1, draftJson({ pointsReward: 75, title: "Fitness week" })), later);
    assert.equal(response.revision, 2);
    assert.equal(response.challengeId, "ch1");
    assert.equal(response.challenge.pointsReward, 75);
    assert.equal(response.challenge.title, "Fitness week");
    assert.equal(response.challenge.createdBy, "admin");
    assert.equal(response.challenge.createdAt, "2026-11-10T15:30:00Z");
    assert.equal(response.challenge.updatedAt, "2026-11-11T09:00:00Z");
    assert.equal(store.challenges.get("acme/ch1")!.revision, 2);
  });

  test("field ownership: counts are never written by an update", async () => {
    const store = await seeded();
    store.challenges.get("acme/ch1")!.participantCount = 12;
    store.challenges.get("acme/ch1")!.completedCount = 4;
    const response = await updateChallenge(store, admin, updateRequest(1, draftJson({ description: "New text." })), clock);
    assert.equal(response.challenge.participantCount, 12);
    assert.equal(response.challenge.completedCount, 4);
    assert.throws(() => parseUpdateChallengeRequest(updateRequest(2, { ...draftJson(), participantCount: 0 })), ChallengeError);
  });

  test("revision conflict is aborted and overwrites nothing", async () => {
    const store = await seeded();
    await updateChallenge(store, admin, updateRequest(1, draftJson({ title: "Renamed" })), clock);
    const stale = await failure(updateChallenge(store, { ...admin, uid: "admin2" }, updateRequest(1, draftJson({ title: "Stale" })), clock));
    assert.equal(stale.code, "aborted");
    assert.equal(stale.reason, "REVISION_CONFLICT");
    assert.equal(store.challenges.get("acme/ch1")!.title, "Renamed");
  });

  test("auth, tenant isolation and missing challenges", async () => {
    const store = await seeded();
    assert.equal((await failure(updateChallenge(store, null, updateRequest(1), clock))).code, "unauthenticated");
    assert.equal((await failure(updateChallenge(store, { ...admin, uid: "member" }, updateRequest(1), clock))).reason, "NOT_ORGANIZER");
    assert.equal((await failure(updateChallenge(store, { ...admin, uid: "other-admin" }, updateRequest(1, draftJson(), { companyId: "globex" }), clock))).reason, "CHALLENGE_NOT_FOUND");
    assert.equal((await failure(updateChallenge(store, { ...admin, uid: "other-admin" }, updateRequest(1), clock))).reason, "COMPANY_MISMATCH");
    const missing = await failure(updateChallenge(store, admin, updateRequest(1, draftJson(), { challengeId: "nope" }), clock));
    assert.equal(missing.code, "not-found");
    assert.deepEqual(store.writes, ["create ch1"]);
  });

  test("overlap on update excludes the challenge itself", async () => {
    const store = await seeded();
    await createChallenge(store, admin, createRequest(draftJson(THIS_WEEK), { requestId: crypto.randomUUID() }), ids("ch0"), clock);
    // Moving ch1 one day earlier overlaps ch0; editing ch1 in place does not.
    const earlier = draftJson({ startDate: "2026-11-15T05:00:00Z", endDate: "2026-11-22T04:59:59Z" });
    const error = await failure(updateChallenge(store, admin, updateRequest(1, earlier), clock));
    assert.equal(error.reason, "CHALLENGE_WINDOW_OVERLAP");
    assert.equal(error.conflict?.challengeId, "ch0");
    assert.equal((await updateChallenge(store, admin, updateRequest(1, draftJson({ goal: 4 })), clock)).revision, 2);
  });

  test("window lock once anyone joined: start fixed, end not moved into the past", async () => {
    const store = new FakeStore();
    await createChallenge(store, admin, createRequest(draftJson(THIS_WEEK)), ids("ch1"), clock);
    store.challenges.get("acme/ch1")!.participantCount = 3;
    const moveStart = await failure(updateChallenge(store, admin, updateRequest(1, draftJson({ ...THIS_WEEK, startDate: "2026-11-10T05:00:00Z" })), clock));
    assert.equal(moveStart.code, "failed-precondition");
    assert.equal(moveStart.reason, "WINDOW_CHANGE_BLOCKED");
    assert.deepEqual(moveStart.fields, ["startDate"]);
    const endInPast = await failure(updateChallenge(store, admin, updateRequest(1, draftJson({ ...THIS_WEEK, endDate: "2026-11-10T05:00:00Z" })), clock));
    assert.deepEqual(endInPast.fields, ["endDate"]);
    // Extending or shortening the end to a future instant, and editing other fields, stay allowed.
    assert.equal((await updateChallenge(store, admin, updateRequest(1, draftJson({ ...THIS_WEEK, endDate: "2026-11-14T04:59:59Z" })), clock)).revision, 2);
    assert.equal((await updateChallenge(store, admin, updateRequest(2, draftJson({ ...THIS_WEEK, endDate: "2026-11-14T04:59:59Z", pointsReward: 10 })), clock)).revision, 3);
    // Without participants the start may move freely.
    const fresh = new FakeStore();
    await createChallenge(fresh, admin, createRequest(draftJson(THIS_WEEK)), ids("ch1"), clock);
    assert.equal((await updateChallenge(fresh, admin, updateRequest(1, draftJson({ ...THIS_WEEK, startDate: "2026-11-10T05:00:00Z" })), clock)).revision, 2);
  });

  test("windowChangeBlocked treats completions like participants", () => {
    const current = { participantCount: 0, completedCount: 1, startDate: new Date(THIS_WEEK.startDate), endDate: new Date(THIS_WEEK.endDate) } as StoredChallenge;
    const draft = parseCreateChallengeRequest(createRequest(draftJson())).draft;
    assert.deepEqual(windowChangeBlocked(current, draft, NOW), ["startDate"]);
  });
});

describe("challenge transport", () => {
  test("maps domain errors to callable errors with reason, fields and conflict details", () => {
    const overlap = toHttpsError(new ChallengeError("failed-precondition", "CHALLENGE_WINDOW_OVERLAP", "m", ["startDate", "endDate"], { challengeId: "c", ...NEXT_WEEK }));
    assert.equal(overlap.code, "failed-precondition");
    assert.deepEqual(overlap.details, { reason: "CHALLENGE_WINDOW_OVERLAP", fields: ["startDate", "endDate"], conflict: { challengeId: "c", ...NEXT_WEEK } });
    const conflict = toHttpsError(new ChallengeError("aborted", "REVISION_CONFLICT", "m"));
    assert.deepEqual(conflict.details, { reason: "REVISION_CONFLICT" });
    const internal = toHttpsError(new ChallengeError("internal", "INVALID_STORED_CHALLENGE", "secret detail"));
    assert.equal(internal.message, "Something went wrong. Try again later.");
    const unknown = toHttpsError(new Error("boom"));
    assert.equal(unknown.code, "internal");
    assert.equal(unknown.details, undefined);
  });
  test("handlers derive the caller only from the Auth token", async () => {
    const store = new FakeStore();
    const auth = { uid: "admin", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } } as any;
    const created = await handleCreateChallenge(store, { auth, data: createRequest() }, ids("ch1"), clock);
    assert.equal(created.challengeId, "ch1");
    const updated = await handleUpdateChallenge(store, { auth, data: updateRequest(1, draftJson({ goal: 5 })) }, clock);
    assert.equal(updated.revision, 2);
    await assert.rejects(handleCreateChallenge(store, { auth: undefined, data: createRequest() }), (e: any) => e.code === "unauthenticated");
    // A spoofed uid in the payload is rejected as an unknown key, never used.
    await assert.rejects(handleCreateChallenge(store, { auth, data: { ...createRequest(), uid: "other-admin" } }), (e: any) => e.code === "invalid-argument");
  });
});
