import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type {
  DeviceDirectory, DeviceToken, InboxItem, InboxWriter, MessagingPort, PreferencesReader, SendResult,
} from "../../src/modules/notifications/application/ports";
import { deliverNotification, type EmailChannelPort, type NotificationRequest, type RouterDependencies } from "../../src/modules/notifications/application/router";
import type { DeliveryLog, DeliveryReceipts, PushRateLimiter } from "../../src/modules/notifications/application/routerPorts";
import { sendPush, sendToDevices } from "../../src/modules/notifications/application/sendPush";
import { DEFAULT_RESOLVED_PREFERENCES, resolvePreferences, type ResolvedPreferences } from "../../src/modules/notifications/domain/preferences";
import type { PushMessage } from "../../src/modules/notifications/domain/push";
import { MAX_EVENT_AGE_MS, isStaleEvent } from "../../src/modules/notifications/domain/staleness";
import { PUSH_RATE_LIMITS, RATE_CLASS_LIMITS, dayBucket, hourBucket, nextCounts, rateClassOf, type RateLimitState } from "../../src/modules/notifications/domain/rateLimit";

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
  /** Receipt state: key -> {state, leaseUntil}. `claimed` mirrors every key ever claimed. */
  receiptState = new Map<string, { state: "processing" | "done" | undefined; leaseUntil: number }>();
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
    claim: async (id) => {
      const existing = this.receiptState.get(id);
      if (existing) {
        const expired = existing.state === "processing" && existing.leaseUntil <= this.now.getTime();
        if (!expired) return false;
      }
      this.claimed.add(id);
      this.receiptState.set(id, { state: "processing", leaseUntil: this.now.getTime() + 5 * 60_000 });
      return true;
    },
    complete: async (id) => { this.receiptState.set(id, { state: "done", leaseUntil: 0 }); },
    isDone: async (id) => { const r = this.receiptState.get(id); return !!r && r.state !== "processing"; },
  };
  rateLimiter: PushRateLimiter = {
    admit: async (uids, now, rateClass) => {
      const allowed = new Set<string>();
      for (const uid of uids) {
        const { admitted, state } = nextCounts(this.counts.get(uid) ?? null, now, rateClass);
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
  /** When set, the membership reader only admits these uids. */
  active: Set<string> | null = null;
  logs: { level: string; message: string; fields: Record<string, unknown> }[] = [];
  logger: DeliveryLog = {
    info: (message, fields) => { this.logs.push({ level: "info", message, fields }); },
    warn: (message, fields) => { this.logs.push({ level: "warn", message, fields }); },
    error: (message, fields) => { this.logs.push({ level: "error", message, fields }); },
  };
  deps(): RouterDependencies {
    return {
      messaging: this.messaging, devices: this.devices, preferences: this.preferences, receipts: this.receipts, rateLimiter: this.rateLimiter, inbox: this.writer,
      logger: this.logger, ...(this.active ? { members: { activeIn: async (_c: string, uids: readonly string[]) => new Set(uids.filter((uid) => this.active!.has(uid))) } } : {}),
      clock: { now: () => this.now },
    };
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
    assert.deepEqual(stats, { recipients: 1, tokens: 2, sent: 2, failed: 0, removed: 0, duplicate: false, inApp: 1, emailsEnqueued: 0, blocked: { category_off: 0, event_level: 0, no_destination: 0, rate_limited: 0, inactive: 0 } });
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
    assert.deepEqual(stats.blocked, { category_off: 1, event_level: 1, no_destination: 1, rate_limited: 0, inactive: 0 });
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
  // The shared 20/hour, 100/day bucket applies to kinds without their own class (invite_answered here).
  const capped = (overrides: Partial<NotificationRequest>) => request({ kind: "invite_answered", ...overrides });
  test("the 21st push in one hour is blocked", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    let last = await deliverNotification(h.deps(), capped({ id: "n0" }));
    for (let i = 1; i <= PUSH_RATE_LIMITS.perHour; i++) last = await deliverNotification(h.deps(), capped({ id: `n${i}` }));
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
      for (let i = 0; i < 20; i++) await deliverNotification(h.deps(), capped({ id: `n${n++}` }));
    }
    assert.equal(h.sent.length, PUSH_RATE_LIMITS.perDay);
    h.now = new Date(Date.UTC(2026, 2, 1, 6, 0, 0));
    const blocked = await deliverNotification(h.deps(), capped({ id: `n${n++}` }));
    assert.equal(blocked.blocked.rate_limited, 1);
    h.now = new Date(Date.UTC(2026, 2, 2, 0, 0, 0));
    const reset = await deliverNotification(h.deps(), capped({ id: `n${n++}` }));
    assert.equal(reset.sent, 1);
  });

  test("hour rollover resets the hour count", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    for (let i = 0; i < 20; i++) await deliverNotification(h.deps(), capped({ id: `n${i}` }));
    h.now = new Date("2026-03-01T11:00:00Z");
    assert.equal((await deliverNotification(h.deps(), capped({ id: "later" }))).sent, 1);
  });

  test("blocked pushes do not consume the cap and users are independent", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["t1"]); h.tokens.set("u2", ["t2"]);
    h.prefs.set("u1", resolvePreferences({ push: { invites: false } }));
    for (let i = 0; i < 30; i++) await deliverNotification(h.deps(), capped({ id: `n${i}`, recipients: [{ uid: "u1", eventLevel: "all" }, { uid: "u2", eventLevel: "all" }] }));
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

describe("rate classes", () => {
  test("a saturated chat bucket never blocks event_cancelled, reminder or event_changed", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]);
    const chat = (id: string) => request({ id, kind: "chat", recipients: [{ uid: "u1", eventLevel: "all" }] });
    for (let i = 0; i < 40; i++) await deliverNotification(h.deps(), chat(`c${i}`));
    assert.equal(h.sent.length, RATE_CLASS_LIMITS.chat.perHour, "chat is capped by its own bucket");
    const cancelled = await deliverNotification(h.deps(), request({ id: "x1", kind: "event_cancelled", recipients: [{ uid: "u1", eventLevel: "all" }] }));
    const reminder = await deliverNotification(h.deps(), request({ id: "x2", kind: "reminder", recipients: [{ uid: "u1", eventLevel: "all" }] }));
    const changed = await deliverNotification(h.deps(), request({ id: "x3", kind: "event_changed", recipients: [{ uid: "u1", eventLevel: "all" }] }));
    for (const stats of [cancelled, reminder, changed]) assert.equal(stats.sent, 1);
    // The shared bucket is untouched by chat.
    const invite = await deliverNotification(h.deps(), request({ id: "x4", kind: "invite_answered", recipients: [{ uid: "u1" }] }));
    assert.equal(invite.sent, 1);
    assert.equal(h.counts.get("u1")!.hourCount, 1);
  });

  test("exempt kinds are never counted and never limited", () => {
    const now = new Date("2026-03-01T10:00:00Z");
    let state: RateLimitState | null = null;
    for (let i = 0; i < 500; i++) {
      const step = nextCounts(state, now, "exempt");
      assert.equal(step.admitted, true);
      state = step.state;
    }
    assert.equal(state!.hourCount, 0);
  });

  test("event_changed has its own generous bucket, separate from shared", () => {
    const now = new Date("2026-03-01T10:00:00Z");
    let state: RateLimitState | null = null;
    for (let i = 0; i < RATE_CLASS_LIMITS.changes.perHour; i++) state = nextCounts(state, now, rateClassOf("event_changed")).state;
    assert.equal(nextCounts(state, now, "changes").admitted, false);
    assert.equal(nextCounts(state, now, "shared").admitted, true);
  });

  test("documents stored before buckets existed read as zero for new classes and keep shared counts", () => {
    const legacy: RateLimitState = { hourKey: hourBucket(new Date("2026-03-01T10:00:00Z")), hourCount: 7, dayKey: "2026-03-01", dayCount: 9 };
    const chat = nextCounts(legacy, new Date("2026-03-01T10:30:00Z"), "chat");
    assert.equal(chat.admitted, true);
    assert.equal(chat.state.buckets?.chat?.hourCount, 1);
    assert.equal(chat.state.hourCount, 7);
    const shared = nextCounts(chat.state, new Date("2026-03-01T10:31:00Z"), "shared");
    assert.equal(shared.state.hourCount, 8);
    assert.equal(shared.state.buckets?.chat?.hourCount, 1, "shared step preserves chat bucket");
  });
});

describe("two-phase receipts", () => {
  const T0 = new Date("2026-03-01T10:00:00Z");

  test("crash after the claim: a retry within the lease is a duplicate, after expiry it delivers", async () => {
    const h = new Harness(); h.tokens.set("u1", ["tok1"]); h.now = T0;
    const realTokens = h.devices.tokensFor;
    h.devices = { ...h.devices, tokensFor: async () => { throw new Error("crash"); } };
    await assert.rejects(deliverNotification(h.deps(), request()));
    assert.equal(h.receiptState.get("c1/n1")!.state, "processing");
    h.devices = { ...h.devices, tokensFor: realTokens };

    h.now = new Date(T0.getTime() + 60_000);
    const within = await deliverNotification(h.deps(), request());
    assert.equal(within.duplicate, true);
    assert.equal(within.inProgress, true);
    assert.equal(h.sent.length, 0);

    h.now = new Date(T0.getTime() + 6 * 60_000);
    const after = await deliverNotification(h.deps(), request());
    assert.equal(after.duplicate, false);
    assert.equal(after.sent, 1);
    assert.equal(h.receiptState.get("c1/n1")!.state, "done");
  });

  test("a done receipt stays a duplicate after the lease time; a legacy receipt without state is done", async () => {
    const h = new Harness(); h.tokens.set("u1", ["tok1"]); h.now = T0;
    assert.equal((await deliverNotification(h.deps(), request())).sent, 1);
    h.now = new Date(T0.getTime() + 24 * 3_600_000);
    const again = await deliverNotification(h.deps(), request());
    assert.equal(again.duplicate, true);
    assert.equal(again.inProgress, undefined);
    h.receiptState.set("c1/legacy", { state: undefined, leaseUntil: 0 });
    const legacy = await deliverNotification(h.deps(), request({ id: "legacy" }));
    assert.equal(legacy.duplicate, true);
    assert.equal(await h.receipts.isDone("c1/legacy"), true);
    assert.equal(h.sent.length, 1);
  });
});

describe("membership at send time", () => {
  test("recipients who are inactive or in another company are dropped and counted as blocked.inactive", async () => {
    const h = new Harness();
    h.tokens.set("in", ["t-in"]); h.tokens.set("gone", ["t-gone"]);
    h.active = new Set(["in"]);
    const stats = await deliverNotification(h.deps(), request({ recipients: [{ uid: "in", eventLevel: "all" }, { uid: "gone", eventLevel: "all" }] }));
    assert.equal(stats.blocked.inactive, 1);
    assert.deepEqual(h.sent.map((s) => s.tokens), [["t-in"]]);
    assert.deepEqual(h.inbox.map((i) => i.uid), ["in"], "no in-app item for the dropped recipient");
  });

  test("when every recipient is inactive nothing is claimed", async () => {
    const h = new Harness();
    h.tokens.set("gone", ["t"]); h.active = new Set();
    const stats = await deliverNotification(h.deps(), request({ recipients: [{ uid: "gone", eventLevel: "all" }] }));
    assert.equal(stats.blocked.inactive, 1);
    assert.equal(h.claimed.size, 0);
  });
});

describe("failure logging", () => {
  test("in-app and email failures are logged without message text, and sends log aggregated FCM codes without tokens", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["SECRET-TOKEN-1"]); h.tokens.set("u2", ["SECRET-TOKEN-2"]);
    h.inboxFails = true;
    h.messaging = { sendMulticast: async (t) => t.map(() => ({ success: false, errorCode: "messaging/third-party-auth-error" })) };
    const email: EmailChannelPort = { deliver: async () => { throw new Error("user@example.com bounced"); } };
    await deliverNotification({ ...h.deps(), email }, request({
      recipients: [{ uid: "u1", eventLevel: "all" }, { uid: "u2", eventLevel: "all" }],
      email: { template: "event_changed", variables: {}, objectId: "e1", revisionOrWindow: "r1" },
    }));
    const levels = h.logs.map((l) => `${l.level}:${l.message}`);
    assert.ok(levels.includes("warn:in-app write failed"));
    assert.ok(levels.includes("warn:email delivery failed"));
    const send = h.logs.find((l) => l.message.startsWith("push send failed"))!;
    assert.equal(send.level, "error", "a wrong APNs key is an error");
    assert.deepEqual(send.fields.errorCodes, { "messaging/third-party-auth-error": 2 });
    assert.equal(send.fields.notificationId, "n1");
    assert.equal(send.fields.companyId, "c1");
    const serialized = JSON.stringify(h.logs);
    for (const secret of ["SECRET-TOKEN", "example.com", "Time moved"]) assert.equal(serialized.includes(secret), false, secret);
  });

  test("stale-token errors alone are not logged, a throwing batch is", async () => {
    const h = new Harness();
    h.tokens.set("u1", ["tok1"]); h.failing.add("tok1");
    await deliverNotification(h.deps(), request());
    assert.deepEqual(h.logs.map((entry) => entry.level), ["info"]);
    assert.equal(h.logs[0]!.message, "notification delivered");
    assert.equal(h.logs[0]!.fields.notificationId, "n1");
    assert.equal(h.logs[0]!.fields.sent, 0);
    assert.equal(JSON.stringify(h.logs).includes("tok1"), false);
    const h2 = new Harness();
    h2.tokens.set("u1", ["tok1"]);
    h2.messaging = { sendMulticast: async () => { throw Object.assign(new Error("tok1 leaked?"), { code: "app/network-error" }); } };
    await deliverNotification(h2.deps(), request());
    assert.equal(h2.logs[0]!.level, "error");
    assert.equal(h2.logs.at(-1)!.message, "notification delivered");
    assert.equal(JSON.stringify(h2.logs).includes("tok1"), false);
  });

  test("emails are delivered with bounded parallelism", async () => {
    const h = new Harness();
    let inFlight = 0; let peak = 0;
    const email: EmailChannelPort = {
      deliver: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; return true; },
    };
    const recipients = Array.from({ length: 70 }, (_, i) => ({ uid: `u${i}`, eventLevel: "all" as const }));
    const stats = await deliverNotification({ ...h.deps(), email }, request({ recipients, email: { template: "event_changed", variables: {}, objectId: "e1", revisionOrWindow: "r1" } }));
    assert.equal(stats.emailsEnqueued, 70);
    assert.ok(peak > 1 && peak <= 20, `peak ${peak}`);
  });
});

describe("isStaleEvent", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  test("older than the cutoff is stale, younger or equal is not", () => {
    assert.equal(isStaleEvent("2026-03-01T11:49:59Z", now, MAX_EVENT_AGE_MS.chat), true);
    assert.equal(isStaleEvent("2026-03-01T11:50:00Z", now, MAX_EVENT_AGE_MS.chat), false);
    assert.equal(isStaleEvent("2026-03-01T10:59:59Z", now, MAX_EVENT_AGE_MS.eventChange), true);
    assert.equal(isStaleEvent("2026-03-01T11:30:00Z", now, MAX_EVENT_AGE_MS.rsvp), false);
  });
  test("future, missing and unparseable times are not stale", () => {
    assert.equal(isStaleEvent("2026-03-01T13:00:00Z", now, 1), false);
    assert.equal(isStaleEvent(undefined, now, 1), false);
    assert.equal(isStaleEvent("garbage", now, 1), false);
  });
});
