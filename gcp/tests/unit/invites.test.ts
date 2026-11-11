import { strict as assert } from "node:assert";
import { test } from "node:test";
import { listCoworkers } from "../../functions/src/modules/invites/application/listCoworkers";
import type { DirectoryMember, Document, InviteNotifier, InvitePushInput, InviteStore, InviteTransaction } from "../../functions/src/modules/invites/application/ports";
import { respondToInvite } from "../../functions/src/modules/invites/application/respondToInvite";
import { sendInvite } from "../../functions/src/modules/invites/application/sendInvite";
import { InviteError } from "../../functions/src/modules/invites/domain/errors";
import { nameMatches, nextBudget, parseRespond, parseSearch, parseSend, SEND_LIMIT, SEND_WINDOW_MS } from "../../functions/src/modules/invites/domain/invitePolicy";
import { toHttpsError } from "../../functions/src/modules/invites/transport/inviteFunctions";
import { ParticipationError } from "../../functions/src/modules/participation/domain/errors";

const NOW = new Date("2030-01-01T12:00:00Z");
const now = () => NOW;
const caller = (uid = "sender") => ({ uid, emailVerified: true, signInProvider: "google.com" });
const send = { contractVersion: 1, companyId: "alpha", eventId: "event", toUserId: "friend", message: "  Join us!  ", requestId: "request-0001" };
const respond = (response: string, inviteId = "event_friend") => ({ contractVersion: 1, companyId: "alpha", inviteId, response });

/** Serialized in-memory store; transactions are all-or-nothing (writes apply only when the work resolves). */
class Store implements InviteStore {
  docs = new Map<string, Document>();
  writes: string[] = [];
  seed(path: string, data: Document) { this.docs.set(path, structuredClone(data)); }
  get(path: string) { return this.docs.get(path); }
  private event = (c: string, e: string) => `companies/${c}/events/${e}`;
  async runTransaction<T>(work: (tx: InviteTransaction) => Promise<T>): Promise<T> {
    const pending: Array<() => void> = [];
    const read = (path: string) => { const d = this.docs.get(path); return d ? structuredClone(d) : null; };
    const put = (path: string, data: Document, merge = false) => pending.push(() => {
      this.docs.set(path, merge ? { ...(this.docs.get(path) ?? {}), ...data } : data); this.writes.push(path);
    });
    const tx: InviteTransaction = {
      getMember: async (u) => read(`users/${u}`),
      getEvent: async (c, e) => read(this.event(c, e)),
      getRsvp: async (c, e, u) => read(`${this.event(c, e)}/rsvps/${u}`),
      createRsvp: (c, e, u, data) => put(`${this.event(c, e)}/rsvps/${u}`, { ...data, createdAt: "SERVER" }),
      updateRsvp: (c, e, u, data) => put(`${this.event(c, e)}/rsvps/${u}`, data, true),
      setCount: (c, e, count) => put(this.event(c, e), { attendeeCount: count }, true),
      getInvite: async (c, id) => read(`companies/${c}/invites/${id}`),
      createInvite: (c, id, data) => put(`companies/${c}/invites/${id}`, { ...data, createdAt: "SERVER" }),
      markResponded: (c, id, status) => put(`companies/${c}/invites/${id}`, { status, respondedAt: "SERVER" }, true),
      createNotification: (u, id, data) => put(`users/${u}/notifications/${id}`, { ...data, createdAt: "SERVER" }),
      getBudget: async (key) => read(`inviteRateLimits/${key}`),
      setBudget: (key, state) => put(`inviteRateLimits/${key}`, { ...state }),
    };
    const result = await work(tx);
    pending.forEach((apply) => apply());
    return result;
  }
  async getMember(uid: string) { return this.docs.get(`users/${uid}`) ?? null; }
  async getEvent(c: string, e: string) { return this.docs.get(this.event(c, e)) ?? null; }
  async listMembers(companyId: string, cap: number) {
    const all: DirectoryMember[] = [];
    for (const [path, data] of this.docs) {
      if (/^users\/[^/]+$/.test(path) && data.companyId === companyId) {
        all.push({ userId: path.slice(6), displayName: data.displayName as string, avatarId: data.avatarId as string, department: data.department as string });
      }
    }
    return { members: all.slice(0, cap), complete: all.length <= cap };
  }
  async memberStates(c: string, e: string, uids: readonly string[]) {
    const out = new Map<string, "going" | "invited">();
    for (const uid of uids) {
      if (this.docs.has(`companies/${c}/invites/${e}_${uid}`)) out.set(uid, "invited");
      if (this.docs.get(`${this.event(c, e)}/rsvps/${uid}`)?.status === "going") out.set(uid, "going");
    }
    return out;
  }
  budgets = 0;
  async consumeBudget(key: string, limit: number) { return ++this.budgets <= limit; }
}

function world(overrides: { attendeeCount?: number; capacity?: number; status?: string; start?: Date } = {}) {
  const store = new Store();
  const member = (company: string, name: string, extra: Document = {}) =>
    ({ companyId: company, role: "member", displayName: name, avatarId: `a-${name}`, department: "Ops", jobTitle: "", email: `${name}@x.com`, pointsBalance: 9, ...extra });
  store.seed("users/sender", member("alpha", "Sam Sender"));
  store.seed("users/friend", member("alpha", "Fran Friend"));
  store.seed("users/outsider", member("beta", "Olive Outsider"));
  store.seed("companies/alpha/events/event", {
    companyId: "alpha", title: "Pasta Night", status: overrides.status ?? "scheduled", startTime: overrides.start ?? new Date("2030-01-02T18:00:00Z"),
    capacity: overrides.capacity ?? 10, attendeeCount: overrides.attendeeCount ?? 3,
  });
  return store;
}
const notifier = () => { const calls: InvitePushInput[] = []; return { calls, invited: async (i: InvitePushInput) => { calls.push(i); } } satisfies InviteNotifier & { calls: InvitePushInput[] }; };
async function reason(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { assert.ok(error instanceof InviteError || error instanceof ParticipationError, String(error)); return error.reason; }
  throw new Error("expected failure");
}

test("sendInvite creates the invite, an in-app notification and one push", async () => {
  const store = world(); const push = notifier();
  const result = await sendInvite(store, push, caller(), send, now);
  assert.deepEqual(result, { contractVersion: 1, inviteId: "event_friend", status: "pending", created: true });
  const invite = store.get("companies/alpha/invites/event_friend")!;
  assert.equal(invite.message, "Join us!");
  assert.equal(invite.status, "pending");
  assert.equal(invite.fromUserName, "Sam Sender");
  assert.equal(invite.toUserName, "Fran Friend");
  assert.equal(invite.eventTitle, "Pasta Night");
  const notice = store.get("users/friend/notifications/invite_event_friend")!;
  assert.equal(notice.isRead, false); assert.equal(notice.targetId, "event_friend"); assert.equal(notice.type, "invite");
  assert.equal(push.calls.length, 1); assert.equal(push.calls[0]!.toUserId, "friend");
});

test("a replay with the same requestId returns the same invite without a second write or push", async () => {
  const store = world(); const push = notifier();
  await sendInvite(store, push, caller(), send, now);
  const writes = store.writes.length;
  const again = await sendInvite(store, push, caller(), send, now);
  assert.deepEqual(again, { contractVersion: 1, inviteId: "event_friend", status: "pending", created: false });
  assert.equal(store.writes.length, writes); assert.equal(push.calls.length, 1);
});

test("a different request, or a different inviter, for an invited person is ALREADY_INVITED", async () => {
  const store = world();
  store.seed("users/other", { companyId: "alpha", role: "member", displayName: "Oli", avatarId: "a", department: "" });
  await sendInvite(store, null, caller(), send, now);
  assert.equal(await reason(sendInvite(store, null, caller(), { ...send, requestId: "request-0002" }, now)), "ALREADY_INVITED");
  assert.equal(await reason(sendInvite(store, null, caller("other"), send, now)), "ALREADY_INVITED");
});

test("sendInvite refuses everyone who should not be invited", async () => {
  const going = world();
  going.seed("companies/alpha/events/event/rsvps/friend", { status: "going", companyId: "alpha", eventId: "event", userId: "friend", checkedIn: false });
  assert.equal(await reason(sendInvite(going, null, caller(), send, now)), "ALREADY_GOING");
  const left = world();
  left.seed("companies/alpha/events/event/rsvps/friend", { status: "cancelled" });
  assert.equal((await sendInvite(left, null, caller(), send, now)).created, true);
  assert.equal(await reason(sendInvite(world(), null, caller(), { ...send, toUserId: "sender" }, now)), "CANNOT_INVITE_SELF");
  assert.equal(await reason(sendInvite(world(), null, caller(), { ...send, toUserId: "outsider" }, now)), "RECIPIENT_NOT_FOUND");
  assert.equal(await reason(sendInvite(world(), null, caller(), { ...send, toUserId: "nobody" }, now)), "RECIPIENT_NOT_FOUND");
  assert.equal(await reason(sendInvite(world(), null, caller("outsider"), send, now)), "MEMBERSHIP_CONFLICT");
  assert.equal(await reason(sendInvite(world(), null, caller(), { ...send, eventId: "missing" }, now)), "EVENT_NOT_FOUND");
});

test("cancelled, started and full events cannot be invited to", async () => {
  assert.equal(await reason(sendInvite(world({ status: "cancelled" }), null, caller(), send, now)), "EVENT_CANCELLED");
  assert.equal(await reason(sendInvite(world({ start: new Date("2029-12-31T10:00:00Z") }), null, caller(), send, now)), "EVENT_CLOSED");
  assert.equal(await reason(sendInvite(world({ attendeeCount: 10 }), null, caller(), send, now)), "EVENT_FULL");
});

test("a failed push never fails or undoes the committed invite", async () => {
  const store = world();
  const result = await sendInvite(store, { invited: async () => { throw new Error("fcm down"); } }, caller(), send, now);
  assert.equal(result.created, true); assert.ok(store.get("companies/alpha/invites/event_friend"));
});

test("sendInvite is rate limited per sender per hour and never writes on refusal", async () => {
  const store = world();
  for (let i = 0; i < SEND_LIMIT; i++) {
    store.seed(`users/f${i}`, { companyId: "alpha", role: "member", displayName: `F${i}`, avatarId: "a", department: "" });
    await sendInvite(store, null, caller(), { ...send, toUserId: `f${i}`, requestId: `request-${1000 + i}` }, now);
  }
  store.seed("users/extra", { companyId: "alpha", role: "member", displayName: "Extra", avatarId: "a", department: "" });
  assert.equal(await reason(sendInvite(store, null, caller(), { ...send, toUserId: "extra", requestId: "request-9999" }, now)), "RATE_LIMITED");
  assert.equal(store.get("companies/alpha/invites/event_extra"), undefined);
  const later = () => new Date(NOW.getTime() + SEND_WINDOW_MS);
  assert.equal((await sendInvite(store, null, caller(), { ...send, toUserId: "extra", requestId: "request-9999" }, later)).created, true);
});

test("authentication is required for every command", async () => {
  assert.equal(await reason(sendInvite(world(), null, null, send, now)), "UNAUTHENTICATED");
  assert.equal(await reason(respondToInvite(world(), { ...caller(), emailVerified: false }, respond("accepted"), now)), "EMAIL_NOT_VERIFIED");
  assert.equal(await reason(listCoworkers(world(), { ...caller(), signInProvider: "password" }, { contractVersion: 1, companyId: "alpha", eventId: "event", query: "fr" }, now)), "PROVIDER_NOT_ALLOWED");
});

test("accepting joins through the RSVP path: RSVP row, attendee count and accepted invite", async () => {
  const store = world();
  await sendInvite(store, null, caller(), send, now);
  const result = await respondToInvite(store, caller("friend"), respond("accepted"), now);
  assert.deepEqual(result, { contractVersion: 1, inviteId: "event_friend", status: "accepted", rsvpStatus: "going", attendeeCount: 4 });
  assert.equal(store.get("companies/alpha/events/event")!.attendeeCount, 4);
  const rsvp = store.get("companies/alpha/events/event/rsvps/friend")!;
  assert.equal(rsvp.status, "going"); assert.equal(rsvp.userName, "Fran Friend");
  assert.equal(store.get("companies/alpha/invites/event_friend")!.status, "accepted");
});

test("accepting a full event is refused whole: no RSVP, no count change, the invite stays pending", async () => {
  const store = world();
  await sendInvite(store, null, caller(), send, now);
  const event = store.get("companies/alpha/events/event")!; event.attendeeCount = 10;
  assert.equal(await reason(respondToInvite(store, caller("friend"), respond("accepted"), now)), "EVENT_FULL");
  assert.equal(store.get("companies/alpha/invites/event_friend")!.status, "pending");
  assert.equal(store.get("companies/alpha/events/event/rsvps/friend"), undefined);
  assert.equal(store.get("companies/alpha/events/event")!.attendeeCount, 10);
});

test("accepting after the event started or was cancelled fails with EVENT_CLOSED and stays pending", async () => {
  for (const patch of [{ status: "cancelled" }, { startTime: new Date("2029-12-31T10:00:00Z") }]) {
    const store = world();
    await sendInvite(store, null, caller(), send, now);
    Object.assign(store.get("companies/alpha/events/event")!, patch);
    assert.equal(await reason(respondToInvite(store, caller("friend"), respond("accepted"), now)), "EVENT_CLOSED");
    assert.equal(store.get("companies/alpha/invites/event_friend")!.status, "pending");
  }
});

test("accepting is idempotent and never double counts; a previously going recipient just gets the invite marked", async () => {
  const store = world();
  await sendInvite(store, null, caller(), send, now);
  await respondToInvite(store, caller("friend"), respond("accepted"), now);
  const again = await respondToInvite(store, caller("friend"), respond("accepted"), now);
  assert.equal(again.status, "accepted"); assert.equal(again.attendeeCount, 4);
  assert.equal(store.get("companies/alpha/events/event")!.attendeeCount, 4);
  // Joined through the normal RSVP before answering: the count does not move.
  const other = world();
  await sendInvite(other, null, caller(), send, now);
  other.seed("companies/alpha/events/event/rsvps/friend", { companyId: "alpha", eventId: "event", userId: "friend", status: "going", checkedIn: false });
  other.get("companies/alpha/events/event")!.attendeeCount = 4;
  const result = await respondToInvite(other, caller("friend"), respond("accepted"), now);
  assert.equal(result.attendeeCount, 4); assert.equal(other.get("companies/alpha/invites/event_friend")!.status, "accepted");
});

test("declining records the answer without any RSVP; the opposite answer afterwards is refused; replay is safe", async () => {
  const store = world();
  await sendInvite(store, null, caller(), send, now);
  const result = await respondToInvite(store, caller("friend"), respond("declined"), now);
  assert.deepEqual(result, { contractVersion: 1, inviteId: "event_friend", status: "declined" });
  assert.equal(store.get("companies/alpha/events/event/rsvps/friend"), undefined);
  assert.equal((await respondToInvite(store, caller("friend"), respond("declined"), now)).status, "declined");
  assert.equal(await reason(respondToInvite(store, caller("friend"), respond("accepted"), now)), "INVITE_ALREADY_RESPONDED");
  // A declined invitation also blocks a re-invite (one invitation per person per event).
  assert.equal(await reason(sendInvite(store, null, caller(), { ...send, requestId: "request-0003" }, now)), "ALREADY_INVITED");
});

test("only the recipient can respond; the sender, a stranger and other tenants get INVITE_NOT_FOUND", async () => {
  const store = world();
  await sendInvite(store, null, caller(), send, now);
  assert.equal(await reason(respondToInvite(store, caller("sender"), respond("accepted"), now)), "INVITE_NOT_FOUND");
  assert.equal(await reason(respondToInvite(store, caller("outsider"), respond("accepted"), now)), "MEMBERSHIP_CONFLICT");
  assert.equal(await reason(respondToInvite(store, caller("friend"), respond("accepted", "event_nobody"), now)), "INVITE_NOT_FOUND");
  assert.equal(store.get("companies/alpha/invites/event_friend")!.status, "pending");
});

test("the directory returns only name, avatar, team and state, never other profile fields", async () => {
  const store = world();
  store.seed("users/fred", { companyId: "alpha", role: "member", displayName: "Frédéric Moreau", avatarId: "a-f", department: "Design", email: "secret@x.com", pointsBalance: 5 });
  store.seed("companies/alpha/events/event/rsvps/fred", { status: "going" });
  const result = await listCoworkers(store, caller(), { contractVersion: 1, companyId: "alpha", eventId: "event", query: "fr" }, now);
  assert.deepEqual(result.coworkers.map((c) => [c.userId, c.state]), [["friend", "available"], ["fred", "going"]]);
  for (const coworker of result.coworkers) assert.deepEqual(Object.keys(coworker).sort(), ["avatarId", "department", "displayName", "state", "userId"]);
  assert.equal(JSON.stringify(result).includes("secret@x.com"), false);
  assert.equal(result.truncated, false);
  await sendInvite(store, null, caller(), send, now);
  const next = await listCoworkers(store, caller(), { contractVersion: 1, companyId: "alpha", eventId: "event", query: "fran" }, now);
  assert.equal(next.coworkers[0]!.state, "invited");
});

test("the directory excludes the caller and other companies and enforces the query rules and rate budget", async () => {
  const store = world();
  const names = (await listCoworkers(store, caller(), { contractVersion: 1, companyId: "alpha", eventId: "event", query: "sa" }, now)).coworkers;
  assert.deepEqual(names, []);
  assert.deepEqual((await listCoworkers(store, caller(), { contractVersion: 1, companyId: "alpha", eventId: "event", query: "ol" }, now)).coworkers, []);
  assert.equal(await reason(listCoworkers(store, caller("outsider"), { contractVersion: 1, companyId: "alpha", eventId: "event", query: "fr" }, now)), "MEMBERSHIP_CONFLICT");
  assert.throws(() => parseSearch({ contractVersion: 1, companyId: "alpha", eventId: "event", query: "f" }), (e: InviteError) => e.fields.includes("query"));
  const limited = world(); limited.budgets = 1000;
  assert.equal(await reason(listCoworkers(limited, caller(), { contractVersion: 1, companyId: "alpha", eventId: "event", query: "fr" }, now)), "RATE_LIMITED");
});

test("requests are validated strictly", () => {
  assert.equal(parseSend(send).message, "Join us!");
  assert.equal(parseSend({ ...send, message: undefined }).message, "");
  for (const patch of [{ contractVersion: 2 }, { toUserId: "a/b" }, { requestId: "short" }, { message: "x".repeat(201) }, { message: 5 }, { fromUserId: "x" }, { message: "bad\u0007" }]) {
    assert.throws(() => parseSend({ ...send, ...patch }), (e: InviteError) => e.reason === "VALIDATION_FAILED", JSON.stringify(patch));
  }
  assert.equal(parseRespond(respond("accepted")).response, "accepted");
  for (const patch of [{ response: "maybe" }, { inviteId: "a/b" }, { rsvpStatus: "going" }]) {
    assert.throws(() => parseRespond({ ...respond("accepted"), ...patch }), (e: InviteError) => e.reason === "VALIDATION_FAILED");
  }
  assert.throws(() => parseSend(null));
});

test("pure helpers: name matching and the fixed-window budget", () => {
  assert.equal(nameMatches("Frédéric Moreau", "fre"), true);
  assert.equal(nameMatches("Frédéric Moreau", "mor fre"), true);
  assert.equal(nameMatches("Anne-Marie Cole", "marie"), true);
  assert.equal(nameMatches("Frédéric Moreau", "zz"), false);
  assert.deepEqual(nextBudget(null, 5000, 3, 1000), { windowStart: 5000, count: 1 });
  assert.deepEqual(nextBudget({ windowStart: 5000, count: 2 }, 5500, 3, 1000), { windowStart: 5000, count: 3 });
  assert.equal(nextBudget({ windowStart: 5000, count: 3 }, 5500, 3, 1000), null);
  assert.deepEqual(nextBudget({ windowStart: 5000, count: 3 }, 6100, 3, 1000), { windowStart: 6000, count: 1 });
  assert.equal(nextBudget({ windowStart: 9000, count: 0 }, 5500, 3, 1000), null);
  assert.equal(nextBudget({ windowStart: "x", count: 0 }, 5500, 3, 1000), null);
});

test("errors map to callable errors with a stable reason and no internals", () => {
  const mapped = toHttpsError(new InviteError("failed-precondition", "ALREADY_INVITED", "x"));
  assert.equal(mapped.code, "failed-precondition"); assert.deepEqual(mapped.details, { reason: "ALREADY_INVITED" });
  assert.equal(toHttpsError(new ParticipationError("resource-exhausted", "EVENT_FULL", "full")).code, "resource-exhausted");
  const internal = toHttpsError(new Error("secret detail"));
  assert.equal(internal.code, "internal"); assert.equal(internal.message.includes("secret"), false);
  assert.equal(toHttpsError(new InviteError("internal", "INVALID_STORED_DATA", "bad")).code, "internal");
});
