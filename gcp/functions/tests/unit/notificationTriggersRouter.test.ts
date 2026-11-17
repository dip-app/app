import { strict as assert } from "node:assert";
import { afterEach, describe, test } from "node:test";
import { onChatMessageCreatedViaRouter, onEventDocumentUpdatedViaRouter, sendDueRemindersViaRouter } from "../../src/modules/notifications/application/handlers";
import type {
  ChangeLogStore, DeviceToken, EventSummary, InboxItem, MessagingPort, PreferencesReader, SendResult,
} from "../../src/modules/notifications/application/ports";
import type { RouterDependencies } from "../../src/modules/notifications/application/router";
import { mergeChangeLog, type ChangeLogEntry } from "../../src/modules/notifications/domain/changeLog";
import { resolvePreferences, type ResolvedPreferences } from "../../src/modules/notifications/domain/preferences";
import type { PushMessage } from "../../src/modules/notifications/domain/push";
import type { SubscriptionLevel } from "../../src/modules/notifications/domain/subscription";
import { deliveryMode } from "../../src/modules/notifications/transport/notificationFunctions";

const HOUR = 3_600_000;
const NOW = new Date("2030-01-01T12:00:00Z");
const C = "alpha";
const E = "event";

class Harness {
  sent: { tokens: string[]; message: PushMessage }[] = [];
  inbox: InboxItem[] = [];
  receipts = new Set<string>();
  subs = new Map<string, SubscriptionLevel>();
  going = new Set<string>();
  tokens = new Map<string, string[]>();
  prefs = new Map<string, ResolvedPreferences>();
  events = new Map<string, EventSummary>();
  logs = new Map<string, unknown[]>();

  join(uid: string, level: SubscriptionLevel, going = true) {
    this.subs.set(uid, level);
    if (going) this.going.add(uid);
    this.tokens.set(uid, [`tok-${uid}`]);
  }

  messaging: MessagingPort = {
    sendMulticast: async (tokens, message): Promise<SendResult[]> => { this.sent.push({ tokens: [...tokens], message }); return tokens.map(() => ({ success: true })); },
  };
  recipients = {
    subscribers: async (_c: string, _e: string, levels: readonly SubscriptionLevel[]) => [...this.subs].filter(([, l]) => levels.includes(l)).map(([uid]) => uid),
    subscribersWithLevels: async (_c: string, _e: string, levels: readonly SubscriptionLevel[]) =>
      [...this.subs].filter(([, l]) => levels.includes(l)).map(([uid, level]) => ({ uid, level })),
    going: async (_c: string, _e: string, uids: readonly string[]) => new Set(uids.filter((uid) => this.going.has(uid))),
  };
  eventReader = { get: async (c: string, e: string) => this.events.get(`${c}/${e}`) ?? null };
  upcoming = { scheduledStartingIn: async (from: Date, to: Date) => [...this.events.values()].filter((e) => e.startTime > from && e.startTime <= to) };
  changeLog: ChangeLogStore = {
    append: async (c, e, entry: ChangeLogEntry) => {
      const { log, appended } = mergeChangeLog(this.logs.get(`${c}/${e}`), entry);
      this.logs.set(`${c}/${e}`, log);
      return appended;
    },
  };
  preferences: PreferencesReader = {
    preferencesFor: async (uids) => new Map(uids.filter((u) => this.prefs.has(u)).map((u) => [u, this.prefs.get(u)!])),
  };

  deps() {
    const router: RouterDependencies = {
      messaging: this.messaging,
      devices: {
        tokensFor: async (uids) => uids.flatMap((uid) => (this.tokens.get(uid) ?? []).map((token): DeviceToken => ({ uid, tokenHash: `h-${token}`, token }))),
        remove: async () => undefined,
      },
      preferences: this.preferences,
      receipts: { claim: async (id) => { if (this.receipts.has(id)) return false; this.receipts.add(id); return true; } },
      rateLimiter: { admit: async (uids) => new Set(uids) },
      inbox: {
        createMany: async (items) => {
          let created = 0;
          for (const item of items) if (!this.inbox.some((i) => i.uid === item.uid && i.id === item.id)) { this.inbox.push(item); created++; }
          return created;
        },
      },
      clock: { now: () => NOW },
    };
    return { ...router, recipients: this.recipients, events: this.eventReader, upcoming: this.upcoming, changeLog: this.changeLog };
  }
}

function harness() {
  const h = new Harness();
  h.events.set(`${C}/${E}`, { companyId: C, eventId: E, title: "Sunset run", status: "scheduled", startTime: new Date(NOW.getTime() + 30 * 60_000), endTime: new Date(NOW.getTime() + 2 * HOUR) });
  return h;
}

describe("chat via router", () => {
  test("recipients are going `all` subscribers except the author, carrying their level; id is chat_{messageId}", async () => {
    const h = harness();
    h.join("author", "all"); h.join("fan", "all"); h.join("quiet", "none"); h.join("changes", "changes"); h.join("former", "all", false);
    const stats = await onChatMessageCreatedViaRouter(h.deps(), C, E, "m1", { authorId: "author", authorName: "Au", text: "Hi" });
    assert.equal(stats.sent, 1);
    assert.deepEqual(h.sent.map((s) => s.tokens), [["tok-fan"]]);
    assert.ok(h.receipts.has(`${C}/chat_m1`));
    assert.equal(h.inbox.length, 0, "chat has no in-app notice");
  });

  test("a member with chat push switched off gets nothing; others still do", async () => {
    const h = harness();
    h.join("a", "all"); h.join("b", "all");
    h.prefs.set("a", resolvePreferences({ push: { chat: false } }));
    const stats = await onChatMessageCreatedViaRouter(h.deps(), C, E, "m1", { authorId: "x", authorName: "X", text: "Hi" });
    assert.deepEqual(h.sent.flatMap((s) => s.tokens), ["tok-b"]);
    assert.equal(stats.blocked.category_off, 1);
  });

  test("a replayed message id sends once", async () => {
    const h = harness();
    h.join("fan", "all");
    const message = { authorId: "x", authorName: "X", text: "Hi" };
    await onChatMessageCreatedViaRouter(h.deps(), C, E, "m1", message);
    const second = await onChatMessageCreatedViaRouter(h.deps(), C, E, "m1", message);
    assert.equal(second.duplicate, true);
    assert.equal(h.sent.length, 1);
  });

  test("cancelled or missing events and malformed messages deliver nothing", async () => {
    const h = harness();
    h.join("fan", "all");
    await onChatMessageCreatedViaRouter(h.deps(), C, "missing", "m", { authorId: "x", text: "y" });
    await onChatMessageCreatedViaRouter(h.deps(), C, E, "m", { authorId: 1, text: "y" });
    h.events.get(`${C}/${E}`)!.status = "cancelled";
    await onChatMessageCreatedViaRouter(h.deps(), C, E, "m2", { authorId: "x", text: "y" });
    assert.equal(h.sent.length, 0);
    assert.equal(h.receipts.size, 0);
  });
});

const before = {
  title: "Sunset run", description: "", tagIds: [], coverImageURL: "c", startTime: new Date(NOW.getTime() + 5 * HOUR), endTime: new Date(NOW.getTime() + 6 * HOUR),
  venue: { name: "Park", address: "1", locality: "P", latitude: 1, longitude: 1 }, costCents: 0, costNote: "", capacity: 10, isOutdoor: true,
  status: "scheduled", attendeeCount: 3, revision: 4, createdBy: "org",
};

describe("event change via router", () => {
  test("editor excluded, levels carried, in-app notice written by the router with the legacy id and fields", async () => {
    const h = harness();
    h.join("editor", "all"); h.join("fan", "changes"); h.join("muted", "reminders");
    const result = await onEventDocumentUpdatedViaRouter(h.deps(), C, E, before, { ...before, title: "Sunrise run", revision: 5, updatedBy: "editor" }, NOW);
    assert.equal(result.appended, true);
    assert.deepEqual(h.sent.map((s) => s.tokens), [["tok-fan"]]);
    assert.equal(h.sent[0]!.message.data.type, "event_changed");
    assert.deepEqual(h.inbox.map((i) => ({ uid: i.uid, id: i.id, type: i.type, title: i.title, targetType: i.targetType, targetId: i.targetId })),
      [{ uid: "fan", id: "event_event_5", type: "event_updated", title: "Sunrise run", targetType: "event", targetId: E }]);
    assert.ok(h.receipts.has(`${C}/event_event_5`));
  });

  test("a change to cancelled uses the event_cancelled kind and in-app type", async () => {
    const h = harness();
    h.join("fan", "changes");
    await onEventDocumentUpdatedViaRouter(h.deps(), C, E, before, { ...before, status: "cancelled", revision: 5, updatedBy: "editor" }, NOW);
    assert.equal(h.inbox[0]!.type, "event_cancelled");
    assert.equal(h.sent.length, 1);
  });

  test("event_updates switched off blocks the push, but the in-app notice remains", async () => {
    const h = harness();
    h.join("fan", "changes");
    h.prefs.set("fan", resolvePreferences({ push: { event_updates: false } }));
    await onEventDocumentUpdatedViaRouter(h.deps(), C, E, before, { ...before, title: "New", revision: 5, updatedBy: "editor" }, NOW);
    assert.equal(h.sent.length, 0);
    assert.equal(h.inbox.length, 1);
  });

  test("duplicate entries, cancelled-to-cancelled and ended events do not notify", async () => {
    const h = harness();
    h.join("fan", "changes");
    const edited = { ...before, title: "New", revision: 5, updatedBy: "editor" };
    await onEventDocumentUpdatedViaRouter(h.deps(), C, E, before, edited, NOW);
    const again = await onEventDocumentUpdatedViaRouter(h.deps(), C, E, before, edited, NOW);
    assert.equal(again.appended, false);
    assert.equal(h.sent.length, 1);
    const cancelled = { ...before, status: "cancelled" };
    await onEventDocumentUpdatedViaRouter(h.deps(), C, E, cancelled, { ...cancelled, title: "Z", revision: 6, updatedBy: "e" }, NOW);
    await onEventDocumentUpdatedViaRouter(h.deps(), C, E, before, { ...before, title: "Y", revision: 7, endTime: new Date(NOW.getTime() - 1), updatedBy: "e" }, NOW);
    assert.equal(h.sent.length, 1);
    assert.equal(h.inbox.length, 1);
  });
});

describe("reminders via router", () => {
  test("id carries window and start; in-app reminder written; receipt makes reruns no-ops; moved start re-reminds", async () => {
    const h = harness();
    h.join("a", "reminders"); h.join("b", "all"); h.join("c", "none");
    const start = h.events.get(`${C}/${E}`)!.startTime;
    const first = await sendDueRemindersViaRouter(h.deps());
    assert.deepEqual(first, { events: 1, sent: 2, skipped: 0 });
    assert.ok(h.receipts.has(`${C}/reminder_${E}_1h_${start.getTime()}`));
    assert.deepEqual(h.inbox.map((i) => [i.uid, i.id, i.type, i.body]), [
      ["a", `reminder_${E}_1h_${start.getTime()}`, "reminder", "Starts in 30 minutes."],
      ["b", `reminder_${E}_1h_${start.getTime()}`, "reminder", "Starts in 30 minutes."],
    ].map(([u, id, t, b]) => [u, id, t, b]));
    assert.equal(h.sent[0]!.message.expiresAt?.getTime(), start.getTime());
    const rerun = await sendDueRemindersViaRouter(h.deps());
    assert.deepEqual(rerun, { events: 1, sent: 0, skipped: 1 });
    assert.equal(h.sent.length, 1);
    h.events.get(`${C}/${E}`)!.startTime = new Date(start.getTime() + 60_000);
    assert.equal((await sendDueRemindersViaRouter(h.deps())).sent, 2);
  });

  test("reminders switched off blocks the push only; cancelled events are not selected", async () => {
    const h = harness();
    h.join("a", "reminders");
    h.prefs.set("a", resolvePreferences({ push: { reminders: false } }));
    await sendDueRemindersViaRouter(h.deps());
    assert.equal(h.sent.length, 0);
    assert.equal(h.inbox.length, 1);
    const cancelled = harness();
    cancelled.join("a", "all");
    cancelled.events.get(`${C}/${E}`)!.status = "cancelled";
    assert.deepEqual(await sendDueRemindersViaRouter(cancelled.deps()), { events: 1, sent: 0, skipped: 1 });
  });
});

describe("delivery mode selection", () => {
  const original = process.env.PUSH_ROUTER_ENABLED;
  afterEach(() => { if (original === undefined) delete process.env.PUSH_ROUTER_ENABLED; else process.env.PUSH_ROUTER_ENABLED = original; });

  test("router by default; PUSH_ROUTER_ENABLED=false falls back to legacy", () => {
    delete process.env.PUSH_ROUTER_ENABLED;
    assert.equal(deliveryMode(), "router");
    process.env.PUSH_ROUTER_ENABLED = "false";
    assert.equal(deliveryMode(), "legacy");
    process.env.PUSH_ROUTER_ENABLED = "true";
    assert.equal(deliveryMode(), "router");
  });
});
