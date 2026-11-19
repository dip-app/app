import type { NotificationCategory } from "./categories";
import type { Locale } from "../../i18n";
import { tPush } from "./i18n";
import type { PushKind } from "./subscription";

/** Push kinds: the subscription-driven kinds plus `invite`, which targets one recipient and ignores subscriptions. */
export type PushType =
  | PushKind | "invite" | "attendee_added" | "attendee_removed" | "invite_answered" | "challenge_approved" | "challenge_changes_requested" | "weekly_theme"
  | "photo_comment" | "photo_added";

/** Chat pushes carry at most this many characters of the message; other kinds carry no user text. */
export const CHAT_PREVIEW_MAX = 80;
const TITLE_MAX = 60;

/**
 * FCM `data` keys (all values are strings). The iOS app routes on `type` + `eventId`; `deepLink` is the
 * equivalent URL form (`dip://events/{eventId}` or `dip://events/{eventId}/chat`).
 */
export interface PushData {
  [key: string]: string;
  type: PushType;
  companyId: string;
  /** Absent on challenge pushes (they link to `dip://challenges/{challengeId}`). */
  eventId?: string;
  deepLink: string;
  /** Same value as `PushMessage.category`. */
  category?: NotificationCategory;
}

export interface PushMessage {
  title: string;
  body: string;
  data: PushData;
  /** APNs thread identifier: groups an event's notifications together. */
  threadId: string;
  /** APNs collapse identifier: a newer push of the same key replaces an undelivered older one. */
  collapseId?: string;
  /** Preference category (domain/categories.ts); also sent as `data.category` so the app can group or filter. */
  category: NotificationCategory;
  /** APNs drops the push if it is still undelivered at this time (`apns-expiration`). */
  expiresAt?: Date;
  /** `aps.category` for actionable notifications; only set once the app registers that UNNotificationCategory. */
  apnsCategory?: string;
}

/** `aps.category` of invite pushes (PUSH-8). The iOS actions are `DIP_INVITE_ACCEPT` and `DIP_INVITE_DECLINE` (docs/design/push-client.md). */
export const INVITE_APNS_CATEGORY = "DIP_INVITE";

export function shorten(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1).trimEnd()}…`;
}

function base(kind: PushType, companyId: string, eventId: string, suffix = ""): PushData {
  return { type: kind, companyId, eventId, deepLink: `dip://events/${eventId}${suffix}` };
}

export function chatPush(companyId: string, eventId: string, eventTitle: string, messageId: string, authorName: string, text: string, locale: Locale = "en"): PushMessage {
  const author = shorten(authorName, 40) || tPush(locale, "push.chat.fallbackAuthor");
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: `${author}: ${shorten(text, CHAT_PREVIEW_MAX)}`,
    data: { ...base("chat", companyId, eventId, "/chat"), messageId, category: "chat" },
    threadId: `event-${eventId}`,
    category: "chat",
  };
}

/** `endTime` (when known) makes APNs drop the change push once the activity is over. */
export function changePush(companyId: string, eventId: string, eventTitle: string, revision: number, summary: string, endTime?: Date, _locale: Locale = "en"): PushMessage {
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: summary,
    data: { ...base("event_changed", companyId, eventId), revision: String(revision), category: "event_updates" },
    threadId: `event-${eventId}`,
    collapseId: `change-${eventId}`,
    category: "event_updates",
    ...(endTime ? { expiresAt: endTime } : {}),
  };
}

export type ReminderWindow = "24h" | "1h";

export function reminderPush(companyId: string, eventId: string, eventTitle: string, window: ReminderWindow, leadMs: number, startTime: Date, locale: Locale = "en"): PushMessage {
  const minutes = Math.max(1, Math.round(leadMs / 60_000));
  const when = window === "1h"
    ? (minutes >= 55 ? tPush(locale, "push.reminder.when.hour") : tPush(locale, "push.reminder.when.minutes", { minutes }))
    : (minutes >= 22 * 60 ? tPush(locale, "push.reminder.when.tomorrow") : tPush(locale, "push.reminder.when.hours", { hours: Math.round(minutes / 60) }));
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: tPush(locale, "push.reminder.body", { when }),
    data: { ...base("reminder", companyId, eventId), window, category: "reminders" },
    threadId: `event-${eventId}`,
    collapseId: `reminder-${eventId}`,
    category: "reminders",
    // A reminder still undelivered when the activity starts is useless: APNs drops it.
    expiresAt: startTime,
  };
}

/** A coworker invited the recipient; the tap opens the event page (`dip://events/{id}`), where the invite is answered. */
export function invitePush(companyId: string, eventId: string, eventTitle: string, inviteId: string, fromName: string, locale: Locale = "en"): PushMessage {
  const from = shorten(fromName, 40) || tPush(locale, "push.invite.fallbackFrom");
  return {
    title: tPush(locale, "push.invite.title"),
    body: tPush(locale, "push.invite.body", { from, title: shorten(eventTitle, TITLE_MAX) }),
    data: { ...base("invite", companyId, eventId), inviteId, category: "invites" },
    threadId: "invites",
    collapseId: `invite-${inviteId}`,
    category: "invites",
    // PUSH-8: the app shows Accept and Decline once it registers this UNNotificationCategory; iOS ignores it until then.
    apnsCategory: INVITE_APNS_CATEGORY,
  };
}

/** An organizer added the recipient to an activity. Gated by the `event_updates` switch only, never by the per-event level. */
export function attendeeAddedPush(companyId: string, eventId: string, eventTitle: string, locale: Locale = "en"): PushMessage {
  return {
    title: tPush(locale, "push.attendeeAdded.title"),
    body: tPush(locale, "push.attendeeAdded.body", { title: shorten(eventTitle, TITLE_MAX) }),
    data: { ...base("attendee_added", companyId, eventId), category: "event_updates" },
    threadId: `event-${eventId}`,
    collapseId: `attendee-added-${eventId}`,
    category: "event_updates",
  };
}

/** An organizer released the recipient's spot (admin removed them). Gated by the `event_updates` switch only. */
export function attendeeRemovedPush(companyId: string, eventId: string, eventTitle: string, locale: Locale = "en"): PushMessage {
  return {
    title: tPush(locale, "push.attendeeRemoved.title"),
    body: tPush(locale, "push.attendeeRemoved.body", { title: shorten(eventTitle, TITLE_MAX) }),
    data: { ...base("attendee_removed", companyId, eventId), category: "event_updates" },
    threadId: `event-${eventId}`,
    collapseId: `attendee-removed-${eventId}`,
    category: "event_updates",
  };
}

/** The sender's invitation was accepted (declines are silent). Opens the event page. */
export function inviteAnsweredPush(companyId: string, eventId: string, eventTitle: string, inviteId: string, responderName: string, locale: Locale = "en"): PushMessage {
  const who = shorten(responderName, 40) || tPush(locale, "push.inviteAnswered.fallbackWho");
  return {
    title: tPush(locale, "push.inviteAnswered.title"),
    body: tPush(locale, "push.inviteAnswered.body", { who, title: shorten(eventTitle, TITLE_MAX) }),
    data: { ...base("invite_answered", companyId, eventId), inviteId, category: "invites" },
    threadId: "invites",
    collapseId: `invite-answered-${inviteId}`,
    category: "invites",
  };
}

function challengeBase(kind: PushType, companyId: string, challengeId: string): PushData {
  return { type: kind, companyId, challengeId, deepLink: `dip://challenges/${challengeId}`, category: "challenges" };
}

/** A reviewer decided on the recipient's submission. The body names the weekly theme, never the reviewer's note. */
export function challengeReviewedPush(companyId: string, challengeId: string, submissionId: string, approved: boolean, challengeTitle: string, locale: Locale = "en"): PushMessage {
  return {
    title: tPush(locale, approved ? "push.challenge.approved.title" : "push.challenge.changesRequested.title"),
    body: shorten(challengeTitle, TITLE_MAX) || tPush(locale, "push.challenge.fallbackTitle"),
    data: { ...challengeBase(approved ? "challenge_approved" : "challenge_changes_requested", companyId, challengeId), submissionId },
    threadId: `challenge-${challengeId}`,
    collapseId: `challenge-review-${submissionId}`,
    category: "challenges",
  };
}

/** A new weekly theme started. `windowEnd` (when known) makes APNs drop the push once the theme is over. */
export function weeklyThemePush(companyId: string, challengeId: string, themeTitle: string, windowEnd?: Date, locale: Locale = "en"): PushMessage {
  return {
    title: tPush(locale, "push.weeklyTheme.title"),
    body: shorten(themeTitle, TITLE_MAX) || tPush(locale, "push.weeklyTheme.fallbackBody"),
    data: challengeBase("weekly_theme", companyId, challengeId),
    threadId: `challenge-${challengeId}`,
    collapseId: `weekly-theme-${challengeId}`,
    category: "challenges",
    ...(windowEnd ? { expiresAt: windowEnd } : {}),
  };
}

/** Someone commented on the recipient's album photo. Carries a short snippet like chat; opens the event page. */
export function photoCommentPush(companyId: string, eventId: string, photoId: string, commentId: string, authorName: string, text: string, locale: Locale = "en"): PushMessage {
  const who = shorten(authorName, 40) || tPush(locale, "push.chat.fallbackAuthor");
  return {
    title: tPush(locale, "push.photoComment.title"),
    body: `${who}: ${shorten(text, CHAT_PREVIEW_MAX)}`,
    data: { ...base("photo_comment", companyId, eventId), photoId, commentId, category: "social" },
    threadId: `photos-${eventId}`,
    collapseId: `photo-comment-${photoId}`,
    category: "social",
  };
}

/** A new photo was added to an activity album the recipient attended. One push per uploader and activity per hour. */
export function photoAddedPush(companyId: string, eventId: string, eventTitle: string, photoId: string, uploaderName: string, locale: Locale = "en"): PushMessage {
  const who = shorten(uploaderName, 40) || tPush(locale, "push.photoAdded.fallbackWho");
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: tPush(locale, "push.photoAdded.body", { who }),
    data: { ...base("photo_added", companyId, eventId), photoId, category: "social" },
    threadId: `photos-${eventId}`,
    collapseId: `photo-added-${eventId}`,
    category: "social",
  };
}
