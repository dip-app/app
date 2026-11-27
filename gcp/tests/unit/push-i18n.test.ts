import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { checkCatalogs } from "../../functions/src/modules/i18n";
import type { DeviceToken, MessagingPort, SendResult } from "../../functions/src/modules/notifications/application/ports";
import { deliverNotification, type NotificationRequest, type RouterDependencies } from "../../functions/src/modules/notifications/application/router";
import { attendeeAddedRequest, challengeReviewedRequest, inviteAnsweredRequest, weeklyThemeRequest } from "../../functions/src/modules/notifications/application/newTriggers";
import type { LocaleReader } from "../../functions/src/modules/notifications/application/routerPorts";
import { summarizeChanges, type FieldChange } from "../../functions/src/modules/notifications/domain/changeLog";
import { pushCatalogs } from "../../functions/src/modules/notifications/domain/i18n";
import { en } from "../../functions/src/modules/notifications/domain/i18n/en";
import { es } from "../../functions/src/modules/notifications/domain/i18n/es";
import {
  attendeeAddedPush, challengeReviewedPush, changePush, chatPush, invitePush, inviteAnsweredPush, reminderPush, weeklyThemePush, type PushMessage,
} from "../../functions/src/modules/notifications/domain/push";
import { FirestoreLocales } from "../../functions/src/modules/notifications/infrastructure/firestoreDelivery";
import type { Locale } from "../../functions/src/modules/i18n";

const change = (field: FieldChange["field"], from: string | null = null, to: string | null = null): FieldChange => ({ field, from, to });
const END = new Date("2030-01-01T13:00:00Z");

describe("catalogs", () => {
  test("push catalogs are consistent", () => {
    assert.deepEqual(checkCatalogs("push", en, es), []);
    assert.equal(pushCatalogs.en, en);
  });
});

describe("English output is byte-identical to the pre-i18n copy", () => {
  test("summarizeChanges", () => {
    assert.equal(summarizeChanges([change("status", "scheduled", "cancelled")]), "This activity was cancelled.");
    assert.equal(summarizeChanges([change("status", "cancelled", "scheduled")]), "This activity is back on.");
    assert.equal(summarizeChanges([change("startTime"), change("endTime"), change("venue.name"), change("title")]), "Updated: time, location, name.");
    assert.equal(summarizeChanges([
      change("description"), change("tagIds"), change("coverImageURL"), change("costCents"), change("capacity"), change("isOutdoor"),
    ]), "Updated: details, tags, photo, cost, spots, indoor/outdoor.");
    assert.equal(summarizeChanges([change("status", "scheduled", "scheduled")]), "This activity was updated.");
    assert.equal(summarizeChanges([]), "This activity was updated.");
    assert.equal(summarizeChanges([change("title")], "en"), "Updated: name.");
  });

  test("chat, change", () => {
    const chat = chatPush("c1", "e1", "Pizza night", "m1", "Ana", "hello   there");
    assert.equal(chat.title, "Pizza night");
    assert.equal(chat.body, "Ana: hello there");
    assert.equal(chatPush("c1", "e1", "Pizza night", "m1", "  ", "hi").body, "Someone: hi");
    assert.deepEqual(chat, chatPush("c1", "e1", "Pizza night", "m1", "Ana", "hello   there", "en"));
    const changed = changePush("c1", "e1", "Pizza night", 3, "Updated: time.", END);
    assert.equal(changed.body, "Updated: time.");
    assert.equal(changed.collapseId, "change-e1");
    assert.equal(changed.expiresAt, END);
  });

  test("reminder variants", () => {
    const start = new Date("2030-01-01T12:00:00Z");
    const body = (window: "1h" | "24h", minutes: number) => reminderPush("c1", "e1", "T", window, minutes * 60_000, start).body;
    assert.equal(body("1h", 60), "Starts in about an hour.");
    assert.equal(body("1h", 55), "Starts in about an hour.");
    assert.equal(body("1h", 30), "Starts in 30 minutes.");
    assert.equal(body("1h", 1), "Starts in 1 minutes.");
    assert.equal(body("24h", 24 * 60), "Starts tomorrow.");
    assert.equal(body("24h", 22 * 60), "Starts tomorrow.");
    assert.equal(body("24h", 21 * 60), "Starts in about 21 hours.");
  });

  test("invite family and challenges", () => {
    const invite = invitePush("c1", "e1", "Yoga", "i1", "Ana");
    assert.equal(invite.title, "New invitation");
    assert.equal(invite.body, "Ana invited you to Yoga.");
    assert.equal(invitePush("c1", "e1", "Yoga", "i1", "").body, "A coworker invited you to Yoga.");
    const added = attendeeAddedPush("c1", "e1", "Yoga");
    assert.equal(added.title, "You were added to an activity");
    assert.equal(added.body, "An organizer added you to Yoga.");
    const answered = inviteAnsweredPush("c1", "e1", "Yoga", "i1", "Ben");
    assert.equal(answered.title, "Invitation accepted");
    assert.equal(answered.body, "Ben accepted your invite to Yoga.");
    assert.equal(inviteAnsweredPush("c1", "e1", "Yoga", "i1", "").body, "A coworker accepted your invite to Yoga.");
    const approved = challengeReviewedPush("c1", "ch1", "s1", true, "Photo week");
    assert.equal(approved.title, "Your submission was approved");
    assert.equal(approved.body, "Photo week");
    const changes = challengeReviewedPush("c1", "ch1", "s1", false, "");
    assert.equal(changes.title, "Changes requested on your submission");
    assert.equal(changes.body, "Weekly challenge");
    const theme = weeklyThemePush("c1", "ch1", "Photo week", END);
    assert.equal(theme.title, "New weekly challenge");
    assert.equal(theme.body, "Photo week");
    assert.equal(weeklyThemePush("c1", "ch1", " ").body, "A new challenge just started.");
  });
});

describe("Spanish builders", () => {
  const strip = (m: PushMessage) => ({ data: m.data, threadId: m.threadId, collapseId: m.collapseId, category: m.category, expiresAt: m.expiresAt });

  test("copy is Spanish, server content is untouched, wire fields are identical", () => {
    const pairs: [PushMessage, PushMessage, string, string][] = [
      [invitePush("c1", "e1", "Yoga", "i1", "Ana"), invitePush("c1", "e1", "Yoga", "i1", "Ana", "es"), "Nueva invitación", "Ana te invitó a Yoga."],
      [attendeeAddedPush("c1", "e1", "Yoga"), attendeeAddedPush("c1", "e1", "Yoga", "es"), "Te agregaron a una actividad", "Un organizador te agregó a Yoga."],
      [inviteAnsweredPush("c1", "e1", "Yoga", "i1", "Ben"), inviteAnsweredPush("c1", "e1", "Yoga", "i1", "Ben", "es"), "Invitación aceptada", "Ben aceptó tu invitación a Yoga."],
      [challengeReviewedPush("c1", "ch1", "s1", true, "Photo week"), challengeReviewedPush("c1", "ch1", "s1", true, "Photo week", "es"), "Tu participación fue aprobada", "Photo week"],
      [challengeReviewedPush("c1", "ch1", "s1", false, ""), challengeReviewedPush("c1", "ch1", "s1", false, "", "es"), "Piden cambios en tu participación", "Reto semanal"],
      [weeklyThemePush("c1", "ch1", "Photo week", END), weeklyThemePush("c1", "ch1", "Photo week", END, "es"), "Nuevo reto semanal", "Photo week"],
      [weeklyThemePush("c1", "ch1", ""), weeklyThemePush("c1", "ch1", "", undefined, "es"), "Nuevo reto semanal", "Acaba de empezar un nuevo reto."],
      [chatPush("c1", "e1", "Pizza night", "m1", "", "hi"), chatPush("c1", "e1", "Pizza night", "m1", "", "hi", "es"), "Pizza night", "Alguien: hi"],
    ];
    for (const [english, spanish, title, body] of pairs) {
      assert.equal(spanish.title, title);
      assert.equal(spanish.body, body);
      assert.deepEqual(strip(spanish), strip(english));
    }
    assert.equal(invitePush("c1", "e1", "Yoga", "i1", "", "es").body, "Un colega te invitó a Yoga.");
    assert.equal(inviteAnsweredPush("c1", "e1", "Yoga", "i1", "", "es").body, "Un colega aceptó tu invitación a Yoga.");
  });

  test("change summaries", () => {
    assert.equal(summarizeChanges([change("status", "scheduled", "cancelled")], "es"), "Esta actividad se canceló.");
    assert.equal(summarizeChanges([change("status", "cancelled", "scheduled")], "es"), "Esta actividad vuelve a estar en pie.");
    assert.equal(summarizeChanges([change("startTime"), change("endTime"), change("venue.name")], "es"), "Actualizado: horario, lugar.");
    assert.equal(summarizeChanges([], "es"), "Se actualizó esta actividad.");
    const english = changePush("c1", "e1", "Yoga", 2, "x", END);
    const spanish = changePush("c1", "e1", "Yoga", 2, summarizeChanges([change("title")], "es"), END, "es");
    assert.equal(spanish.title, "Yoga");
    assert.equal(spanish.body, "Actualizado: nombre.");
    assert.deepEqual(strip(spanish), strip(english));
  });

  test("reminder plurals", () => {
    const start = new Date("2030-01-01T12:00:00Z");
    const body = (window: "1h" | "24h", minutes: number) => reminderPush("c1", "e1", "T", window, minutes * 60_000, start, "es").body;
    assert.equal(body("1h", 60), "Empieza en aproximadamente una hora.");
    assert.equal(body("1h", 1), "Empieza en 1 minuto.");
    assert.equal(body("1h", 30), "Empieza en 30 minutos.");
    assert.equal(body("24h", 24 * 60), "Empieza mañana.");
    assert.equal(body("24h", 21 * 60), "Empieza en aproximadamente 21 horas.");
    assert.equal(body("24h", 90), "Empieza en aproximadamente 2 horas.");
    const english = reminderPush("c1", "e1", "T", "1h", 30 * 60_000, start);
    assert.deepEqual(strip(reminderPush("c1", "e1", "T", "1h", 30 * 60_000, start, "es")), strip(english));
  });
});

describe("router locale grouping", () => {
  const token = (name: string) => `token-${name}-${"x".repeat(24)}`;
  const base = (): PushMessage => invitePush("c1", "e1", "Yoga", "i1", "Ana");

  function setup(locales?: LocaleReader) {
    const calls: { tokens: string[]; message: PushMessage }[] = [];
    const warnings: Record<string, unknown>[] = [];
    const deps: RouterDependencies = {
      messaging: { sendMulticast: async (tokens, message): Promise<SendResult[]> => { calls.push({ tokens: [...tokens], message }); return tokens.map(() => ({ success: true })); } } as MessagingPort,
      devices: {
        tokensFor: async (uids) => uids.map((uid): DeviceToken => ({ uid, token: token(uid), tokenHash: `h-${uid}` })),
        remove: async () => undefined,
      },
      preferences: { preferencesFor: async () => new Map() },
      receipts: { claim: async () => true, complete: async () => undefined, isDone: async () => false },
      rateLimiter: { admit: async (uids) => new Set(uids) },
      logger: { info: () => undefined, warn: (_m, fields) => { warnings.push(fields); }, error: () => undefined },
      clock: { now: () => new Date("2026-03-01T10:15:00Z") },
      ...(locales ? { locales } : {}),
    };
    return { deps, calls, warnings };
  }
  const request = (withPushFor: boolean): NotificationRequest => ({
    id: "invite_i1", kind: "invite", companyId: "c1",
    recipients: [{ uid: "u-en" }, { uid: "u-es" }, { uid: "u-none" }],
    push: base(),
    ...(withPushFor ? { pushFor: (locale: Locale) => invitePush("c1", "e1", "Yoga", "i1", "Ana", locale) } : {}),
  });

  test("mixed locales produce one multicast per locale and merged stats", async () => {
    const reads: string[][] = [];
    const locales: LocaleReader = { localesFor: async (uids) => { reads.push([...uids]); return new Map<string, Locale>([["u-en", "en"], ["u-es", "es"]]); } };
    const { deps, calls } = setup(locales);
    const stats = await deliverNotification(deps, request(true));
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0]!.sort(), ["u-en", "u-es", "u-none"]);
    assert.equal(calls.length, 2);
    const spanish = calls.find((call) => call.message.title === "Nueva invitación")!;
    const english = calls.find((call) => call.message.title === "New invitation")!;
    assert.deepEqual(spanish.tokens, [token("u-es")]);
    assert.deepEqual(english.tokens.sort(), [token("u-en"), token("u-none")].sort());
    assert.equal(english.message.body, "Ana invited you to Yoga.");
    assert.equal(spanish.message.body, "Ana te invitó a Yoga.");
    assert.equal(stats.recipients, 3);
    assert.equal(stats.tokens, 3);
    assert.equal(stats.sent, 3);
    assert.equal(stats.failed, 0);
  });

  test("all-English recipients stay a single multicast", async () => {
    const { deps, calls } = setup({ localesFor: async () => new Map() });
    await deliverNotification(deps, request(true));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.message.title, "New invitation");
    assert.equal(calls[0]!.tokens.length, 3);
  });

  test("a throwing locale reader falls back to English for everyone and warns without PII", async () => {
    const { deps, calls, warnings } = setup({ localesFor: async () => { throw new Error("boom u-es"); } });
    const stats = await deliverNotification(deps, request(true));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.message.title, "New invitation");
    assert.equal(stats.sent, 3);
    assert.equal(warnings.length, 1);
    assert.ok(!JSON.stringify(warnings[0]).includes("boom"));
  });

  test("without pushFor or locales it is a single multicast of request.push", async () => {
    const reads: string[][] = [];
    const withReader = setup({ localesFor: async (uids) => { reads.push([...uids]); return new Map<string, Locale>([["u-es", "es"]]); } });
    await deliverNotification(withReader.deps, request(false));
    assert.equal(reads.length, 0);
    assert.equal(withReader.calls.length, 1);
    assert.equal(withReader.calls[0]!.message.title, "New invitation");
    const withoutReader = setup();
    await deliverNotification(withoutReader.deps, request(true));
    assert.equal(withoutReader.calls.length, 1);
    assert.equal(withoutReader.calls[0]!.message.title, "New invitation");
  });

  test("only rate-admitted recipients are read", async () => {
    const reads: string[][] = [];
    const { deps, calls } = setup({ localesFor: async (uids) => { reads.push([...uids]); return new Map<string, Locale>([["u-es", "es"]]); } });
    deps.rateLimiter = { admit: async () => new Set(["u-es"]) };
    await deliverNotification(deps, request(true));
    assert.deepEqual(reads, [["u-es"]]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.message.title, "Nueva invitación");
  });
});

describe("new-trigger requests set an English push and a localized builder", () => {
  test("pushFor('en') equals push; es differs only in copy", () => {
    const requests: NotificationRequest[] = [
      attendeeAddedRequest({ companyId: "c1", eventId: "e1", eventTitle: "Yoga", userId: "u1", notificationId: "n1" }),
      inviteAnsweredRequest({ companyId: "c1", eventId: "e1", eventTitle: "Yoga", inviteId: "i1", senderId: "u1", responderName: "Ben" }),
      challengeReviewedRequest({ companyId: "c1", challengeId: "ch1", submissionId: "s1", userId: "u1", challengeTitle: "Photo", approved: true, notificationId: "n2" }),
      weeklyThemeRequest({ companyId: "c1", challengeId: "ch1", title: "Photo", startDate: new Date(0), endDate: END }, ["u1"]),
    ];
    for (const request of requests) {
      assert.ok(request.pushFor);
      assert.deepEqual(request.pushFor("en"), request.push);
      const spanish = request.pushFor("es");
      assert.notEqual(spanish.title, request.push.title);
      assert.deepEqual(spanish.data, request.push.data);
    }
    const answered = requests[1]!;
    assert.deepEqual(answered.inApp, { title: "Invitation accepted", body: "Ben accepted your invite to Yoga.", targetType: "event", targetId: "e1" });
  });
});

describe("FirestoreLocales", () => {
  test("reads only the locale field, maps unsupported and missing to en", async () => {
    const docs: Record<string, unknown> = { a: "es", b: "fr", c: undefined };
    let mask: unknown;
    const db = {
      collection: () => ({ doc: (uid: string) => ({ id: uid }) }),
      getAll: async (...args: unknown[]) => {
        mask = args[args.length - 1];
        return (args.slice(0, -1) as { id: string }[]).map((ref) => ({
          id: ref.id, exists: ref.id !== "d", get: (field: string) => (field === "locale" ? docs[ref.id] : undefined),
        }));
      },
    };
    const result = await new FirestoreLocales(db as never).localesFor(["a", "b", "c", "d"]);
    assert.deepEqual(mask, { fieldMask: ["locale"] });
    assert.deepEqual([...result], [["a", "es"], ["b", "en"], ["c", "en"], ["d", "en"]]);
  });
});
