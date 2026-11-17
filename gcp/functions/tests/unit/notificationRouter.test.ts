import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type {
  DeviceDirectory, DeviceToken, InboxItem, InboxWriter, MessagingPort, PreferencesReader, SendResult,
} from "../../src/modules/notifications/application/ports";
import { deliverNotification, type EmailChannelPort, type NotificationRequest, type RouterDependencies } from "../../src/modules/notifications/application/router";
import type { DeliveryReceipts, PushRateLimiter } from "../../src/modules/notifications/application/routerPorts";
import { sendPush, sendToDevices } from "../../src/modules/notifications/application/sendPush";
import { DEFAULT_RESOLVED_PREFERENCES, resolvePreferences, type ResolvedPreferences } from "../../src/modules/notifications/domain/preferences";
import type { PushMessage } from "../../src/modules/notifications/domain/push";
import { PUSH_RATE_LIMITS, dayBucket, hourBucket, nextCounts, type RateLimitState } from "../../src/modules/notifications/domain/rateLimit";

const message: PushMessage = {
  title: "t", body: "b", category: "event_updates", threadId: "event-e1",
  data: { type: "event_changed", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1" },
};

class Harness {
  sent: { tokens: string[] }[] = [];
  removed: DeviceToken[] = [];
  inbox: InboxItem[] = [];
  inboxFails = false;
  claimed = new Set<string>();
  counts = new Map<string, RateLimitState | null>();
  prefs = new Map<string, ResolvedPreferences>();
  tokens = new Map<string, string[]>();
  failing = new Set<string>();
  now = new Date("2026-03-01T10:15:00Z");

  messaging: MessagingPort = {
    sendMulticast: async (tokens): Promise<SendResult[]> => {
      this.sent.push({ tokens: [...tokens] });
      return tokens.map((token) => this.failing.has(token) ? { success: false, errorCode: "messaging/registration-token-not-registered" } : { success: true });
    },
  };
  devices: DeviceDirectory = {
    tokensFor: async (uids) => uids.flatMap((uid) => (this.tokens.get(uid) ?? []).map((token) => ({ uid, tokenHash: `h-${token}`, token }))),
    remove: async (devices) => { this.removed.push(...devices); },
  };
  preferences: PreferencesReader = {
    preferencesFor: async (uids) => new Map(uids.filter((uid) => this.prefs.has(uid)).map((uid) => [uid, this.prefs.get(uid)!])),
  };
  receipts: DeliveryReceipts = {
    claim: async (id) => { if (this.claimed.has(id)) return false; this.claimed.add(id); return true; },
  };
  rateLimiter: PushRateLimiter = {
    admit: async (uids, now) => {
      const allowed = new Set<string>();
      for (const uid of uids) {
        const { admitted, state } = nextCounts(this.counts.get(uid) ?? null, now);
        this.counts.set(uid, state);
        if (admitted) allowed.add(uid);
      }
      return allowed;
    },
  };
  writer: InboxWriter = {
    createMany: async (items) => {
      if (this.inboxFails) throw new Error("boom");
      let created = 0;
      for (const item of items) {
        if (!this.inbox.some((existing) => existing.uid === item.uid && existing.id === item.id)) { this.inbox.push(item); created++; }
      }
      return created;
    },
  };
  deps(): RouterDependencies {
    return { messaging: this.messaging, devices: this.devices, preferences: this.preferences, receipts: this.receipts, rateLimiter: this.rateLimiter, inbox: this.writer, clock: { now: () => this.now } };
  }
}

function request(overrides: Partial<NotificationRequest> = {}): NotificationRequest {
  return {
    id: "n1", kind: "event_changed", companyId: "c1", push: message,
    recipients: [{ uid: "u1", eventLevel: "changes" }],
    inApp: { title: "Changed", body: "Time moved", targetType: "event", targetId: "e1" },
    ...overrides,
  };
}

describe("deliverNotification precedence", () => {
  test("delivers with defaults when no preference document exists", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1", "tok2"]);
    const stats = await deliverNotification(h.deps(), request());
    assert.deepEqual(stats, { recipients: 1, tokens: 2, sent: 2, failed: 0, removed: 0, duplicate: false, inApp: 1, emailsEnqueued: 0, blocked: { category_off: 0, event_level: 0, no_destination: 0, rate_limited: 0 } });
    assert.deepEqual(h.sent[0]!.tokens, ["tok1", "tok2"]);
  });

  test("category off blocks push but the in-app item is still written", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    h.prefs.set("u1", resolvePreferences({ push: { event_updates: false } }));
    const stats = await deliverNotification(h.deps(), request());
    assert.equal(stats.blocked.category_off, 1);
    assert.equal(stats.sent, 0);
    assert.equal(h.sent.length, 0);
    assert.equal(h.inbox.length, 1);
  });

  test("event level null, none and insufficient block event-scoped kinds", async () => {
    const h = new Harness();
    for (const uid of ["a", "b", "c"]) h.tokens.set(uid, [`tok-${uid}`]);
    const stats = await deliverNotification(h.deps(), request({
      kind: "chat", recipients: [{ uid: "a", eventLevel: null }, { uid: "b", eventLevel: "none" }, { uid: "c", eventLevel: "changes" }],
    }));
    assert.equal(stats.blocked.event_level, 3);
    assert.equal(h.sent.length, 0);
  });

  test("a sufficient level passes; attendee_added ignores the level", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    const chat = await deliverNotification(h.deps(), request({ id: "c1", kind: "chat", recipients: [{ uid: "u1", eventLevel: "all" }] }));
    assert.equal(chat.sent, 1);
    const added = await deliverNotification(h.deps(), request({ id: "a1", kind: "attendee_added", recipients: [{ uid: "u1", eventLevel: "none" }] }));
    assert.equal(added.sent, 1);
    assert.equal(added.blocked.event_level, 0);
  });

  test("no tokens counts no_destination", async () => {
    const h = new Harness();
    const stats = await deliverNotification(h.deps(), request());
    assert.equal(stats.blocked.no_destination, 1);
    assert.equal(h.sent.length, 0);
  });

  test("mixed recipients are counted independently", async () => {
    const h = new Harness();
    h.tokens.set("ok", ["t-ok"]); h.tokens.set("off", ["t-off"]);
    h.prefs.set("off", resolvePreferences({ push: { event_updates: false } }));
    const stats = await deliverNotification(h.deps(), request({
      recipients: [{ uid: "ok", eventLevel: "all" }, { uid: "off", eventLevel: "all" }, { uid: "lvl", eventLevel: "reminders" }, { uid: "none", eventLevel: "all" }],
    }));
    assert.deepEqual(stats.blocked, { category_off: 1, event_level: 1, no_destination: 1, rate_limited: 0 });
    assert.equal(stats.sent, 1);
    assert.equal(stats.recipients, 1);
    assert.deepEqual(h.sent[0]!.tokens, ["t-ok"]);
    assert.ok(DEFAULT_RESOLVED_PREFERENCES.push.event_updates);
  });
});

describe("deliverNotification idempotency and robustness", () => {
  test("replaying the same id sends nothing and keeps one in-app item", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    await deliverNotification(h.deps(), request());
    const second = await deliverNotification(h.deps(), request());
    assert.equal(second.duplicate, true);
    assert.equal(second.sent, 0);
    assert.equal(second.inApp, 0);
    assert.equal(h.sent.length, 1);
    assert.equal(h.inbox.length, 1);
  });

  test("a failed in-app write does not fail delivery and a retry completes it", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    h.inboxFails = true;
    const first = await deliverNotification(h.deps(), request());
    assert.equal(first.sent, 1);
    assert.equal(first.inApp, 0);
    assert.equal(h.inbox.length, 0);
    h.inboxFails = false;
    const retry = await deliverNotification(h.deps(), request());
    assert.equal(retry.duplicate, true);
    assert.equal(retry.inApp, 1);
    assert.equal(h.sent.length, 1);
  });

  test("kinds without an in-app type write no in-app items", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    const stats = await deliverNotification(h.deps(), request({ kind: "chat", recipients: [{ uid: "u1", eventLevel: "all" }] }));
    assert.equal(stats.inApp, 0);
    assert.equal(h.inbox.length, 0);
    assert.equal(stats.sent, 1);
  });

  test("in-app items use the kind's type and the request id", async () => {
    const h = new Harness();
    await deliverNotification(h.deps(), request({ kind: "event_cancelled" }));
    assert.deepEqual(h.inbox, [{ uid: "u1", id: "n1", companyId: "c1", type: "event_cancelled", title: "Changed", body: "Time moved", targetType: "event", targetId: "e1" }]);
  });

  test("duplicate recipients are collapsed, first wins", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    const stats = await deliverNotification(h.deps(), request({ recipients: [{ uid: "u1", eventLevel: "all" }, { uid: "u1", eventLevel: "none" }] }));
    assert.equal(stats.sent, 1);
    assert.equal(h.sent[0]!.tokens.length, 1);
    assert.equal(h.inbox.length, 1);
  });

  test("empty recipients return zero stats without claiming", async () => {
    const h = new Harness();
    const stats = await deliverNotification(h.deps(), request({ recipients: [] }));
    assert.equal(stats.duplicate, false);
    assert.equal(h.claimed.size, 0);
  });

  test("invalid ids throw", async () => {
    const h = new Harness();
    for (const id of ["", "a/b", "a b", "x".repeat(201)]) {
      await assert.rejects(deliverNotification(h.deps(), request({ id })), /INVALID_NOTIFICATION_ID/);
    }
  });

  test("invalid tokens are removed after sending", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["good", "stale"]);
    h.failing.add("stale");
    const stats = await deliverNotification(h.deps(), request());
    assert.equal(stats.sent, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.removed, 1);
    assert.deepEqual(h.removed.map((d) => d.token), ["stale"]);
  });
});

describe("deliverNotification rate caps", () => {
  test("the 21st push in one hour is blocked", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    let last = await deliverNotification(h.deps(), request({ id: "n0" }));
    for (let i = 1; i <= PUSH_RATE_LIMITS.perHour; i++) last = await deliverNotification(h.deps(), request({ id: `n${i}` }));
    assert.equal(last.blocked.rate_limited, 1);
    assert.equal(last.sent, 0);
    assert.equal(h.sent.length, PUSH_RATE_LIMITS.perHour);
  });

  test("the day cap holds across hours and resets on the next day", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    let n = 0;
    for (let hour = 0; hour < 5; hour++) {
      h.now = new Date(Date.UTC(2026, 2, 1, hour, 0, 0));
      for (let i = 0; i < 20; i++) await deliverNotification(h.deps(), request({ id: `n${n++}` }));
    }
    assert.equal(h.sent.length, PUSH_RATE_LIMITS.perDay);
    h.now = new Date(Date.UTC(2026, 2, 1, 6, 0, 0));
    const blocked = await deliverNotification(h.deps(), request({ id: `n${n++}` }));
    assert.equal(blocked.blocked.rate_limited, 1);
    h.now = new Date(Date.UTC(2026, 2, 2, 0, 0, 0));
    const reset = await deliverNotification(h.deps(), request({ id: `n${n++}` }));
    assert.equal(reset.sent, 1);
  });

  test("hour rollover resets the hour count", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    for (let i = 0; i < 20; i++) await deliverNotification(h.deps(), request({ id: `n${i}` }));
    h.now = new Date("2026-03-01T11:00:00Z");
    assert.equal((await deliverNotification(h.deps(), request({ id: "later" }))).sent, 1);
  });

  test("blocked pushes do not consume the cap and users are independent", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["t1"]); h.tokens.set("u2", ["t2"]);
    h.prefs.set("u1", resolvePreferences({ push: { event_updates: false } }));
    for (let i = 0; i < 30; i++) await deliverNotification(h.deps(), request({ id: `n${i}`, recipients: [{ uid: "u1", eventLevel: "all" }, { uid: "u2", eventLevel: "all" }] }));
    assert.equal(h.counts.get("u1"), undefined);
    assert.equal(h.counts.get("u2")!.hourCount, 20);
  });
});

describe("deliverNotification email hook", () => {
  const emailPayload = { template: "event_changed", variables: {}, objectId: "e1", revisionOrWindow: "r1" };
  type Call = { uid: string; pushWillDeliver: boolean };
  function channel(calls: Call[], result: (uid: string) => boolean | Error = () => true): EmailChannelPort {
    return {
      deliver: async (_request, recipient, pushWillDeliver) => {
        calls.push({ uid: recipient.uid, pushWillDeliver });
        const r = result(recipient.uid);
        if (r instanceof Error) throw r;
        return r;
      },
    };
  }

  test("without an email dependency or request.email the channel is never called", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    const calls: Call[] = [];
    const noPayload = await deliverNotification({ ...h.deps(), email: channel(calls) }, request({ id: "a" }));
    assert.equal(noPayload.emailsEnqueued, 0);
    const noDep = await deliverNotification(h.deps(), request({ id: "b", email: emailPayload }));
    assert.equal(noDep.emailsEnqueued, 0);
    assert.equal(calls.length, 0);
    assert.equal(noPayload.sent, 1);
  });

  test("called once per unique recipient; pushWillDeliver is true only for admitted uids", async () => {
    const h = new Harness();
    h.tokens.set("ok", ["t-ok"]); h.tokens.set("limited", ["t-lim"]);
    h.rateLimiter = { admit: async (uids) => new Set(uids.filter((uid) => uid !== "limited")) };
    const calls: Call[] = [];
    const stats = await deliverNotification({ ...h.deps(), email: channel(calls) }, request({
      email: emailPayload,
      recipients: [
        { uid: "ok", eventLevel: "all" }, { uid: "ok", eventLevel: "all" },
        { uid: "limited", eventLevel: "all" }, { uid: "tokenless", eventLevel: "all" },
      ],
    }));
    assert.deepEqual(calls.sort((a, b) => a.uid.localeCompare(b.uid)), [
      { uid: "limited", pushWillDeliver: false }, { uid: "ok", pushWillDeliver: true }, { uid: "tokenless", pushWillDeliver: false },
    ]);
    assert.equal(stats.emailsEnqueued, 3);
    assert.equal(stats.blocked.rate_limited, 1);
    assert.equal(stats.blocked.no_destination, 1);
  });

  test("only enqueued deliveries are counted", async () => {
    const h = new Harness();
    const calls: Call[] = [];
    const stats = await deliverNotification({ ...h.deps(), email: channel(calls, (uid) => uid === "a") }, request({
      email: emailPayload, recipients: [{ uid: "a", eventLevel: "all" }, { uid: "b", eventLevel: "all" }],
    }));
    assert.equal(calls.length, 2);
    assert.equal(stats.emailsEnqueued, 1);
  });

  test("a throwing email channel does not block the push or change push stats", async () => {
    const baseline = new Harness();
    baseline.tokens.set("u1", ["tok1", "tok2"]);
    const expected = await deliverNotification(baseline.deps(), request());
    const h = new Harness();
    h.tokens.set("u1", ["tok1", "tok2"]);
    const calls: Call[] = [];
    const stats = await deliverNotification({ ...h.deps(), email: channel(calls, () => new Error("smtp down")) }, request({ email: emailPayload }));
    assert.equal(calls.length, 1);
    assert.deepEqual(stats, expected);
    assert.equal(stats.sent, 2);
    assert.equal(stats.emailsEnqueued, 0);
    assert.equal(h.inbox.length, 1);
  });

  test("a duplicate notification id does not call the email channel again", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    const calls: Call[] = [];
    const deps = { ...h.deps(), email: channel(calls) };
    const first = await deliverNotification(deps, request({ email: emailPayload }));
    assert.equal(first.emailsEnqueued, 1);
    const second = await deliverNotification(deps, request({ email: emailPayload }));
    assert.equal(second.duplicate, true);
    assert.equal(second.emailsEnqueued, 0);
    assert.equal(calls.length, 1);
  });
});

describe("rateLimit domain", () => {
  test("buckets are UTC", () => {
    const at = new Date("2026-12-31T23:59:59Z");
    assert.equal(hourBucket(at), "2026-12-31T23");
    assert.equal(dayBucket(at), "2026-12-31");
  });

  test("first call admits and starts counts at one", () => {
    const { admitted, state } = nextCounts(null, new Date("2026-03-01T10:00:00Z"));
    assert.equal(admitted, true);
    assert.deepEqual(state, { hourKey: "2026-03-01T10", hourCount: 1, dayKey: "2026-03-01", dayCount: 1 });
  });

  test("hour cap blocks without incrementing; the next hour admits", () => {
    const state: RateLimitState = { hourKey: "2026-03-01T10", hourCount: 20, dayKey: "2026-03-01", dayCount: 20 };
    const blocked = nextCounts(state, new Date("2026-03-01T10:30:00Z"));
    assert.equal(blocked.admitted, false);
    assert.deepEqual(blocked.state, state);
    const next = nextCounts(state, new Date("2026-03-01T11:00:00Z"));
    assert.equal(next.admitted, true);
    assert.deepEqual(next.state, { hourKey: "2026-03-01T11", hourCount: 1, dayKey: "2026-03-01", dayCount: 21 });
  });

  test("day cap blocks in a fresh hour; the next day resets both", () => {
    const state: RateLimitState = { hourKey: "2026-03-01T09", hourCount: 3, dayKey: "2026-03-01", dayCount: 100 };
    assert.equal(nextCounts(state, new Date("2026-03-01T10:00:00Z")).admitted, false);
    const next = nextCounts(state, new Date("2026-03-02T09:00:00Z"));
    assert.equal(next.admitted, true);
    assert.deepEqual(next.state, { hourKey: "2026-03-02T09", hourCount: 1, dayKey: "2026-03-02", dayCount: 1 });
  });
});

describe("sendToDevices", () => {
  test("dedupes tokens, counts distinct users and batches by 500", async () => {
    const h = new Harness();
    const devices: DeviceToken[] = [];
    for (let i = 0; i < 1001; i++) devices.push({ uid: `u${i % 3}`, tokenHash: `h${i}`, token: `t${i}` });
    devices.push({ uid: "u0", tokenHash: "dup", token: "t0" });
    const stats = await sendToDevices(h, devices, message);
    assert.deepEqual(stats, { recipients: 3, tokens: 1001, sent: 1001, failed: 0, removed: 0 });
    assert.deepEqual(h.sent.map((call) => call.tokens.length), [500, 500, 1]);
  });

  test("sendPush wrapper reports unique requested users", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["a"]);
    const stats = await sendPush(h, ["u1", "u1", "u2"], message);
    assert.deepEqual(stats, { recipients: 2, tokens: 1, sent: 1, failed: 0, removed: 0 });
    assert.deepEqual(await sendPush(h, [], message), { recipients: 0, tokens: 0, sent: 0, failed: 0, removed: 0 });
  });
});
