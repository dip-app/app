import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { InboxItem, MessagingPort } from "../../src/modules/notifications/application/ports";
import { attendeeRemovedRequest } from "../../src/modules/notifications/application/newTriggers";
import { deliverNotification, type RouterDependencies } from "../../src/modules/notifications/application/router";
import type { LocaleReader } from "../../src/modules/notifications/application/routerPorts";
import {
  ALBUM_RECIPIENT_LIMIT, onPhotoAddedPushed, onPhotoCommentPushed, photoAddedId, type AlbumPhoto, type AlbumReader,
} from "../../src/modules/notifications/application/socialTriggers";
import { NOTIFICATION_KINDS } from "../../src/modules/notifications/domain/categories";
import { resolvePreferences } from "../../src/modules/notifications/domain/preferences";
import { RATE_CLASS_LIMITS, nextCounts, rateClassOf, type RateLimitState } from "../../src/modules/notifications/domain/rateLimit";
import { INVITE_APNS_CATEGORY, attendeeRemovedPush, invitePush, photoAddedPush, photoCommentPush } from "../../src/modules/notifications/domain/push";
import { toMulticast } from "../../src/modules/notifications/infrastructure/messaging";

const NOW = new Date("2026-11-19T15:30:00Z");
const DEEP_LINK = /^dip:\/\/(events\/[A-Za-z0-9_-]+(\/chat)?|challenges(\/[A-Za-z0-9_-]+)?)$/;

class World {
  sent: Array<{ tokens: string[]; title: string; body: string; deepLink: string }> = [];
  inbox: InboxItem[] = [];
  receipts = new Map<string, "processing" | "done">();
  counts = new Map<string, RateLimitState | null>();
  prefs = new Map<string, ReturnType<typeof resolvePreferences>>();
  locales = new Map<string, "en" | "es">();
  photos = new Map<string, AlbumPhoto>();
  going = new Map<string, string[]>();
  /** uid -> company; a uid absent here is treated as inactive. */
  members = new Map<string, string>();
  tokens = new Map<string, string[]>();

  messaging: MessagingPort = {
    sendMulticast: async (tokens, message) => {
      this.sent.push({ tokens: [...tokens], title: message.title, body: message.body, deepLink: message.data.deepLink });
      return tokens.map(() => ({ success: true }));
    },
  };
  album: AlbumReader = {
    photo: async (companyId, eventId, photoId) => (companyId === this.photos.get(`${eventId}/${photoId}`)?.companyId ? this.photos.get(`${eventId}/${photoId}`)! : null),
    goingAttendees: async (_c, eventId, limit) => (this.going.get(eventId) ?? []).slice(0, limit),
  };
  localeReader: LocaleReader = { localesFor: async (uids) => new Map(uids.map((uid) => [uid, this.locales.get(uid) ?? "en"])) };

  deps(): RouterDependencies & { album: AlbumReader } {
    return {
      messaging: this.messaging, album: this.album, locales: this.localeReader, clock: { now: () => NOW },
      devices: { tokensFor: async (uids) => uids.flatMap((uid) => (this.tokens.get(uid) ?? []).map((token) => ({ uid, tokenHash: `h-${token}`, token }))), remove: async () => undefined },
      preferences: { preferencesFor: async (uids) => new Map(uids.filter((uid) => this.prefs.has(uid)).map((uid) => [uid, this.prefs.get(uid)!])) },
      receipts: {
        claim: async (id) => { if (this.receipts.has(id)) return false; this.receipts.set(id, "processing"); return true; },
        complete: async (id) => { this.receipts.set(id, "done"); },
        isDone: async (id) => this.receipts.get(id) === "done",
      },
      rateLimiter: {
        admit: async (uids, now, rateClass) => {
          const allowed = new Set<string>();
          for (const uid of uids) {
            const { admitted, state } = nextCounts(this.counts.get(uid) ?? null, now, rateClass);
            this.counts.set(uid, state);
            if (admitted) allowed.add(uid);
          }
          return allowed;
        },
      },
      inbox: { createMany: async (items) => {
        let created = 0;
        for (const item of items) if (!this.inbox.some((x) => x.uid === item.uid && x.id === item.id)) { this.inbox.push(item); created++; }
        return created;
      } },
      members: { activeIn: async (companyId, uids) => new Set(uids.filter((uid) => this.members.get(uid) === companyId)) },
    };
  }
}

const socialOn = () => resolvePreferences({ push: { social: true } });

function world(): World {
  const w = new World();
  w.photos.set("e1/p1", { companyId: "c1", uploaderId: "owner", uploaderName: "Olive", eventTitle: "Pizza night" });
  for (const uid of ["owner", "ana", "bo", "cy"]) { w.members.set(uid, "c1"); w.tokens.set(uid, [`tok-${uid}`]); w.prefs.set(uid, socialOn()); }
  w.going.set("e1", ["owner", "ana", "bo"]);
  return w;
}

const comment = (over: Record<string, unknown> = {}) => ({ companyId: "c1", photoId: "p1", authorId: "ana", authorName: "Ana", text: "Great shot!", ...over });

describe("registry", () => {
  test("photo kinds are social, ungated by the event level, with their own rate class", () => {
    for (const kind of ["photo_comment", "photo_added"] as const) {
      assert.equal(NOTIFICATION_KINDS[kind].category, "social");
      assert.equal(NOTIFICATION_KINDS[kind].eventLevel, null);
      assert.equal(rateClassOf(kind), "social");
    }
    assert.equal(NOTIFICATION_KINDS.photo_comment.inAppType, "comment");
    assert.equal(NOTIFICATION_KINDS.photo_added.inAppType, "photo_added");
  });

  test("social defaults to off for push, so nothing is sent without opting in", async () => {
    const w = world();
    w.prefs.clear();
    const stats = await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", comment());
    assert.equal(stats.blocked.category_off, 1);
    assert.equal(w.sent.length, 0);
    // The in-app notice is not governed by the push switch.
    assert.equal(w.inbox.length, 1);
  });

  test("the social bucket has its own budget and leaves the shared one untouched", () => {
    let state: RateLimitState | null = null;
    for (let i = 0; i < RATE_CLASS_LIMITS.social.perHour; i++) {
      const step = nextCounts(state, NOW, "social");
      assert.equal(step.admitted, true);
      state = step.state;
    }
    assert.equal(nextCounts(state, NOW, "social").admitted, false);
    assert.equal(nextCounts(state, NOW, "shared").admitted, true);
  });
});

describe("push copy", () => {
  test("photo comment: snippet capped at 80 characters, event deep link, social category", () => {
    const push = photoCommentPush("c1", "e1", "p1", "cm1", "Ana", "x".repeat(300));
    assert.equal(push.title, "New comment on your photo");
    assert.equal(push.body.length, "Ana: ".length + 80);
    assert.match(push.data.deepLink, DEEP_LINK);
    assert.equal(push.data.category, "social");
    assert.equal(push.data.photoId, "p1");
    assert.equal(photoCommentPush("c1", "e1", "p1", "cm1", " ", "hi").body, "Someone: hi");
    assert.equal(photoCommentPush("c1", "e1", "p1", "cm1", "Ana", "hola", "es").title, "Nuevo comentario en tu foto");
    assert.equal(photoCommentPush("c1", "e1", "p1", "cm1", " ", "hola", "es").body, "Alguien: hola");
  });

  test("photo added: event title as title, no photo text, both locales", () => {
    const push = photoAddedPush("c1", "e1", "Pizza night", "p1", "Olive");
    assert.equal(push.title, "Pizza night");
    assert.equal(push.body, "Olive added a photo to the album.");
    assert.match(push.data.deepLink, DEEP_LINK);
    assert.equal(photoAddedPush("c1", "e1", "Pizza night", "p1", "Olive", "es").body, "Olive agregó una foto al álbum.");
    assert.equal(photoAddedPush("c1", "e1", "Pizza night", "p1", "  ", "es").body, "Alguien agregó una foto al álbum.");
  });

  test("invite pushes carry the PUSH-8 category; English text is unchanged", () => {
    const push = invitePush("c1", "e1", "Pizza night", "e1_u2", "Fran");
    assert.equal(push.apnsCategory, INVITE_APNS_CATEGORY);
    assert.equal(push.title, "New invitation");
    assert.equal(push.body, "Fran invited you to Pizza night.");
    const aps = toMulticast(["t"], push).apns?.payload?.aps as Record<string, unknown>;
    assert.equal(aps.category, "DIP_INVITE");
    assert.equal(push.data.inviteId, "e1_u2");
    assert.equal(push.data.companyId, "c1");
  });
});

describe("attendee removed push", () => {
  test("copy in both locales, event deep link, event_updates category, no per-event gate", () => {
    const push = attendeeRemovedPush("c1", "e1", "Pizza night");
    assert.equal(push.title, "Your spot was released");
    assert.equal(push.body, "An organizer removed you from Pizza night.");
    assert.equal(push.category, "event_updates");
    assert.equal(push.data.type, "attendee_removed");
    assert.match(push.data.deepLink, DEEP_LINK);
    assert.equal(attendeeRemovedPush("c1", "e1", "Pizza night", "es").title, "Tu lugar fue liberado");
    assert.equal(NOTIFICATION_KINDS.attendee_removed.eventLevel, null);
  });

  test("router: delivered once, respects the event_updates switch, keeps the in-app notice to the command", async () => {
    const w = world();
    const request = attendeeRemovedRequest({ companyId: "c1", eventId: "e1", eventTitle: "Pizza night", userId: "ana", notificationId: "admin_req-0001" });
    assert.equal(request.inApp, undefined);
    assert.equal((await deliverNotification(w.deps(), request)).sent, 1);
    assert.equal((await deliverNotification(w.deps(), request)).duplicate, true);
    assert.equal(w.sent.length, 1);
    w.prefs.set("bo", resolvePreferences({ push: { event_updates: false } }));
    w.tokens.set("bo", ["tok-bo"]);
    const off = await deliverNotification(w.deps(), attendeeRemovedRequest({ companyId: "c1", eventId: "e1", eventTitle: "T", userId: "bo", notificationId: "admin_req-0002" }));
    assert.equal(off.blocked.category_off, 1);
    // A member of another company is never reached.
    const other = await deliverNotification(w.deps(), attendeeRemovedRequest({ companyId: "c2", eventId: "e1", eventTitle: "T", userId: "ana", notificationId: "admin_req-0003" }));
    assert.equal(other.blocked.inactive, 1);
    assert.equal(w.sent.length, 1);
  });
});

describe("photo comment push", () => {
  test("notifies the uploader only, with the author's snippet and an in-app notice", async () => {
    const w = world();
    const stats = await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", comment());
    assert.equal(stats.sent, 1);
    assert.deepEqual(w.sent.map((s) => s.tokens), [["tok-owner"]]);
    assert.equal(w.sent[0]!.body, "Ana: Great shot!");
    assert.equal(w.sent[0]!.deepLink, "dip://events/e1");
    assert.deepEqual(w.inbox.map((i) => [i.uid, i.type, i.targetType, i.targetId]), [["owner", "comment", "event", "e1"]]);
  });

  test("a comment by the uploader notifies nobody", async () => {
    const w = world();
    await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", comment({ authorId: "owner" }));
    assert.equal(w.sent.length, 0);
    assert.equal(w.inbox.length, 0);
  });

  test("tenant isolation: a photo or comment of another company is dropped", async () => {
    const w = world();
    // Trigger path says c2 but the photo lives in c1: the reader finds no photo for c2.
    await onPhotoCommentPushed(w.deps(), "c2", "e1", "p1", "comment-0001", comment({ companyId: "c2" }));
    // Comment claims another company than its path.
    await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0002", comment({ companyId: "c2" }));
    // Comment for a different photo than its path.
    await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0003", comment({ photoId: "other" }));
    assert.equal(w.sent.length, 0);
    assert.equal(w.inbox.length, 0);
  });

  test("an uploader who left the company (inactive) gets nothing", async () => {
    const w = world();
    w.members.set("owner", "c2");
    const stats = await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", comment());
    assert.equal(stats.blocked.inactive, 1);
    assert.equal(w.sent.length, 0);
    assert.equal(w.inbox.length, 0);
  });

  test("redelivery of the same comment sends once", async () => {
    const w = world();
    await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", comment());
    const again = await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", comment());
    assert.equal(again.duplicate, true);
    assert.equal(w.sent.length, 1);
    assert.equal(w.inbox.length, 1);
  });

  test("honors the recipient's locale", async () => {
    const w = world();
    w.locales.set("owner", "es");
    await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", comment());
    assert.equal(w.sent[0]!.title, "Nuevo comentario en tu foto");
  });

  test("the social cap drops pushes beyond the hourly budget while in-app notices continue", async () => {
    const w = world();
    const limit = RATE_CLASS_LIMITS.social.perHour;
    for (let i = 0; i < limit + 3; i++) await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", `comment-${String(i).padStart(4, "0")}`, comment());
    assert.equal(w.sent.length, limit);
    assert.equal(w.inbox.length, limit + 3);
  });

  test("incomplete comment documents are ignored", async () => {
    const w = world();
    await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0001", { companyId: "c1", photoId: "p1", text: "hi" });
    await onPhotoCommentPushed(w.deps(), "c1", "e1", "p1", "comment-0002", comment({ text: "" }));
    assert.equal(w.sent.length, 0);
  });
});

describe("photo added push", () => {
  const photoDoc = { companyId: "c1", uploaderId: "owner", uploaderName: "Olive", eventTitle: "Pizza night" };

  test("notifies the other attendees who went, not the uploader and not non-attendees", async () => {
    const w = world();
    const stats = await onPhotoAddedPushed(w.deps(), "c1", "e1", "p1", photoDoc, NOW);
    assert.equal(stats.sent, 2);
    assert.deepEqual(w.sent.map((s) => s.tokens).flat().sort(), ["tok-ana", "tok-bo"]);
    assert.equal(w.sent[0]!.body, "Olive added a photo to the album.");
    assert.deepEqual(w.inbox.map((i) => i.uid).sort(), ["ana", "bo"]);
    assert.equal(w.inbox[0]!.type, "photo_added");
  });

  test("a burst of uploads in one hour is one notification; the next hour notifies again", async () => {
    const w = world();
    await onPhotoAddedPushed(w.deps(), "c1", "e1", "p1", photoDoc, NOW);
    const second = await onPhotoAddedPushed(w.deps(), "c1", "e1", "p2", photoDoc, new Date(NOW.getTime() + 60_000));
    assert.equal(second.duplicate, true);
    assert.equal(w.sent.length, 1);
    await onPhotoAddedPushed(w.deps(), "c1", "e1", "p3", photoDoc, new Date(NOW.getTime() + 60 * 60_000));
    assert.equal(w.sent.length, 2);
  });

  test("the receipt id is stable and distinct per uploader, event and hour", () => {
    assert.equal(photoAddedId("e1", "owner", NOW), photoAddedId("e1", "owner", new Date(NOW.getTime() + 5 * 60_000)));
    assert.notEqual(photoAddedId("e1", "owner", NOW), photoAddedId("e2", "owner", NOW));
    assert.notEqual(photoAddedId("e1", "owner", NOW), photoAddedId("e1", "ana", NOW));
    assert.match(photoAddedId("e1", "owner", NOW), /^[A-Za-z0-9_-]{1,200}$/);
  });

  test("members with social off get the in-app notice but no push; opted-in members get both", async () => {
    const w = world();
    w.prefs.set("bo", resolvePreferences({ push: { social: false } }));
    const stats = await onPhotoAddedPushed(w.deps(), "c1", "e1", "p1", photoDoc, NOW);
    assert.equal(stats.blocked.category_off, 1);
    assert.deepEqual(w.sent.map((s) => s.tokens).flat(), ["tok-ana"]);
    assert.equal(w.inbox.length, 2);
  });

  test("a photo document of another company than the trigger path is ignored", async () => {
    const w = world();
    await onPhotoAddedPushed(w.deps(), "c1", "e1", "p1", { ...photoDoc, companyId: "c2" }, NOW);
    assert.equal(w.sent.length, 0);
  });

  test("attendees who are no longer active members of the company are dropped at send time", async () => {
    const w = world();
    w.members.set("ana", "c2");
    const stats = await onPhotoAddedPushed(w.deps(), "c1", "e1", "p1", photoDoc, NOW);
    assert.equal(stats.blocked.inactive, 1);
    assert.deepEqual(w.sent.map((s) => s.tokens).flat(), ["tok-bo"]);
  });

  test("an album with no other attendee sends nothing and claims nothing", async () => {
    const w = world();
    w.going.set("e1", ["owner"]);
    await onPhotoAddedPushed(w.deps(), "c1", "e1", "p1", photoDoc, NOW);
    assert.equal(w.sent.length, 0);
    assert.equal(w.receipts.size, 0);
  });

  test("the attendee read is bounded", () => {
    assert.ok(ALBUM_RECIPIENT_LIMIT >= 500 && ALBUM_RECIPIENT_LIMIT <= 5000);
  });
});
