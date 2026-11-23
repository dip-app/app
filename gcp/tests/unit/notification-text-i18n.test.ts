import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { Locale } from "../../functions/src/modules/i18n";
import { inviteNotificationText } from "../../functions/src/modules/invites/domain/invitePolicy";
import { inviteAnsweredRequest } from "../../functions/src/modules/notifications/application/newTriggers";
import type { DeviceToken, InboxItem, MessagingPort, SendResult } from "../../functions/src/modules/notifications/application/ports";
import { deliverNotification, type NotificationRequest, type RouterDependencies } from "../../functions/src/modules/notifications/application/router";
import type { LocaleReader } from "../../functions/src/modules/notifications/application/routerPorts";
import { photoAddedRequest, photoCommentRequest } from "../../functions/src/modules/notifications/application/socialTriggers";
import { attendeeAddedNotice, challengeApprovedNotice, inviteNotice } from "../../functions/src/modules/notifications/domain/notices";

// In-app notices (`users/{uid}/notifications`) in the recipient's language. English must stay byte-identical to the
// strings written before localization; these literals are the old code's output.

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const oldInvite = (fromName: string, eventTitle: string) => ({ title: "New invitation", body: `${clip(fromName || "A coworker", 40)} invited you to ${clip(eventTitle, 60)}.` });

describe("transactional notices: English unchanged, Spanish localized", () => {
  test("invite (sendInviteV1)", () => {
    const long = "A".repeat(70);
    for (const [from, title] of [["Ana", "Yoga"], ["", "Lunch & {games}"], [long, long], ["O'Neil #1", "Café 'run'"]] as const) {
      assert.deepEqual(inviteNotificationText(from, title), oldInvite(from, title));
      assert.deepEqual(inviteNotificationText(from, title, "en"), oldInvite(from, title));
      assert.deepEqual(inviteNotice(from, title), oldInvite(from, title));
    }
    assert.deepEqual(inviteNotificationText("Ana", "Yoga", "es"), { title: "Nueva invitación", body: "Ana te invitó a Yoga." });
    assert.deepEqual(inviteNotificationText("", "Yoga", "es"), { title: "Nueva invitación", body: "Un colega te invitó a Yoga." });
  });

  test("attendee added (addEventAttendeeV1)", () => {
    assert.deepEqual(attendeeAddedNotice("Sunset run"), { title: "You're going!", body: "An organizer added you to Sunset run." });
    assert.deepEqual(attendeeAddedNotice("{x} #1"), { title: "You're going!", body: "An organizer added you to {x} #1." });
    assert.deepEqual(attendeeAddedNotice("Sunset run", "es"), { title: "¡Ya tienes tu lugar!", body: "Un organizador te agregó a Sunset run." });
  });

  test("challenge approved (approveChallengeV1), raw numbers in English", () => {
    const old = (points: number) => (points > 0 ? `You earned ${points} ${points === 1 ? "point" : "points"}.` : "Your entry was approved.");
    for (const points of [0, 1, 2, 50, 1000, 12345]) {
      assert.deepEqual(challengeApprovedNotice(points), { title: "Challenge approved", body: old(points) });
    }
    assert.deepEqual(challengeApprovedNotice(1, "es"), { title: "Reto aprobado", body: "Ganaste 1 punto." });
    assert.deepEqual(challengeApprovedNotice(50, "es"), { title: "Reto aprobado", body: "Ganaste 50 puntos." });
    assert.deepEqual(challengeApprovedNotice(0, "es"), { title: "Reto aprobado", body: "Tu participación fue aprobada." });
  });
});

describe("router-written notices: inAppFor('en') equals inApp", () => {
  test("invite answered, photo comment, photo added", () => {
    const requests: NotificationRequest[] = [
      inviteAnsweredRequest({ companyId: "c1", eventId: "e1", eventTitle: "Yoga", inviteId: "i1", senderId: "u1", responderName: "Ben" }),
      photoCommentRequest({ companyId: "c1", eventId: "e1", photoId: "p1", commentId: "m1", eventTitle: "Yoga", uploaderId: "u1", authorName: "Ben", text: "Nice!" }),
      photoAddedRequest({ companyId: "c1", eventId: "e1", photoId: "p1", eventTitle: "Yoga", uploaderId: "u2", uploaderName: "Ben", createdAt: new Date(0), recipients: ["u1"] }),
    ];
    for (const request of requests) {
      assert.ok(request.inApp && request.inAppFor, request.kind);
      assert.deepEqual(request.inAppFor("en"), { title: request.inApp.title, body: request.inApp.body });
      assert.notDeepEqual(request.inAppFor("es"), request.inAppFor("en"), request.kind);
    }
    assert.deepEqual(requests[0]!.inAppFor!("es"), { title: "Invitación aceptada", body: "Ben aceptó tu invitación a Yoga." });
    assert.deepEqual(requests[2]!.inAppFor!("es"), { title: "Yoga", body: "Ben agregó una foto al álbum." });
  });
});

describe("router writes each recipient's notice in their language", () => {
  function setup(locales?: LocaleReader) {
    const written: InboxItem[] = [];
    const warnings: Record<string, unknown>[] = [];
    const deps: RouterDependencies = {
      messaging: { sendMulticast: async (tokens): Promise<SendResult[]> => tokens.map(() => ({ success: true })) } as MessagingPort,
      devices: { tokensFor: async (uids) => uids.map((uid): DeviceToken => ({ uid, token: `token-${uid}-${"x".repeat(24)}`, tokenHash: `h-${uid}` })), remove: async () => undefined },
      preferences: { preferencesFor: async () => new Map() },
      receipts: { claim: async () => true, complete: async () => undefined, isDone: async () => false },
      rateLimiter: { admit: async (uids) => new Set(uids) },
      inbox: { createMany: async (items) => { written.push(...items); return items.length; } },
      logger: { info: () => undefined, warn: (_m, fields) => { warnings.push(fields); }, error: () => undefined },
      clock: { now: () => new Date("2026-03-01T10:15:00Z") },
      ...(locales ? { locales } : {}),
    };
    return { deps, written, warnings };
  }
  const request = (inAppFor?: NotificationRequest["inAppFor"]): NotificationRequest => {
    const base = inviteAnsweredRequest({ companyId: "c1", eventId: "e1", eventTitle: "Yoga", inviteId: "i1", senderId: "u-en", responderName: "Ben" });
    const { inAppFor: _, ...rest } = base;
    return { ...rest, recipients: [{ uid: "u-en" }, { uid: "u-es" }, { uid: "u-none" }], ...(inAppFor ? { inAppFor } : {}) };
  };
  const spanishReader: LocaleReader = { localesFor: async () => new Map<string, Locale>([["u-en", "en"], ["u-es", "es"]]) };
  const byUid = (items: InboxItem[]) => Object.fromEntries(items.map((item) => [item.uid, [item.title, item.body]]));
  const builder = inviteAnsweredRequest({ companyId: "c1", eventId: "e1", eventTitle: "Yoga", inviteId: "i1", senderId: "u-en", responderName: "Ben" }).inAppFor!;

  test("mixed locales: Spanish for the Spanish member, English for English and unset; same id, type and target", async () => {
    const { deps, written } = setup(spanishReader);
    const stats = await deliverNotification(deps, request(builder));
    assert.equal(stats.inApp, 3);
    assert.deepEqual(byUid(written), {
      "u-en": ["Invitation accepted", "Ben accepted your invite to Yoga."],
      "u-es": ["Invitación aceptada", "Ben aceptó tu invitación a Yoga."],
      "u-none": ["Invitation accepted", "Ben accepted your invite to Yoga."],
    });
    for (const item of written) {
      assert.equal(item.id, "invite_answered_i1");
      assert.equal(item.type, "invite_answered");
      assert.equal(item.targetId, "e1");
    }
  });

  test("no builder, no reader, a failing reader or a failing builder: everyone gets the English notice", async () => {
    const english = ["Invitation accepted", "Ben accepted your invite to Yoga."];
    const expectAllEnglish = (items: InboxItem[]) => assert.deepEqual(Object.values(byUid(items)), [english, english, english]);
    const noBuilder = setup(spanishReader);
    await deliverNotification(noBuilder.deps, request());
    expectAllEnglish(noBuilder.written);
    const noReader = setup();
    await deliverNotification(noReader.deps, request(builder));
    expectAllEnglish(noReader.written);
    const failingReader = setup({ localesFor: async () => { throw new Error("down u-es"); } });
    await deliverNotification(failingReader.deps, request(builder));
    expectAllEnglish(failingReader.written);
    assert.ok(failingReader.warnings.length >= 1 && !JSON.stringify(failingReader.warnings).includes("down"));
    const failingBuilder = setup(spanishReader);
    await deliverNotification(failingBuilder.deps, request(() => { throw new Error("copy bug"); }));
    expectAllEnglish(failingBuilder.written);
  });
});
