import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  APNS_CATEGORIES, INVITE_APNS_CATEGORY, attendeeAddedPush, attendeeRemovedPush, changePush, chatPush, challengeReviewedPush,
  invitePush, inviteAnsweredPush, photoAddedPush, photoCommentPush, reminderPush, weeklyThemePush, type PushMessage,
} from "../../src/modules/notifications/domain/push";
import { toMulticast } from "../../src/modules/notifications/infrastructure/messaging";

/**
 * Quick actions (docs/design/push-catalog.md, "Quick actions"): every push carries the `aps.category` the iOS app
 * registers. The category is additive: titles, bodies and data keys are pinned here byte for byte (English) so the
 * old payload is unchanged for builds that ignore the category.
 */

const START = new Date("2030-01-01T18:00:00.000Z");
const END = new Date("2030-01-01T20:00:00.000Z");

function aps(message: PushMessage): Record<string, unknown> {
  return toMulticast(["t"], message).apns?.payload?.aps as Record<string, unknown>;
}

interface Case { kind: string; message: PushMessage; category: string; title: string; body: string; data: Record<string, string> }

const cases: Case[] = [
  {
    kind: "invite", message: invitePush("c1", "e1", "Pizza night", "e1_u2", "Fran"), category: "DIP_INVITE",
    title: "New invitation", body: "Fran invited you to Pizza night.",
    data: { type: "invite", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", inviteId: "e1_u2", category: "invites" },
  },
  {
    kind: "invite_answered", message: inviteAnsweredPush("c1", "e1", "Pizza night", "e1_u2", "Ana"), category: "DIP_OPEN",
    title: "Invitation accepted", body: "Ana accepted your invite to Pizza night.",
    data: { type: "invite_answered", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", inviteId: "e1_u2", category: "invites" },
  },
  {
    kind: "attendee_added", message: attendeeAddedPush("c1", "e1", "Pizza night"), category: "DIP_EVENT_GOING",
    title: "You were added to an activity", body: "An organizer added you to Pizza night.",
    data: { type: "attendee_added", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", category: "event_updates" },
  },
  {
    kind: "attendee_removed", message: attendeeRemovedPush("c1", "e1", "Pizza night"), category: "DIP_OPEN",
    title: "Your spot was released", body: "An organizer removed you from Pizza night.",
    data: { type: "attendee_removed", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", category: "event_updates" },
  },
  {
    kind: "event_changed", message: changePush("c1", "e1", "Pizza night", 3, "Time updated.", END), category: "DIP_EVENT_GOING",
    title: "Pizza night", body: "Time updated.",
    data: { type: "event_changed", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", revision: "3", category: "event_updates" },
  },
  {
    kind: "event_cancelled", message: changePush("c1", "e1", "Pizza night", 4, "This activity was cancelled.", END, "en", true), category: "DIP_OPEN",
    title: "Pizza night", body: "This activity was cancelled.",
    data: { type: "event_changed", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", revision: "4", category: "event_updates" },
  },
  {
    kind: "reminder 24h", message: reminderPush("c1", "e1", "Pizza night", "24h", 24 * 3_600_000, START), category: "DIP_REMINDER",
    title: "Pizza night", body: "Starts tomorrow.",
    data: { type: "reminder", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", window: "24h", category: "reminders" },
  },
  {
    kind: "reminder 1h", message: reminderPush("c1", "e1", "Pizza night", "1h", 3_600_000, START), category: "DIP_REMINDER",
    title: "Pizza night", body: "Starts in about an hour.",
    data: { type: "reminder", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", window: "1h", category: "reminders" },
  },
  {
    kind: "chat", message: chatPush("c1", "e1", "Pizza night", "m1", "Ana", "See you there"), category: "DIP_CHAT",
    title: "Pizza night", body: "Ana: See you there",
    data: { type: "chat", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1/chat", messageId: "m1", category: "chat" },
  },
  {
    kind: "challenge_approved", message: challengeReviewedPush("c1", "w1", "s1", true, "Best lunch spot"), category: "DIP_OPEN",
    title: "Your submission was approved", body: "Best lunch spot",
    data: { type: "challenge_approved", companyId: "c1", challengeId: "w1", deepLink: "dip://challenges/w1", category: "challenges", submissionId: "s1" },
  },
  {
    kind: "challenge_changes_requested", message: challengeReviewedPush("c1", "w1", "s1", false, "Best lunch spot"), category: "DIP_OPEN",
    title: "Changes requested on your submission", body: "Best lunch spot",
    data: { type: "challenge_changes_requested", companyId: "c1", challengeId: "w1", deepLink: "dip://challenges/w1", category: "challenges", submissionId: "s1" },
  },
  {
    kind: "weekly_theme", message: weeklyThemePush("c1", "w1", "Best lunch spot", END), category: "DIP_OPEN",
    title: "New weekly challenge", body: "Best lunch spot",
    data: { type: "weekly_theme", companyId: "c1", challengeId: "w1", deepLink: "dip://challenges/w1", category: "challenges" },
  },
  {
    kind: "photo_comment", message: photoCommentPush("c1", "e1", "p1", "cm1", "Ana", "Great shot"), category: "DIP_PHOTO_COMMENT",
    title: "New comment on your photo", body: "Ana: Great shot",
    data: { type: "photo_comment", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", photoId: "p1", commentId: "cm1", category: "social" },
  },
  {
    kind: "photo_added", message: photoAddedPush("c1", "e1", "Pizza night", "p1", "Olive"), category: "DIP_OPEN",
    title: "Pizza night", body: "Olive added a photo to the album.",
    data: { type: "photo_added", companyId: "c1", eventId: "e1", deepLink: "dip://events/e1", photoId: "p1", category: "social" },
  },
];

describe("quick action categories", () => {
  for (const item of cases) {
    test(`${item.kind}: aps.category ${item.category}; English copy and data keys unchanged`, () => {
      assert.equal(item.message.apnsCategory, item.category);
      assert.equal(aps(item.message).category, item.category);
      assert.equal(item.message.title, item.title);
      assert.equal(item.message.body, item.body);
      assert.deepEqual(item.message.data, item.data);
      // The category never leaks into the data keys the app routes on.
      assert.deepEqual(toMulticast(["t"], item.message).data, item.data);
    });
  }

  test("every push kind is covered and every category is one the app registers", () => {
    const registered = new Set<string>(Object.values(APNS_CATEGORIES));
    assert.deepEqual([...registered].sort(), ["DIP_CHAT", "DIP_EVENT_GOING", "DIP_INVITE", "DIP_OPEN", "DIP_PHOTO_COMMENT", "DIP_REMINDER"]);
    for (const item of cases) assert.ok(registered.has(item.category), item.kind);
    assert.equal(INVITE_APNS_CATEGORY, "DIP_INVITE");
  });

  test("leave, reply and answer actions only ride on pushes that carry the ids the app needs", () => {
    for (const item of cases) {
      if (item.category === "DIP_EVENT_GOING" || item.category === "DIP_REMINDER" || item.category === "DIP_CHAT") {
        assert.ok(item.data.companyId && item.data.eventId, item.kind);
      }
      if (item.category === "DIP_PHOTO_COMMENT") assert.ok(item.data.companyId && item.data.eventId && item.data.photoId, item.kind);
      if (item.category === "DIP_INVITE") assert.ok(item.data.companyId && item.data.inviteId, item.kind);
    }
  });

  test("Spanish copy keeps the same category; a cancelled change in Spanish is still DIP_OPEN", () => {
    assert.equal(changePush("c1", "e1", "Noche de pizza", 4, "x", END, "es", true).apnsCategory, "DIP_OPEN");
    assert.equal(changePush("c1", "e1", "Noche de pizza", 4, "x", END, "es").apnsCategory, "DIP_EVENT_GOING");
    assert.equal(reminderPush("c1", "e1", "Noche de pizza", "1h", 3_600_000, START, "es").apnsCategory, "DIP_REMINDER");
    assert.equal(chatPush("c1", "e1", "Noche", "m1", "Ana", "hola", "es").apnsCategory, "DIP_CHAT");
    assert.equal(photoCommentPush("c1", "e1", "p1", "cm1", "Ana", "hola", "es").apnsCategory, "DIP_PHOTO_COMMENT");
  });
});
