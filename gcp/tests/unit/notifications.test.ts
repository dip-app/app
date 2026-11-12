import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { registerDevice, unregisterDevice } from "../../functions/src/modules/notifications/application/devices";
import { onChatMessageCreated, onEventDocumentUpdated, onRsvpWritten, sendDueReminders } from "../../functions/src/modules/notifications/application/handlers";
import type {
  Caller, ChangeLogStore, ClaimStore, DeviceDirectory, DeviceRegistry, DeviceRegistryTransaction, DeviceToken, EventReader,
  EventSummary, MessagingPort, RecipientDirectory, SendResult, SubscriptionStore, UpcomingEvents,
} from "../../functions/src/modules/notifications/application/ports";
import { MULTICAST_LIMIT, sendPush } from "../../functions/src/modules/notifications/application/sendPush";
import { buildEntry, CHANGE_LOG_LIMIT, diffEvent, mergeChangeLog, summarizeChanges, type ChangeLogEntry } from "../../functions/src/modules/notifications/domain/changeLog";
import { MAX_DEVICES_PER_USER, parseRegisterDevice, tokenHash } from "../../functions/src/modules/notifications/domain/device";
import { NotificationsError } from "../../functions/src/modules/notifications/domain/errors";
import { chatPush, CHAT_PREVIEW_MAX, type PushMessage } from "../../functions/src/modules/notifications/domain/push";
import { dueWindow, reminderKey } from "../../functions/src/modules/notifications/domain/reminders";
import type { SubscriptionLevel } from "../../functions/src/modules/notifications/domain/subscription";
import { handleRegisterDevice } from "../../functions/src/modules/notifications/transport/notificationFunctions";
import { toMulticast } from "../../functions/src/modules/notifications/infrastructure/messaging";

const HOUR = 3_600_000;
const NOW = new Date("2030-01-01T12:00:00Z");
const clock = { now: () => NOW };
const token = (name: string) => `token-${name}-${"x".repeat(24)}`;

/** Fake FCM: records every multicast; tokens listed in `invalid` fail as unregistered. */
class FakeMessaging implements MessagingPort {
  calls: { tokens: string[]; message: PushMessage }[] = [];
  invalid = new Set<string>();
  throwOnce = false;
  async sendMulticast(tokens: readonly string[], message: PushMessage): Promise<SendResult[]> {
    if (this.throwOnce) { this.throwOnce = false; throw new Error("FCM unavailable"); }
    assert.ok(tokens.length <= MULTICAST_LIMIT);
    this.calls.push({ tokens: [...tokens], message });
    return tokens.map((t) => (this.invalid.has(t) ? { success: false, errorCode: "messaging/registration-token-not-registered" } : { success: true }));
  }
  recipients() { return this.calls.flatMap((call) => call.tokens).sort(); }
}

/** In-memory world: subscriptions, RSVPs, devices, claims, change logs. */
class World implements DeviceDirectory, RecipientDirectory, ClaimStore, EventReader, UpcomingEvents, ChangeLogStore, SubscriptionStore {
  subscriptions = new Map<string, { level: SubscriptionLevel; updatedAt: Date }>(); // `${c}/${e}/${uid}`
  rsvps = new Map<string, string>(); // `${c}/${e}/${uid}` -> status
  devices = new Map<string, DeviceToken[]>();
  claims = new Set<string>();
  events = new Map<string, EventSummary>();
  changeLogs = new Map<string, unknown[]>();
  removed: DeviceToken[] = [];
  addDevice(uid: string, ...names: string[]) {
    this.devices.set(uid, names.map((name) => ({ uid, token: token(name), tokenHash: tokenHash(token(name)) })));
  }
  async tokensFor(uids: readonly string[]) { return uids.flatMap((uid) => this.devices.get(uid) ?? []); }
  async remove(devices: readonly DeviceToken[]) {
    this.removed.push(...devices);
    for (const device of devices) this.devices.set(device.uid, (this.devices.get(device.uid) ?? []).filter((d) => d.tokenHash !== device.tokenHash));
  }
  async subscribers(c: string, e: string, levels: readonly SubscriptionLevel[]) {
    return [...this.subscriptions].filter(([key, sub]) => key.startsWith(`${c}/${e}/`) && levels.includes(sub.level)).map(([key]) => key.split("/")[2]!);
  }
  async going(c: string, e: string, uids: readonly string[]) { return new Set(uids.filter((uid) => this.rsvps.get(`${c}/${e}/${uid}`) === "going")); }
  async claim(c: string, e: string, key: string) {
    const full = `${c}/${e}/${key}`;
    if (this.claims.has(full)) return false;
    this.claims.add(full);
    return true;
  }
  async get(c: string, e: string) { return this.events.get(`${c}/${e}`) ?? null; }
  async scheduledStartingIn(from: Date, to: Date) {
    return [...this.events.values()].filter((event) => event.status === "scheduled" && event.startTime > from && event.startTime <= to);
  }
  async append(c: string, e: string, entry: ChangeLogEntry) {
    const { log, appended } = mergeChangeLog(this.changeLogs.get(`${c}/${e}`), entry);
    this.changeLogs.set(`${c}/${e}`, log);
    return appended;
  }
  async reconcile(c: string, e: string, uid: string, decide: Parameters<SubscriptionStore["reconcile"]>[3]) {
    const key = `${c}/${e}/${uid}`;
    const sub = this.subscriptions.get(key);
    const decision = decide({ rsvpStatus: this.rsvps.get(key) ?? null, subscriptionLevel: sub?.level ?? null, subscriptionUpdatedAt: sub?.updatedAt ?? null });
    if (decision === "create-default") {
      assert.equal(sub, undefined);
      this.subscriptions.set(key, { level: "changes", updatedAt: NOW });
    }
    if (decision === "delete") this.subscriptions.delete(key);
    return decision;
  }
  subscribe(uid: string, level: SubscriptionLevel, rsvp: string | null = "going", c = "alpha", e = "event") {
    this.subscriptions.set(`${c}/${e}/${uid}`, { level, updatedAt: NOW });
    if (rsvp) this.rsvps.set(`${c}/${e}/${uid}`, rsvp);
  }
}

function setup() {
  const world = new World();
  const messaging = new FakeMessaging();
  world.events.set("alpha/event", {
    companyId: "alpha", eventId: "event", title: "Sunset run", status: "scheduled",
    startTime: new Date(NOW.getTime() + 30 * 60_000), endTime: new Date(NOW.getTime() + 2 * HOUR),
  });
  const deps = { messaging, devices: world, recipients: world, events: world, claims: world, changeLog: world, upcoming: world, clock };
  return { world, messaging, deps };
}

describe("sendPush", () => {
  test("batches by 500, skips users without tokens and removes only invalid tokens", async () => {
    const { world, messaging } = setup();
    const uids = Array.from({ length: 1201 }, (_, i) => `u${i}`);
    for (const uid of uids.slice(0, 1200)) world.addDevice(uid, uid);
    messaging.invalid.add(token("u7"));
    const stats = await sendPush({ messaging, devices: world }, [...uids, "u1"], chatPush("alpha", "event", "Run", "m", "A", "hi"));
    assert.deepEqual(messaging.calls.map((call) => call.tokens.length), [500, 500, 200]);
    assert.deepEqual(stats, { recipients: 1201, tokens: 1200, sent: 1199, failed: 1, removed: 1 });
    assert.deepEqual(world.removed.map((d) => d.uid), ["u7"]);
  });

  test("a failed batch is counted, not retried, and does not remove tokens", async () => {
    const { world, messaging } = setup();
    world.addDevice("a", "a1", "a2");
    messaging.throwOnce = true;
    const stats = await sendPush({ messaging, devices: world }, ["a"], chatPush("alpha", "event", "Run", "m", "A", "hi"));
    assert.deepEqual(stats, { recipients: 1, tokens: 2, sent: 0, failed: 2, removed: 0 });
    assert.equal(world.removed.length, 0);
  });

  test("no recipients means no FCM call", async () => {
    const { world, messaging } = setup();
    assert.equal((await sendPush({ messaging, devices: world }, [], chatPush("a", "e", "t", "m", "x", "y"))).tokens, 0);
    assert.equal(messaging.calls.length, 0);
  });
});

describe("push payloads", () => {
  test("chat carries a short preview and a deep link; no other user text", () => {
    const message = chatPush("alpha", "event", "Run", "m1", "Avery", `${"word ".repeat(100)}`);
    assert.ok(message.body.startsWith("Avery: "));
    assert.ok(message.body.length <= "Avery: ".length + CHAT_PREVIEW_MAX);
    assert.deepEqual(message.data, { type: "chat", companyId: "alpha", eventId: "event", deepLink: "dip://events/event/chat", messageId: "m1" });
    const fcm = toMulticast(["t"], message);
    assert.equal(fcm.apns?.payload?.aps.threadId, "event-event");
    assert.deepEqual(fcm.data, message.data);
  });
});

describe("chat trigger", () => {
  test("pushes to `all` subscribers who are going, except the author; none/changes/left users are skipped", async () => {
    const { world, messaging, deps } = setup();
    world.subscribe("author", "all"); world.addDevice("author", "author");
    world.subscribe("fan", "all"); world.addDevice("fan", "fan-phone", "fan-ipad");
    world.subscribe("quiet", "none"); world.addDevice("quiet", "quiet");
    world.subscribe("default", "changes"); world.addDevice("default", "default");
    world.subscribe("formerly", "all", "cancelled"); world.addDevice("formerly", "formerly");
    world.subscribe("tokenless", "all");
    const stats = await onChatMessageCreated(deps, "alpha", "event", "m1", { authorId: "author", authorName: "Author", text: "Running late" });
    assert.deepEqual(messaging.recipients(), [token("fan-ipad"), token("fan-phone")].sort());
    assert.equal(stats.recipients, 2);
    assert.equal(messaging.calls[0]!.message.body, "Author: Running late");
  });

  test("a duplicate trigger delivery does not push twice", async () => {
    const { world, messaging, deps } = setup();
    world.subscribe("fan", "all"); world.addDevice("fan", "fan");
    const message = { authorId: "author", authorName: "Author", text: "Hi" };
    await onChatMessageCreated(deps, "alpha", "event", "m1", message);
    await onChatMessageCreated(deps, "alpha", "event", "m1", message);
    assert.equal(messaging.calls.length, 1);
  });

  test("cancelled or missing events and malformed messages push nothing", async () => {
    const { world, messaging, deps } = setup();
    world.subscribe("fan", "all"); world.addDevice("fan", "fan");
    await onChatMessageCreated(deps, "alpha", "missing", "m", { authorId: "a", text: "x" });
    await onChatMessageCreated(deps, "alpha", "event", "m", { authorId: 1, text: "x" });
    world.events.get("alpha/event")!.status = "cancelled";
    await onChatMessageCreated(deps, "alpha", "event", "m2", { authorId: "a", text: "x" });
    assert.equal(messaging.calls.length, 0);
  });
});

const baseEvent = {
  title: "Sunset run", description: "Easy pace", tagIds: ["b", "a"], coverImageURL: "catalog://default/outdoors",
  startTime: new Date("2030-01-02T18:00:00Z"), endTime: new Date("2030-01-02T19:00:00Z"),
  venue: { name: "Park", address: "1 Main", locality: "PGH", latitude: 1, longitude: 1 },
  costCents: 0, costNote: "", capacity: 10, isOutdoor: true, status: "scheduled", attendeeCount: 3, revision: 4, createdBy: "org",
};

describe("change log domain", () => {
  test("diffs user-visible fields only, with normalized display values", () => {
    const after = { ...baseEvent, title: "Sunrise run", tagIds: ["a", "c"], venue: { ...baseEvent.venue, name: "Lake", latitude: 2 },
      startTime: new Date("2030-01-02T17:00:00Z"), capacity: 12, isOutdoor: false, revision: 5, updatedBy: "org-2" };
    assert.deepEqual(diffEvent(baseEvent, after), [
      { field: "title", from: "Sunset run", to: "Sunrise run" },
      { field: "tagIds", from: "a, b", to: "a, c" },
      { field: "startTime", from: "2030-01-02T18:00:00.000Z", to: "2030-01-02T17:00:00.000Z" },
      { field: "venue.name", from: "Park", to: "Lake" },
      { field: "capacity", from: "10", to: "12" },
      { field: "isOutdoor", from: "true", to: "false" },
    ]);
  });

  test("bookkeeping-only writes (changeLog, attendeeCount, revision, updatedBy, tag order) produce no entry", () => {
    const after = { ...baseEvent, tagIds: ["a", "b"], attendeeCount: 4, revision: 5, updatedBy: "x", changeLog: [{}], rsvpCount: 9 };
    assert.equal(buildEntry(baseEvent, after, NOW), null);
  });

  test("editor comes from updatedBy only when the revision advanced; otherwise 'organizer'", () => {
    assert.equal(buildEntry(baseEvent, { ...baseEvent, title: "X", revision: 5, updatedBy: "org-2" }, NOW)!.by, "org-2");
    assert.equal(buildEntry(baseEvent, { ...baseEvent, title: "X", updatedBy: "org-2" }, NOW)!.by, "organizer");
    assert.equal(buildEntry(baseEvent, { ...baseEvent, title: "X", revision: 5 }, NOW)!.by, "organizer");
  });

  test("long text is truncated to 200 characters but long edits are still detected", () => {
    const long = "y".repeat(5000);
    const change = diffEvent({ ...baseEvent, description: long }, { ...baseEvent, description: `${long}z` })[0]!;
    assert.equal(change.from!.length, 200);
    assert.equal(change.from, change.to);
  });

  test("merge is idempotent by revision + changes, ordered by revision and capped at 50", () => {
    const entry = (revision: number) => ({ at: NOW, by: "o", revision, changes: [{ field: "title" as const, from: "a", to: `t${revision}` }] });
    let log: unknown[] = [];
    for (let revision = 60; revision >= 2; revision--) log = mergeChangeLog(log, entry(revision)).log;
    assert.equal(log.length, CHANGE_LOG_LIMIT);
    assert.deepEqual((log as ChangeLogEntry[]).map((e) => e.revision).slice(0, 2), [11, 12]);
    assert.equal((log as ChangeLogEntry[]).at(-1)!.revision, 60);
    const again = mergeChangeLog(log, entry(60));
    assert.equal(again.appended, false);
    assert.equal(again.log.length, CHANGE_LOG_LIMIT);
  });

  test("summaries: cancel, restore and field labels", () => {
    assert.equal(summarizeChanges([{ field: "status", from: "scheduled", to: "cancelled" }]), "This activity was cancelled.");
    assert.equal(summarizeChanges([{ field: "status", from: "cancelled", to: "scheduled" }, { field: "title", from: "a", to: "b" }]), "This activity is back on.");
    assert.equal(summarizeChanges([{ field: "startTime", from: "a", to: "b" }, { field: "endTime", from: "a", to: "b" }, { field: "venue.name", from: "a", to: "b" }]), "Updated: time, location.");
  });
});

describe("event change trigger", () => {
  test("appends once and pushes to all/changes subscribers except the editor", async () => {
    const { world, messaging, deps } = setup();
    for (const [uid, level] of [["editor", "all"], ["fan", "all"], ["default", "changes"], ["reminders", "reminders"], ["quiet", "none"]] as const) {
      world.subscribe(uid, level); world.addDevice(uid, uid);
    }
    const after = { ...baseEvent, venue: { ...baseEvent.venue, address: "2 Main" }, revision: 5, updatedBy: "editor" };
    const first = await onEventDocumentUpdated(deps, "alpha", "event", baseEvent, after, NOW);
    assert.equal(first.appended, true);
    assert.deepEqual(messaging.recipients(), [token("default"), token("fan")].sort());
    assert.equal(messaging.calls[0]!.message.body, "Updated: location.");
    assert.deepEqual(messaging.calls[0]!.message.data, { type: "event_changed", companyId: "alpha", eventId: "event", deepLink: "dip://events/event", revision: "5" });
    // Retry / duplicate delivery of the same update: no second entry, no second push.
    const retry = await onEventDocumentUpdated(deps, "alpha", "event", baseEvent, after, NOW);
    assert.equal(retry.appended, false);
    assert.equal(messaging.calls.length, 1);
    assert.equal(world.changeLogs.get("alpha/event")!.length, 1);
  });

  test("the trigger's own changeLog write and counter updates are ignored (no loop)", async () => {
    const { world, messaging, deps } = setup();
    world.subscribe("fan", "all"); world.addDevice("fan", "fan");
    const result = await onEventDocumentUpdated(deps, "alpha", "event", baseEvent, { ...baseEvent, changeLog: [{ revision: 4 }], attendeeCount: 9 }, NOW);
    assert.equal(result.appended, false);
    assert.equal(messaging.calls.length, 0);
    assert.equal(world.changeLogs.size, 0);
  });

  test("the in-app center mirrors the push: one create-only item per recipient with a deterministic id, cancellation typed separately", async () => {
    const { world, deps } = setup();
    const created = new Map<string, Record<string, unknown>>();
    const inbox = { createMany: async (items: readonly { uid: string; id: string }[]) => {
      let count = 0;
      for (const item of items) { const key = `${item.uid}/${item.id}`; if (!created.has(key)) { created.set(key, item as unknown as Record<string, unknown>); count++; } }
      return count;
    } };
    world.subscribe("fan", "changes"); world.subscribe("quiet", "none"); world.subscribe("editor", "all");
    const edited = { ...baseEvent, venue: { ...baseEvent.venue, address: "2 Main" }, revision: 5, updatedBy: "editor" };
    await onEventDocumentUpdated({ ...deps, inbox }, "alpha", "event", baseEvent, edited, NOW);
    assert.deepEqual([...created.keys()], ["fan/event_event_5"]);
    assert.equal(created.get("fan/event_event_5")!.type, "event_updated");
    assert.equal(created.get("fan/event_event_5")!.body, "Updated: location.");
    // A redelivered trigger changes nothing; a cancellation is its own type and id.
    await onEventDocumentUpdated({ ...deps, inbox }, "alpha", "event", baseEvent, edited, NOW);
    await onEventDocumentUpdated({ ...deps, inbox }, "alpha", "event", edited, { ...edited, status: "cancelled", revision: 6, updatedBy: "editor" }, NOW);
    assert.deepEqual([...created.keys()].sort(), ["fan/event_event_5", "fan/event_event_6"]);
    assert.equal(created.get("fan/event_event_6")!.type, "event_cancelled");
  });

  test("a failing in-app write never fails the trigger", async () => {
    const { world, deps } = setup();
    world.subscribe("fan", "changes");
    const result = await onEventDocumentUpdated({ ...deps, inbox: { createMany: async () => { throw new Error("down"); } } },
      "alpha", "event", baseEvent, { ...baseEvent, costNote: "Free", revision: 5 }, NOW);
    assert.equal(result.appended, true);
  });

  test("cancellation is pushed; edits to cancelled or finished events are logged silently", async () => {
    const { world, messaging, deps } = setup();
    world.subscribe("fan", "changes"); world.addDevice("fan", "fan");
    const cancelled = { ...baseEvent, status: "cancelled", revision: 5 };
    await onEventDocumentUpdated(deps, "alpha", "event", baseEvent, cancelled, NOW);
    assert.equal(messaging.calls.at(-1)!.message.body, "This activity was cancelled.");
    await onEventDocumentUpdated(deps, "alpha", "event", cancelled, { ...cancelled, title: "Renamed", revision: 6 }, NOW);
    const past = { ...baseEvent, endTime: new Date(NOW.getTime() - HOUR) };
    await onEventDocumentUpdated(deps, "alpha", "event", past, { ...past, costNote: "Bring water", revision: 5 }, NOW);
    assert.equal(messaging.calls.length, 1);
    assert.equal(world.changeLogs.get("alpha/event")!.length, 3);
  });
});

describe("reminders", () => {
  test("window selection with a fake clock", () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    assert.equal(dueWindow(at(24 * HOUR), NOW), "24h");
    assert.equal(dueWindow(at(24 * HOUR + 1), NOW), null);
    assert.equal(dueWindow(at(20 * HOUR + 1), NOW), "24h");
    assert.equal(dueWindow(at(20 * HOUR), NOW), null);
    assert.equal(dueWindow(at(5 * HOUR), NOW), null);
    assert.equal(dueWindow(at(HOUR), NOW), "1h");
    assert.equal(dueWindow(at(1), NOW), "1h");
    assert.equal(dueWindow(at(0), NOW), null);
    assert.equal(dueWindow(at(-HOUR), NOW), null);
    assert.equal(reminderKey("1h", at(HOUR)), `reminder_1h_${NOW.getTime() + HOUR}`);
  });

  test("sends exactly once per event and window across overlapping runs and retries", async () => {
    const { world, messaging, deps } = setup();
    world.events.clear();
    const add = (eventId: string, startOffset: number, status = "scheduled") => world.events.set(`alpha/${eventId}`, {
      companyId: "alpha", eventId, title: eventId, status, startTime: new Date(NOW.getTime() + startOffset), endTime: new Date(NOW.getTime() + startOffset + HOUR),
    });
    add("soon", 50 * 60_000); add("tomorrow", 23.9 * HOUR); add("later", 10 * HOUR); add("cancelled", 50 * 60_000, "cancelled"); add("started", -60_000);
    for (const eventId of ["soon", "tomorrow", "later", "cancelled", "started"]) {
      world.subscribe("all", "all", "going", "alpha", eventId);
      world.subscribe("rem", "reminders", "going", "alpha", eventId);
      world.subscribe("quiet", "none", "going", "alpha", eventId);
    }
    world.addDevice("all", "all"); world.addDevice("rem", "rem"); world.addDevice("quiet", "quiet");
    await Promise.all([sendDueReminders(deps), sendDueReminders(deps)]);
    await sendDueReminders(deps);
    const byEvent = messaging.calls.map((call) => `${call.message.data.eventId}:${call.message.data.window}:${call.tokens.length}`).sort();
    assert.deepEqual(byEvent, ["soon:1h:2", "tomorrow:24h:2"]);
    assert.equal(messaging.calls.find((c) => c.message.data.eventId === "tomorrow")!.message.body, "Starts tomorrow.");
    assert.equal(messaging.calls.find((c) => c.message.data.eventId === "soon")!.message.body, "Starts in 50 minutes.");
    // Fifteen minutes later the 1 h window still matches "soon" but its receipt prevents a resend.
    const later = { ...deps, clock: { now: () => new Date(NOW.getTime() + 15 * 60_000) } };
    await sendDueReminders(later);
    assert.equal(messaging.calls.length, 2);
  });
});

describe("default subscription on RSVP", () => {
  test("join creates `changes` once; an existing choice is kept; leave deletes it", async () => {
    const { world } = setup();
    const key = "alpha/event/u";
    world.rsvps.set(key, "going");
    assert.equal(await onRsvpWritten(world, "alpha", "event", "u", NOW), "create-default");
    assert.equal(world.subscriptions.get(key)!.level, "changes");
    assert.equal(await onRsvpWritten(world, "alpha", "event", "u", NOW), "keep");
    world.subscriptions.set(key, { level: "all", updatedAt: NOW });
    assert.equal(await onRsvpWritten(world, "alpha", "event", "u", NOW), "keep");
    world.rsvps.set(key, "cancelled");
    assert.equal(await onRsvpWritten(world, "alpha", "event", "u", NOW), "delete");
    assert.equal(world.subscriptions.has(key), false);
    assert.equal(await onRsvpWritten(world, "alpha", "event", "u", NOW), "keep");
  });

  test("a late duplicate leave delivery keeps a preference the member set afterwards; out-of-order join converges", async () => {
    const { world } = setup();
    const key = "alpha/event/u";
    world.rsvps.set(key, "cancelled");
    world.subscriptions.set(key, { level: "reminders", updatedAt: new Date(NOW.getTime() + 1000) });
    assert.equal(await onRsvpWritten(world, "alpha", "event", "u", NOW), "keep");
    // A stale "going" delivery processed after the leave reads the current (cancelled) state: no default created.
    world.subscriptions.delete(key);
    assert.equal(await onRsvpWritten(world, "alpha", "event", "u", NOW), "keep");
    assert.equal(world.subscriptions.has(key), false);
  });
});

/** Optimistic fake of the device registry transaction (serialized commit). */
class Registry implements DeviceRegistry {
  members = new Map<string, { companyId: string; role: string }>();
  devices = new Map<string, { uid: string; tokenHash: string; token: string; updatedAt: Date }>(); // `${uid}/${hash}`
  tick = 0;
  async runTransaction<T>(work: (tx: DeviceRegistryTransaction) => Promise<T>): Promise<T> {
    const writes: (() => void)[] = [];
    const tx: DeviceRegistryTransaction = {
      getMember: async (uid) => this.members.get(uid) ?? null,
      listDevices: async (uid) => [...this.devices.values()].filter((d) => d.uid === uid).map((d) => ({ tokenHash: d.tokenHash, updatedAt: d.updatedAt })),
      ownersOf: async (hash) => [...this.devices.values()].filter((d) => d.tokenHash === hash).map((d) => d.uid),
      exists: async (uid, hash) => this.devices.has(`${uid}/${hash}`),
      upsert: (uid, hash, device) => writes.push(() => this.devices.set(`${uid}/${hash}`, { uid, tokenHash: hash, token: device.token, updatedAt: new Date(++this.tick) })),
      remove: (uid, hash) => writes.push(() => this.devices.delete(`${uid}/${hash}`)),
    };
    const result = await work(tx);
    for (const write of writes) write();
    return result;
  }
}

describe("device registry callables", () => {
  const caller = (uid: string, overrides: Partial<Caller> = {}): Caller => ({ uid, emailVerified: true, signInProvider: "google.com", ...overrides });
  const request = (name: string) => ({ contractVersion: 1, token: token(name), platform: "ios", appVersion: "1.2 (34)" });
  const fixture = () => {
    const registry = new Registry();
    registry.members.set("a", { companyId: "alpha", role: "member" });
    registry.members.set("b", { companyId: "alpha", role: "admin" });
    return registry;
  };
  const rejects = (promise: Promise<unknown>, reason: string) =>
    assert.rejects(promise, (error: unknown) => error instanceof NotificationsError && error.reason === reason);

  test("auth, provider, verification and membership are required", async () => {
    const registry = fixture();
    await rejects(registerDevice(registry, null, request("p")), "UNAUTHENTICATED");
    await rejects(registerDevice(registry, caller("a", { emailVerified: false }), request("p")), "EMAIL_NOT_VERIFIED");
    await rejects(registerDevice(registry, caller("a", { signInProvider: "password" }), request("p")), "PROVIDER_NOT_ALLOWED");
    await rejects(registerDevice(registry, caller("stranger"), request("p")), "MEMBERSHIP_REQUIRED");
    await rejects(unregisterDevice(registry, null, { contractVersion: 1, token: token("p") }), "UNAUTHENTICATED");
    assert.equal(registry.devices.size, 0);
  });

  test("validation rejects unknown fields (including a forged userId), bad platform, version and token", async () => {
    for (const patch of [{ userId: "b" }, { platform: "android" }, { contractVersion: 2 }, { token: "short" }, { token: `${token("p")}/../x` }, { appVersion: "" }]) {
      assert.throws(() => parseRegisterDevice({ ...request("p"), ...patch }), NotificationsError);
    }
    assert.deepEqual(parseRegisterDevice(request("p")), { token: token("p"), platform: "ios", appVersion: "1.2 (34)" });
  });

  test("register is idempotent, keyed by token hash, and moves a token between accounts", async () => {
    const registry = fixture();
    const first = await registerDevice(registry, caller("a"), request("phone"));
    assert.deepEqual(first, { contractVersion: 1, deviceId: tokenHash(token("phone")) });
    assert.deepEqual(await registerDevice(registry, caller("a"), request("phone")), first);
    assert.equal(registry.devices.size, 1);
    await registerDevice(registry, caller("b"), request("phone"));
    assert.deepEqual([...registry.devices.keys()], [`b/${first.deviceId}`]);
  });

  test("the registry is bounded per user, evicting the least recently refreshed device", async () => {
    const registry = fixture();
    for (let i = 0; i < MAX_DEVICES_PER_USER + 3; i++) await registerDevice(registry, caller("a"), request(`d${i}`));
    const mine = [...registry.devices.values()].filter((d) => d.uid === "a");
    assert.equal(mine.length, MAX_DEVICES_PER_USER);
    assert.equal(mine.some((d) => d.token === token("d0")), false);
    assert.equal(mine.some((d) => d.token === token(`d${MAX_DEVICES_PER_USER + 2}`)), true);
  });

  test("unregister removes only the caller's own registration and is idempotent", async () => {
    const registry = fixture();
    await registerDevice(registry, caller("a"), request("phone"));
    assert.deepEqual(await unregisterDevice(registry, caller("b"), { contractVersion: 1, token: token("phone") }), { contractVersion: 1, removed: false });
    assert.equal(registry.devices.size, 1);
    assert.deepEqual(await unregisterDevice(registry, caller("a"), { contractVersion: 1, token: token("phone") }), { contractVersion: 1, removed: true });
    assert.deepEqual(await unregisterDevice(registry, caller("a"), { contractVersion: 1, token: token("phone") }), { contractVersion: 1, removed: false });
  });

  test("transport maps domain errors to callable errors with reason/fields and hides internals", async () => {
    const registry = fixture();
    await assert.rejects(handleRegisterDevice(registry, { auth: undefined, data: request("p") } as never),
      (error: { code?: string; details?: { reason?: string } }) => error.code === "unauthenticated" && error.details?.reason === "UNAUTHENTICATED");
    const auth = { uid: "a", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } };
    await assert.rejects(handleRegisterDevice(registry, { auth, data: { ...request("p"), platform: "web" } } as never),
      (error: { code?: string; details?: { fields?: string[] } }) => error.code === "invalid-argument" && error.details?.fields?.[0] === "platform");
    const broken: DeviceRegistry = { runTransaction: async () => { throw new Error("secret detail"); } };
    await assert.rejects(handleRegisterDevice(broken, { auth, data: request("p") } as never),
      (error: { code?: string; message?: string }) => error.code === "internal" && !String(error.message).includes("secret"));
    assert.ok((await handleRegisterDevice(registry, { auth, data: request("p") } as never)).deviceId);
  });
});
