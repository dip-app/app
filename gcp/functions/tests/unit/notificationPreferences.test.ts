import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { PreferencesReader } from "../../src/modules/notifications/application/ports";
import { cachedPreferences } from "../../src/modules/notifications/application/preferenceCache";
import {
  CHANNEL_CATEGORIES, DEFAULT_PREFERENCES, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, NOTIFICATION_KINDS,
  channelOffers, eventLevelsFor, isNotificationCategory, isNotificationKind,
  type NotificationCategory, type NotificationChannel, type NotificationKind,
} from "../../src/modules/notifications/domain/categories";
import {
  DEFAULT_RESOLVED_PREFERENCES, evaluateDelivery, resolvePreferences, type ResolvedPreferences,
} from "../../src/modules/notifications/domain/preferences";
import { LEVELS_FOR, type SubscriptionLevel } from "../../src/modules/notifications/domain/subscription";
import { FirestorePreferences } from "../../src/modules/notifications/infrastructure/firestorePreferences";

describe("notification registry", () => {
  test("category ids and order are pinned", () => {
    assert.deepEqual([...NOTIFICATION_CATEGORIES], ["invites", "event_updates", "reminders", "chat", "challenges", "social", "discovery", "calendar_invites", "admin_suggestions"]);
    assert.deepEqual([...NOTIFICATION_CHANNELS], ["push", "email"]);
  });

  test("email excludes chat and social; push offers everything except the email-only admin_suggestions", () => {
    assert.deepEqual([...CHANNEL_CATEGORIES.email], ["invites", "event_updates", "reminders", "challenges", "discovery", "calendar_invites", "admin_suggestions"]);
    assert.ok(!CHANNEL_CATEGORIES.email.includes("chat"));
    assert.ok(!CHANNEL_CATEGORIES.email.includes("social"));
    assert.deepEqual([...CHANNEL_CATEGORIES.push], NOTIFICATION_CATEGORIES.filter(c => c !== "admin_suggestions" && c !== "calendar_invites"));
    assert.equal(channelOffers("push", "admin_suggestions"), false);
    assert.equal(channelOffers("push", "calendar_invites"), false);
    assert.equal(channelOffers("email", "calendar_invites"), true);
    assert.equal(channelOffers("email", "admin_suggestions"), true);
    assert.equal(channelOffers("email", "chat"), false);
    assert.equal(channelOffers("email", "social"), false);
    assert.equal(channelOffers("email", "invites"), true);
    assert.equal(channelOffers("push", "social"), true);
  });

  test("every kind has a valid category; type guards work", () => {
    for (const [kind, spec] of Object.entries(NOTIFICATION_KINDS)) {
      assert.ok(isNotificationCategory(spec.category), kind);
      assert.ok(isNotificationKind(kind));
    }
    assert.equal(isNotificationKind("nope"), false);
    assert.equal(isNotificationKind("toString"), false);
    assert.equal(isNotificationKind(3), false);
    assert.equal(isNotificationCategory("nope"), false);
    assert.equal(isNotificationCategory(undefined), false);
  });

  test("kinds with an in-app type match the in-app types in use today", () => {
    const inApp: Record<string, string | null> = Object.fromEntries(Object.entries(NOTIFICATION_KINDS).map(([k, s]) => [k, s.inAppType]));
    assert.deepEqual(inApp, {
      chat: null, event_changed: "event_updated", event_cancelled: "event_cancelled", reminder: "reminder",
      invite: "invite", invite_answered: "invite_answered", attendee_added: "attendee_added",
      challenge_approved: "challenge_approved", challenge_changes_requested: "challenge_changes_requested",
      weekly_theme: null, event_interest: null, calendar_invite: null, admin_suggestions: null,
    });
  });

  test("eventLevelsFor returns LEVELS_FOR for gated kinds and null otherwise", () => {
    assert.deepEqual(eventLevelsFor("chat"), LEVELS_FOR.chat);
    assert.deepEqual(eventLevelsFor("event_changed"), LEVELS_FOR.event_changed);
    assert.deepEqual(eventLevelsFor("event_cancelled"), LEVELS_FOR.event_changed);
    assert.deepEqual(eventLevelsFor("reminder"), LEVELS_FOR.reminder);
    for (const kind of ["invite", "invite_answered", "attendee_added", "challenge_approved", "challenge_changes_requested", "weekly_theme", "event_interest", "calendar_invite", "admin_suggestions"] as const) {
      assert.equal(eventLevelsFor(kind), null, kind);
    }
  });

  test("defaults match the design table", () => {
    assert.deepEqual(DEFAULT_PREFERENCES.push, { invites: true, event_updates: true, reminders: true, chat: true, challenges: true, social: false, discovery: false });
    assert.deepEqual(DEFAULT_PREFERENCES.email, { invites: true, event_updates: true, reminders: false, challenges: true, discovery: false, calendar_invites: true, admin_suggestions: false });
  });
});

describe("resolvePreferences", () => {
  const defaults = {
    push: { invites: true, event_updates: true, reminders: true, chat: true, challenges: true, social: false, discovery: false, calendar_invites: false, admin_suggestions: false },
    email: { invites: true, event_updates: true, reminders: false, chat: false, challenges: true, social: false, discovery: false, calendar_invites: true, admin_suggestions: false },
  };

  test("missing or garbage documents resolve to defaults", () => {
    for (const input of [undefined, null, [], ["push"], "x", 5, true, {}, { push: "x", email: [] }, { push: null, email: 3 }]) {
      assert.deepEqual(resolvePreferences(input), defaults, JSON.stringify(input));
    }
    assert.deepEqual(DEFAULT_RESOLVED_PREFERENCES, defaults);
  });

  test("explicit booleans override, both directions", () => {
    const r = resolvePreferences({ push: { invites: false, social: true }, email: { reminders: true, invites: false } });
    assert.equal(r.push.invites, false);
    assert.equal(r.push.social, true);
    assert.equal(r.email.reminders, true);
    assert.equal(r.email.invites, false);
  });

  test("partial maps merge with defaults", () => {
    const r = resolvePreferences({ push: { chat: false } });
    assert.deepEqual(r.push, { ...defaults.push, chat: false });
    assert.deepEqual(r.email, defaults.email);
  });

  test("non-boolean values and unknown keys are ignored", () => {
    const r = resolvePreferences({
      push: { invites: "false", chat: 0, reminders: null, challenges: undefined, social: 1, bogus: true },
      email: { discovery: "true" }, mystery: { a: 1 },
    });
    assert.deepEqual(r, defaults);
    assert.equal("bogus" in r.push, false);
    assert.equal("mystery" in r, false);
  });

  test("email chat and social are always false even when stored true", () => {
    const r = resolvePreferences({ email: { chat: true, social: true, invites: true } });
    assert.equal(r.email.chat, false);
    assert.equal(r.email.social, false);
    assert.equal(r.email.invites, true);
  });
});

describe("evaluateDelivery precedence matrix", () => {
  // Independent oracle written from the design doc table, not from the implementation.
  const DOC_CATEGORY: Record<NotificationKind, NotificationCategory> = {
    invite: "invites", invite_answered: "invites",
    event_changed: "event_updates", event_cancelled: "event_updates", attendee_added: "event_updates",
    reminder: "reminders", chat: "chat",
    challenge_approved: "challenges", challenge_changes_requested: "challenges", weekly_theme: "challenges",
    event_interest: "discovery", calendar_invite: "calendar_invites", admin_suggestions: "admin_suggestions",
  };
  const DOC_GATE: Partial<Record<NotificationKind, string[]>> = {
    chat: ["all"], event_changed: ["all", "changes"], event_cancelled: ["all", "changes"], reminder: ["all", "changes", "reminders"],
  };
  const DOC_EMAIL_OFFERED = new Set(["invites", "event_updates", "reminders", "challenges", "discovery", "calendar_invites", "admin_suggestions"]);
  const DOC_PUSH_OFFERED = (category: NotificationCategory) => category !== "admin_suggestions" && category !== "calendar_invites";

  function oracle(kind: NotificationKind, channel: NotificationChannel, categoryOn: boolean, level: SubscriptionLevel | null | undefined, hasDestination: boolean) {
    const category = DOC_CATEGORY[kind];
    const on = categoryOn && (channel === "push" ? DOC_PUSH_OFFERED(category) : DOC_EMAIL_OFFERED.has(category));
    if (!on) return { deliver: false, reason: "category_off" };
    const gate = DOC_GATE[kind];
    if (gate && !(level != null && gate.includes(level))) return { deliver: false, reason: "event_level" };
    if (!hasDestination) return { deliver: false, reason: "no_destination" };
    return { deliver: true };
  }

  test("registry categories agree with the doc table", () => {
    for (const kind of Object.keys(DOC_CATEGORY) as NotificationKind[]) assert.equal(NOTIFICATION_KINDS[kind].category, DOC_CATEGORY[kind], kind);
    assert.equal(Object.keys(NOTIFICATION_KINDS).length, Object.keys(DOC_CATEGORY).length);
  });

  test("every kind x channel x category x level x destination", () => {
    const levels: (SubscriptionLevel | null | undefined)[] = ["all", "changes", "reminders", "none", null, undefined];
    let cases = 0;
    for (const kind of Object.keys(DOC_CATEGORY) as NotificationKind[]) {
      for (const channel of NOTIFICATION_CHANNELS) {
        for (const categoryOn of [true, false]) {
          const prefs = resolvePreferences({ [channel]: { [DOC_CATEGORY[kind]]: categoryOn } });
          for (const eventLevel of levels) {
            for (const hasDestination of [true, false]) {
              const actual = evaluateDelivery({ kind, channel, preferences: prefs, eventLevel, hasDestination });
              assert.deepEqual(actual, oracle(kind, channel, categoryOn, eventLevel, hasDestination),
                `${kind}/${channel}/cat=${categoryOn}/level=${String(eventLevel)}/dest=${hasDestination}`);
              cases++;
            }
          }
        }
      }
    }
    assert.equal(cases, 13 * 2 * 2 * 6 * 2);
  });

  test("reason order: category_off before event_level before no_destination", () => {
    const off = resolvePreferences({ push: { chat: false } });
    assert.deepEqual(evaluateDelivery({ kind: "chat", channel: "push", preferences: off, eventLevel: "none", hasDestination: false }), { deliver: false, reason: "category_off" });
    assert.deepEqual(evaluateDelivery({ kind: "chat", channel: "push", preferences: DEFAULT_RESOLVED_PREFERENCES, eventLevel: "none", hasDestination: false }), { deliver: false, reason: "event_level" });
    assert.deepEqual(evaluateDelivery({ kind: "chat", channel: "push", preferences: DEFAULT_RESOLVED_PREFERENCES, eventLevel: "all", hasDestination: false }), { deliver: false, reason: "no_destination" });
  });

  test("spot checks", () => {
    const none = resolvePreferences(undefined);
    assert.deepEqual(evaluateDelivery({ kind: "chat", channel: "push", preferences: none, eventLevel: "all", hasDestination: true }), { deliver: true });
    assert.deepEqual(evaluateDelivery({ kind: "chat", channel: "push", preferences: none, eventLevel: "reminders", hasDestination: true }), { deliver: false, reason: "event_level" });
    assert.deepEqual(evaluateDelivery({ kind: "attendee_added", channel: "push", preferences: none, eventLevel: null, hasDestination: true }), { deliver: true });
    assert.deepEqual(evaluateDelivery({ kind: "chat", channel: "email", preferences: none, eventLevel: "all", hasDestination: true }), { deliver: false, reason: "category_off" });
    // Discovery is off by default for push; reminders email is off by default.
    assert.deepEqual(evaluateDelivery({ kind: "event_interest", channel: "push", preferences: none, hasDestination: true }), { deliver: false, reason: "category_off" });
    assert.deepEqual(evaluateDelivery({ kind: "reminder", channel: "email", preferences: none, eventLevel: "all", hasDestination: true }), { deliver: false, reason: "category_off" });
    assert.deepEqual(evaluateDelivery({ kind: "invite", channel: "email", preferences: none, hasDestination: true }), { deliver: true });
  });
});

describe("cachedPreferences", () => {
  function countingReader() {
    const calls: string[][] = [];
    const reader: PreferencesReader = {
      async preferencesFor(uids) {
        calls.push([...uids]);
        return new Map(uids.map((uid) => [uid, resolvePreferences({ push: { chat: uid === "a" } })] as [string, ResolvedPreferences]));
      },
    };
    return { reader, calls };
  }

  test("second call for the same uids does not hit the reader", async () => {
    const { reader, calls } = countingReader();
    const cache = cachedPreferences(reader);
    const first = await cache.preferencesFor(["a", "b"]);
    const second = await cache.preferencesFor(["b", "a"]);
    assert.equal(calls.length, 1);
    assert.deepEqual([...second.keys()].sort(), ["a", "b"]);
    assert.equal(second.get("a"), first.get("a"));
    assert.equal(second.get("a")?.push.chat, true);
    assert.equal(second.get("b")?.push.chat, false);
  });

  test("mixed cached and uncached only fetches the missing uids", async () => {
    const { reader, calls } = countingReader();
    const cache = cachedPreferences(reader);
    await cache.preferencesFor(["a"]);
    const result = await cache.preferencesFor(["a", "b", "c"]);
    assert.deepEqual(calls, [["a"], ["b", "c"]]);
    assert.deepEqual([...result.keys()].sort(), ["a", "b", "c"]);
  });

  test("duplicates are deduped and empty input makes no call", async () => {
    const { reader, calls } = countingReader();
    const cache = cachedPreferences(reader);
    const result = await cache.preferencesFor(["a", "a", "b", "a"]);
    assert.deepEqual(calls, [["a", "b"]]);
    assert.equal(result.size, 2);
    const empty = await cache.preferencesFor([]);
    assert.equal(empty.size, 0);
    assert.equal(calls.length, 1);
  });

  test("separate caches do not share state", async () => {
    const { reader, calls } = countingReader();
    await cachedPreferences(reader).preferencesFor(["a"]);
    await cachedPreferences(reader).preferencesFor(["a"]);
    assert.equal(calls.length, 2);
  });
});

describe("FirestorePreferences", () => {
  interface FakeRef { path: string; set(data: unknown, options?: unknown): Promise<void> }
  function fakeDb(docs: Record<string, unknown> = {}) {
    const getAllSizes: number[] = [];
    const sets: { path: string; data: Record<string, unknown>; options: unknown }[] = [];
    const makeRef = (segments: string[]): FakeRef & { collection(name: string): unknown; doc(id: string): unknown } => ({
      path: segments.join("/"),
      async set(data, options) { sets.push({ path: segments.join("/"), data: data as Record<string, unknown>, options }); },
      collection: (name: string) => ({ doc: (id: string) => makeRef([...segments, name, id]) }),
      doc: (id: string) => makeRef([...segments, id]),
    });
    const db = {
      collection: (name: string) => ({ doc: (id: string) => makeRef([name, id]) }),
      async getAll(...refs: FakeRef[]) {
        getAllSizes.push(refs.length);
        return refs.map((ref) => ({ exists: ref.path in docs, data: () => docs[ref.path] }));
      },
    };
    return { db: db as unknown as Firestore, getAllSizes, sets };
  }

  test("reads 250 uids in 3 getAll chunks (100/100/50)", async () => {
    const { db, getAllSizes } = fakeDb();
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const result = await new FirestorePreferences(db).preferencesFor([...uids, "u0", "u1"]);
    assert.deepEqual(getAllSizes, [100, 100, 50]);
    assert.equal(result.size, 250);
    for (const uid of uids) assert.ok(result.has(uid));
  });

  test("missing snapshot resolves to defaults; existing doc is resolved", async () => {
    const { db } = fakeDb({ "users/b/settings/notifications": { push: { chat: false }, email: { reminders: true } } });
    const result = await new FirestorePreferences(db).preferencesFor(["a", "b"]);
    assert.deepEqual(result.get("a"), DEFAULT_RESOLVED_PREFERENCES);
    assert.equal(result.get("b")?.push.chat, false);
    assert.equal(result.get("b")?.email.reminders, true);
    assert.equal(result.get("b")?.push.invites, true);
  });

  test("empty input makes no getAll call", async () => {
    const { db, getAllSizes } = fakeDb();
    const result = await new FirestorePreferences(db).preferencesFor([]);
    assert.equal(result.size, 0);
    assert.equal(getAllSizes.length, 0);
  });

  test("setCategory writes the client-shaped doc with merge", async () => {
    const { db, sets } = fakeDb();
    await new FirestorePreferences(db).setCategory("u1", "email", "reminders", true);
    await new FirestorePreferences(db).setCategory("u1", "push", "chat", false);
    assert.equal(sets.length, 2);
    assert.equal(sets[0]?.path, "users/u1/settings/notifications");
    assert.deepEqual(sets[0]?.options, { merge: true });
    assert.equal(sets[0]?.data.contractVersion, 1);
    assert.deepEqual(sets[0]?.data.email, { reminders: true });
    assert.deepEqual(sets[1]?.data.push, { chat: false });
    assert.deepEqual(Object.keys(sets[0]?.data ?? {}).sort(), ["contractVersion", "email", "updatedAt"]);
    assert.ok((sets[0]?.data.updatedAt as { isEqual(o: unknown): boolean }).isEqual(FieldValue.serverTimestamp()));
  });

  test("setCategory rejects categories the channel does not offer and writes nothing", async () => {
    const { db, sets } = fakeDb();
    const store = new FirestorePreferences(db);
    await assert.rejects(store.setCategory("u1", "email", "chat", true), /CATEGORY_NOT_OFFERED/);
    await assert.rejects(store.setCategory("u1", "email", "social", false), /CATEGORY_NOT_OFFERED/);
    assert.equal(sets.length, 0);
  });
});
