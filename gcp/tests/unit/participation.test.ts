import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setRsvp } from "../../functions/src/modules/participation/application/setRsvp";
import type { Document, ParticipationIdentity, ParticipationStore, ParticipationTransaction } from "../../functions/src/modules/participation/application/ports";
import { ParticipationError } from "../../functions/src/modules/participation/domain/errors";
import { parseRequest } from "../../functions/src/modules/participation/domain/request";
import { handleSetRsvp } from "../../functions/src/modules/participation/transport/setRsvpV1";

const now = () => new Date("2030-01-01T12:00:00Z");
const request = { contractVersion: 1, companyId: "alpha", eventId: "event", status: "going" };
const identity = (uid = "a"): ParticipationIdentity => ({ uid, emailVerified: true, signInProvider: "google.com" });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

// Optimistic transaction double. Real Firestore/SDK evidence lives in integration tests.
class Store implements ParticipationStore {
  docs = new Map<string, { data: Document; version: number }>();
  reads: string[] = [];
  writes = 0;
  private version = 0;
  seed(path: string, data: Document) { this.docs.set(path, { data: structuredClone(data), version: ++this.version }); }
  get(path: string) { return this.docs.get(path)?.data; }
  async runTransaction<T>(work: (tx: ParticipationTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const seen = new Map<string, number>();
      const pending: [string, Document, boolean][] = [];
      const read = async (path: string) => {
        await tick(); this.reads.push(path);
        const entry = this.docs.get(path); seen.set(path, entry?.version ?? 0);
        return entry ? structuredClone(entry.data) : null;
      };
      const event = (c: string, e: string) => `companies/${c}/events/${e}`;
      const rsvp = (c: string, e: string, u: string) => `${event(c,e)}/rsvps/${u}`;
      const tx: ParticipationTransaction = {
        getMember: u => read(`users/${u}`), getEvent: (c,e) => read(event(c,e)), getRsvp: (c,e,u) => read(rsvp(c,e,u)),
        createRsvp: (c,e,u,data) => { pending.push([rsvp(c,e,u), { ...data, createdAt: "SERVER_TIME" }, true]); },
        updateRsvp: (c,e,u,data) => { pending.push([rsvp(c,e,u), data, false]); },
        setCount: (c,e,count) => { pending.push([event(c,e), { attendeeCount: count }, false]); },
      };
      const result = await work(tx); await tick();
      if ([...seen].some(([p,v]) => (this.docs.get(p)?.version ?? 0) !== v)) continue;
      for (const [path,data,create] of pending) {
        assert.equal(create ? this.docs.has(path) : !this.docs.has(path), false);
        this.seed(path, create ? data : { ...this.get(path), ...data }); this.writes++;
      }
      return result;
    }
    throw new Error("test transaction contention");
  }
}
const eventPath = "companies/alpha/events/event";
const rsvpPath = `${eventPath}/rsvps/a`;
function fixture(overrides: Document = {}) {
  const store = new Store();
  for (const uid of ["a", "b"]) store.seed(`users/${uid}`, {
    companyId: "alpha", role: "member", displayName: `Member ${uid}`, avatarId: "avatar", department: "Engineering", pointsBalance: 10,
  });
  store.seed(eventPath, { companyId: "alpha", status: "scheduled", startTime: new Date("2030-01-02T12:00:00Z"), capacity: 2, attendeeCount: 0, ...overrides });
  return store;
}
async function rejected(p: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(p, (error: unknown) => {
    assert.ok(error instanceof ParticipationError); assert.equal(error.code, code);
    if (reason) assert.equal(error.reason, reason);
    return true;
  });
}
const call = (s: Store, status = "going", uid = "a") => setRsvp(s, identity(uid), { ...request, status }, now);

test("first join, retry, cancel, retry and rejoin preserve one trusted RSVP and count", async () => {
  const store = fixture();
  assert.deepEqual(await call(store), { contractVersion: 1, eventId: "event", status: "going", attendeeCount: 1 });
  const original = structuredClone(store.get(rsvpPath));
  assert.deepEqual(original, { companyId: "alpha", eventId: "event", userId: "a", userName: "Member a", userAvatarId: "avatar", userDepartment: "Engineering", userJobTitle: "", status: "going", checkedIn: false, checkedInAt: null, createdAt: "SERVER_TIME", eventStartTime: new Date("2030-01-02T12:00:00Z") });
  const writes = store.writes; await call(store); assert.equal(store.writes, writes);
  assert.equal((await call(store, "cancelled")).attendeeCount, 0);
  const cancelledWrites = store.writes; await call(store, "cancelled"); assert.equal(store.writes, cancelledWrites);
  store.seed("users/a", { ...store.get("users/a"), displayName: "Changed" });
  assert.equal((await call(store)).attendeeCount, 1);
  assert.deepEqual(store.get(rsvpPath), original);
  assert.equal(store.get("users/a")?.pointsBalance, 10);
});

test("cancel without a previous join retains a cancelled row without decrementing", async () => {
  const store = fixture(); await call(store, "cancelled");
  assert.equal(store.get(rsvpPath)?.status, "cancelled");
  assert.equal(store.get(eventPath)?.attendeeCount, 0);
});

test("concurrent last-seat callers admit one and same-user replay applies one delta", async () => {
  const store = fixture({ capacity: 1 });
  const results = await Promise.allSettled([call(store, "going", "a"), call(store, "going", "b")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(failure.reason.code, "resource-exhausted");
  assert.equal(store.get(eventPath)?.attendeeCount, 1);
  const replay = fixture(); await Promise.all(Array.from({ length: 8 }, () => call(replay)));
  assert.equal(replay.get(eventPath)?.attendeeCount, 1);
});

test("authentication, Google verification and tenant checks fail before tenant reads", async () => {
  const store = fixture();
  await rejected(setRsvp(store, null, request, now), "unauthenticated");
  await rejected(setRsvp(store, { ...identity(), emailVerified: false }, request, now), "permission-denied", "EMAIL_NOT_VERIFIED");
  await rejected(setRsvp(store, { ...identity(), signInProvider: "password" }, request, now), "permission-denied", "PROVIDER_NOT_ALLOWED");
  await rejected(call(store, "going", "missing"), "permission-denied");
  store.seed("users/a", { ...store.get("users/a"), companyId: "beta", role: "admin" });
  await rejected(call(store), "permission-denied");
  assert.ok(store.reads.every(p => p.startsWith("users/")));
  assert.equal(store.writes, 0);
});

test("requests reject unknown identity/counter fields, invalid versions, paths and states", () => {
  for (const data of [null, [], "bad", {}, { ...request, contractVersion: 2 }, { ...request, companyId: "../beta" },
    { ...request, eventId: "a/b" }, { ...request, eventId: "." }, { ...request, eventId: "__reserved__" },
    { ...request, eventId: "x".repeat(129) }, { ...request, eventId: "event.with.dots" }, { ...request, companyId: "é" }, { ...request, status: "checkedIn" },
    ...["userId", "role", "attendeeCount", "userName", "checkedIn"].map(key => ({ ...request, [key]: "spoof" }))]) {
    assert.throws(() => parseRequest(data), ParticipationError);
  }
  assert.deepEqual(parseRequest(request), request);
});

test("full, cancelled, past and exactly-started events reject new transitions; retries stay no-op", async () => {
  await rejected(call(fixture({ capacity: 1, attendeeCount: 1 })), "resource-exhausted", "EVENT_FULL");
  await rejected(call(fixture({ status: "cancelled" })), "failed-precondition", "EVENT_CLOSED");
  for (const startTime of [now(), new Date(now().getTime() - 1)]) {
    const store = fixture({ startTime });
    await rejected(call(store), "failed-precondition");
    await rejected(call(store, "cancelled"), "failed-precondition");
    assert.equal(store.writes, 0);
  }
  const store = fixture(); await call(store);
  store.seed(eventPath, { ...store.get(eventPath), status: "cancelled", startTime: now() });
  const writes = store.writes; await call(store); assert.equal(store.writes, writes);
  await rejected(call(store, "cancelled"), "failed-precondition");
});

test("before-start cancellation is allowed when organizer has cancelled event; attendance is preserved", async () => {
  const store = fixture(); await call(store);
  store.seed(eventPath, { ...store.get(eventPath), status: "cancelled" });
  store.seed(rsvpPath, { ...store.get(rsvpPath), checkedIn: true, checkedInAt: now() });
  await call(store, "cancelled");
  assert.equal(store.get(eventPath)?.attendeeCount, 0);
  assert.equal(store.get(rsvpPath)?.checkedIn, true);
  assert.deepEqual(store.get(rsvpPath)?.checkedInAt, now());
});

test("missing events and malformed stored data fail closed without writes or underflow", async () => {
  const absent = fixture(); absent.docs.delete(eventPath); await rejected(call(absent), "not-found");
  for (const patch of [{ companyId: "beta" }, { startTime: "2030-01-02" }, { capacity: 0 }, { attendeeCount: -1 }, { attendeeCount: 0.5 }, { attendeeCount: 3 }, { status: "unexpected" }]) {
    const store = fixture(patch); await rejected(call(store), "internal"); assert.equal(store.writes, 0);
  }
  const store = fixture(); await call(store); store.seed(eventPath, { ...store.get(eventPath), attendeeCount: 0 });
  await rejected(call(store, "cancelled"), "internal"); assert.equal(store.get(eventPath)?.attendeeCount, 0);
  const bad = fixture(); await call(bad); bad.seed(rsvpPath, { ...bad.get(rsvpPath), userId: "b" });
  await rejected(call(bad, "cancelled"), "internal");
});

test("transport maps known errors and redacts unexpected failures", async () => {
  await assert.rejects(handleSetRsvp(fixture(), { data: request }), (e: any) => e.code === "unauthenticated" && e.details.reason === "UNAUTHENTICATED");
  const broken: ParticipationStore = { async runTransaction() { throw new Error("private backend detail"); } };
  const auth = { uid: "a", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } } as any;
  await assert.rejects(handleSetRsvp(broken, { auth, data: request }), (e: any) => e.code === "internal" && !JSON.stringify(e).includes("private backend detail"));
});

test("first join snapshots the member job title and department", async () => {
  const store = fixture();
  store.seed("users/a", { ...store.get("users/a"), jobTitle: "Software Engineer (Part-Time)" });
  await call(store);
  assert.equal(store.get(rsvpPath)?.userJobTitle, "Software Engineer (Part-Time)");
  assert.equal(store.get(rsvpPath)?.userDepartment, "Engineering");
});
