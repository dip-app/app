import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { emailChannel, enqueueEmail, type ChannelDeps } from "../../functions/src/modules/email/application/enqueueEmail";
import type { NewOutboxEntry, OutboxStore } from "../../functions/src/modules/email/application/ports";
import { EMAIL_CATEGORIES, EMAIL_DEFAULTS } from "../../functions/src/modules/email/domain/categories";
import { decideEmail, type EmailRoutingInput } from "../../functions/src/modules/email/domain/policy";

const base: EmailRoutingInput = {
  category: "event_updates", globalEnabled: true, companyEnabled: true, emailPreference: true,
  eventLevel: "all", eventScoped: true, pushWillDeliver: true,
};

describe("decideEmail matrix", () => {
  test("global and company flags", () => {
    assert.deepEqual(decideEmail({ ...base, globalEnabled: false }), { send: false, reason: "disabled" });
    assert.deepEqual(decideEmail({ ...base, companyEnabled: false }), { send: false, reason: "company_disabled" });
  });

  test("categories email never offers", () => {
    for (const category of ["chat", "social", "discovery", ""]) assert.deepEqual(decideEmail({ ...base, category }), { send: false, reason: "not_offered" });
  });

  test("category x preference x level x push", () => {
    for (const category of EMAIL_CATEGORIES) {
      for (const emailPreference of [true, false]) {
        for (const eventScoped of [true, false]) {
          for (const eventLevel of [null, "all", "changes", "reminders", "none"]) {
            for (const pushWillDeliver of [true, false]) {
              const got = decideEmail({ category, globalEnabled: true, companyEnabled: true, emailPreference, eventLevel, eventScoped, pushWillDeliver });
              let want: string | true = true;
              if (!emailPreference) want = "preference_off";
              else if (eventScoped && (category === "event_updates" || category === "reminders")) {
                const level = eventLevel ?? "changes";
                const ok = category === "event_updates" ? ["all", "changes"].includes(level) : ["all", "changes", "reminders"].includes(level);
                if (!ok) want = "event_level";
              }
              if (want === true && category === "challenges" && pushWillDeliver) want = "push_covers";
              assert.deepEqual(got, want === true ? { send: true } : { send: false, reason: want }, JSON.stringify({ category, emailPreference, eventScoped, eventLevel, pushWillDeliver }));
            }
          }
        }
      }
    }
  });

  test("invites ignore push and event level", () => {
    assert.deepEqual(decideEmail({ ...base, category: "invites", eventLevel: "none", pushWillDeliver: true }), { send: true });
  });
});

class MemOutbox implements OutboxStore {
  docs = new Map<string, NewOutboxEntry>();
  async create(e: NewOutboxEntry) { if (this.docs.has(e.id)) return false; this.docs.set(e.id, e); return true; }
  async claim(): Promise<never> { throw new Error("unused"); }
  async finish(): Promise<void> { throw new Error("unused"); }
  async get(): Promise<null> { return null; }
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
  objectId: "e1", revisionOrWindow: "r3", eventScoped: true, eventLevel: "changes", pushWillDeliver: true,
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
      [{ map: { event_updates: false } }, "preference_off"],
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
    assert.equal(EMAIL_DEFAULTS.reminders, false);
    assert.equal((await emailChannel(deps().d, reminder)).decision.send, false);
    assert.equal((await emailChannel(deps({ map: { reminders: true } }).d, reminder)).decision.send, true);
  });

  test("challenge email only when push will not deliver", async () => {
    const c = { ...candidate, template: "challenge_reviewed" as const, variables: { challengeId: "ch1", challengeTitle: "T", outcome: "approved" as const }, eventScoped: false, eventLevel: null };
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
