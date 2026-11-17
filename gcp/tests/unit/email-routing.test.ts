import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { emailChannel, enqueueEmail, type ChannelDeps } from "../../functions/src/modules/email/application/enqueueEmail";
import type { NewOutboxEntry, OutboxStore } from "../../functions/src/modules/email/application/ports";
import { resolveEmailPreferences } from "../../functions/src/modules/email/domain/categories";
import { decideEmail } from "../../functions/src/modules/email/domain/policy";
import { CHANNEL_CATEGORIES, NOTIFICATION_KINDS, eventLevelsFor, type NotificationKind } from "../../functions/src/modules/notifications/domain/categories";
import { resolvePreferences } from "../../functions/src/modules/notifications/domain/preferences";
import type { SubscriptionLevel } from "../../functions/src/modules/notifications/domain/subscription";

const KINDS = Object.keys(NOTIFICATION_KINDS).filter((k) => CHANNEL_CATEGORIES.email.includes(NOTIFICATION_KINDS[k as NotificationKind].category)) as NotificationKind[];
const LEVELS: Array<SubscriptionLevel | null> = [null, "all", "changes", "reminders", "none"];
const prefs = (email: Record<string, boolean>) => resolvePreferences({ email });

describe("decideEmail matrix", () => {
  test("global and company flags win first", () => {
    const input = { kind: "invite" as const, globalEnabled: true, companyEnabled: true, preferences: prefs({}), eventLevel: null, pushWillDeliver: false };
    assert.deepEqual(decideEmail({ ...input, globalEnabled: false }), { send: false, reason: "disabled" });
    assert.deepEqual(decideEmail({ ...input, companyEnabled: false }), { send: false, reason: "company_disabled" });
    assert.deepEqual(decideEmail({ ...input, globalEnabled: false, companyEnabled: false }), { send: false, reason: "disabled" });
  });

  test("kinds x preference x level x push", () => {
    assert.ok(KINDS.length >= 8);
    for (const kind of KINDS) {
      const category = NOTIFICATION_KINDS[kind].category;
      const levels = eventLevelsFor(kind);
      for (const on of [true, false]) {
        for (const eventLevel of LEVELS) {
          for (const pushWillDeliver of [true, false]) {
            const got = decideEmail({ kind, globalEnabled: true, companyEnabled: true, preferences: prefs({ [category]: on }), eventLevel, pushWillDeliver });
            let want: string | true = true;
            if (!on) want = "category_off";
            else if (levels !== null && (eventLevel === null || !levels.includes(eventLevel))) want = "event_level";
            else if (category === "challenges" && pushWillDeliver) want = "push_covers";
            assert.deepEqual(got, want === true ? { send: true } : { send: false, reason: want }, JSON.stringify({ kind, on, eventLevel, pushWillDeliver }));
          }
        }
      }
    }
  });

  test("event-scoped kinds are blocked without a subscription; attendee_added and invites are not level-gated", () => {
    const p = prefs({});
    const run = (kind: NotificationKind, eventLevel: SubscriptionLevel | null) =>
      decideEmail({ kind, globalEnabled: true, companyEnabled: true, preferences: p, eventLevel, pushWillDeliver: true });
    for (const kind of ["event_changed", "event_cancelled"] as const) {
      assert.deepEqual(run(kind, null), { send: false, reason: "event_level" });
      assert.deepEqual(run(kind, "none"), { send: false, reason: "event_level" });
      assert.deepEqual(run(kind, "reminders"), { send: false, reason: "event_level" });
      assert.deepEqual(run(kind, "changes"), { send: true });
      assert.deepEqual(run(kind, "all"), { send: true });
    }
    for (const kind of ["attendee_added", "invite", "invite_answered"] as const) {
      for (const level of LEVELS) assert.deepEqual(run(kind, level), { send: true });
    }
  });

  test("reminders and discovery default off and ignore push", () => {
    const run = (kind: NotificationKind, p: ReturnType<typeof prefs>) =>
      decideEmail({ kind, globalEnabled: true, companyEnabled: true, preferences: p, eventLevel: "all", pushWillDeliver: true });
    assert.deepEqual(run("reminder", prefs({})), { send: false, reason: "category_off" });
    assert.deepEqual(run("event_interest", prefs({})), { send: false, reason: "category_off" });
    assert.deepEqual(run("reminder", prefs({ reminders: true })), { send: true });
    assert.deepEqual(run("event_interest", prefs({ discovery: true })), { send: true });
  });

  test("categories email never offers are not email kinds", () => {
    assert.ok(!KINDS.includes("chat"));
    assert.deepEqual(decideEmail({ kind: "chat", globalEnabled: true, companyEnabled: true, preferences: prefs({ chat: true }), eventLevel: "all", pushWillDeliver: false }),
      { send: false, reason: "category_off" });
  });
});

class MemOutbox implements OutboxStore {
  docs = new Map<string, NewOutboxEntry>();
  async create(e: NewOutboxEntry) { if (this.docs.has(e.id)) return false; this.docs.set(e.id, e); return true; }
  async claim(): Promise<never> { throw new Error("unused"); }
  async finish(): Promise<void> { throw new Error("unused"); }
  async get(): Promise<null> { return null; }
  async recordOpen(): Promise<boolean> { return false; }
}

const facts = { eventId: "e1", eventTitle: "Padel", startTime: "2030-01-02T18:00:00Z", endTime: "2030-01-02T19:00:00Z" };

function deps(over: { enabled?: boolean; company?: boolean | null; map?: Record<string, unknown> | null } = {}) {
  const outbox = new MemOutbox();
  const d: ChannelDeps = {
    outbox, clock: { now: () => new Date("2030-01-01T00:00:00Z") },
    validate: (_t, v) => (v && typeof v === "object" && !("bad" in v) ? (v as never) : null),
    companies: { get: async () => (over.company === null ? null : { enabled: over.company ?? true, dailyCap: 10, timeZone: null }) },
    preferences: { getEmailMap: async () => over.map ?? null, disable: async () => true },
    config: { enabled: over.enabled ?? true },
  };
  return { outbox, d };
}

const candidate = {
  template: "event_changed" as const, variables: { ...facts, changedFields: ["time" as const] }, uid: "u1", companyId: "c1",
  objectId: "e1", revisionOrWindow: "r3", eventLevel: "changes" as SubscriptionLevel | null, pushWillDeliver: true,
};

describe("emailChannel", () => {
  test("enqueues once; the same candidate twice yields one outbox doc", async () => {
    const { outbox, d } = deps();
    const a = await emailChannel(d, candidate);
    const b = await emailChannel(d, candidate);
    assert.deepEqual(a.decision, { send: true });
    assert.equal(a.enqueue?.enqueued, true);
    assert.equal(b.enqueue?.enqueued, false);
    assert.equal(b.enqueue?.reason, "duplicate");
    assert.equal(a.enqueue?.id, "event_updates_e1_u1_r3");
    assert.equal(outbox.docs.size, 1);
    assert.equal(outbox.docs.get("event_updates_e1_u1_r3")!.notAfter, null);
  });

  test("does not enqueue when the policy says no", async () => {
    for (const [over, reason] of [
      [{ enabled: false }, "disabled"], [{ company: false }, "company_disabled"], [{ company: null }, "company_disabled"],
      [{ map: { event_updates: false } }, "category_off"],
    ] as const) {
      const { outbox, d } = deps(over);
      const r = await emailChannel(d, candidate);
      assert.deepEqual(r.decision, { send: false, reason });
      assert.equal(r.enqueue, null);
      assert.equal(outbox.docs.size, 0);
    }
  });

  test("reminders follow the default-off preference", async () => {
    const reminder = { ...candidate, template: "event_reminder" as const, variables: { ...facts, window: "24h" as const }, revisionOrWindow: "24h" };
    assert.equal(resolveEmailPreferences(null).reminders, false);
    assert.equal((await emailChannel(deps().d, reminder)).decision.send, false);
    assert.equal((await emailChannel(deps({ map: { reminders: true } }).d, reminder)).decision.send, true);
  });

  test("challenge email only when push will not deliver", async () => {
    const c = { ...candidate, template: "challenge_reviewed" as const, variables: { challengeId: "ch1", challengeTitle: "T", outcome: "approved" as const }, eventLevel: null };
    assert.deepEqual((await emailChannel(deps().d, { ...c, pushWillDeliver: true })).decision, { send: false, reason: "push_covers" });
    assert.equal((await emailChannel(deps().d, { ...c, pushWillDeliver: false })).enqueue?.enqueued, true);
  });
});

describe("enqueueEmail", () => {
  test("invalid variables and empty ids are not enqueued", async () => {
    const { outbox, d } = deps();
    const bad = await enqueueEmail(d, { ...candidate, variables: { bad: true } as never });
    assert.deepEqual([bad.enqueued, bad.reason], [false, "invalid_variables"]);
    const empty = await enqueueEmail(d, { ...candidate, objectId: "" });
    assert.deepEqual([empty.enqueued, empty.reason], [false, "invalid_input"]);
    assert.equal(outbox.docs.size, 0);
  });

  test("notAfter is stored", async () => {
    const { outbox, d } = deps();
    const notAfter = new Date("2030-01-02T00:00:00Z");
    const r = await enqueueEmail(d, { ...candidate, notAfter });
    assert.equal(outbox.docs.get(r.id)!.notAfter, notAfter);
  });
});
