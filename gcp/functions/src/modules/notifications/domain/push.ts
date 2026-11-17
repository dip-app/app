import type { NotificationCategory } from "./categories";
import type { PushKind } from "./subscription";

/** Push kinds: the subscription-driven kinds plus `invite`, which targets one recipient and ignores subscriptions. */
export type PushType =
  | PushKind | "invite" | "attendee_added" | "invite_answered" | "challenge_approved" | "challenge_changes_requested" | "weekly_theme";

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

export function shorten(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1).trimEnd()}…`;
}

function base(kind: PushType, companyId: string, eventId: string, suffix = ""): PushData {
  return { type: kind, companyId, eventId, deepLink: `dip://events/${eventId}${suffix}` };
}

export function chatPush(companyId: string, eventId: string, eventTitle: string, messageId: string, authorName: string, text: string): PushMessage {
  const author = shorten(authorName, 40) || "Someone";
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: `${author}: ${shorten(text, CHAT_PREVIEW_MAX)}`,
    data: { ...base("chat", companyId, eventId, "/chat"), messageId, category: "chat" },
    threadId: `event-${eventId}`,
    category: "chat",
  };
}

/** `endTime` (when known) makes APNs drop the change push once the activity is over. */
export function changePush(companyId: string, eventId: string, eventTitle: string, revision: number, summary: string, endTime?: Date): PushMessage {
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

export function reminderPush(companyId: string, eventId: string, eventTitle: string, window: ReminderWindow, leadMs: number, startTime: Date): PushMessage {
  const minutes = Math.max(1, Math.round(leadMs / 60_000));
  const when = window === "1h"
    ? (minutes >= 55 ? "in about an hour" : `in ${minutes} minutes`)
    : (minutes >= 22 * 60 ? "tomorrow" : `in about ${Math.round(minutes / 60)} hours`);
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: `Starts ${when}.`,
    data: { ...base("reminder", companyId, eventId), window, category: "reminders" },
    threadId: `event-${eventId}`,
    collapseId: `reminder-${eventId}`,
    category: "reminders",
    // A reminder still undelivered when the activity starts is useless: APNs drops it.
    expiresAt: startTime,
  };
}

/** A coworker invited the recipient; the tap opens the event page (`dip://events/{id}`), where the invite is answered. */
export function invitePush(companyId: string, eventId: string, eventTitle: string, inviteId: string, fromName: string): PushMessage {
  const from = shorten(fromName, 40) || "A coworker";
  return {
    title: "New invitation",
    body: `${from} invited you to ${shorten(eventTitle, TITLE_MAX)}.`,
    data: { ...base("invite", companyId, eventId), inviteId, category: "invites" },
    threadId: "invites",
    collapseId: `invite-${inviteId}`,
    category: "invites",
  };
}

/** An organizer added the recipient to an activity. Gated by the `event_updates` switch only, never by the per-event level. */
export function attendeeAddedPush(companyId: string, eventId: string, eventTitle: string): PushMessage {
  return {
    title: "You were added to an activity",
    body: `An organizer added you to ${shorten(eventTitle, TITLE_MAX)}.`,
    data: { ...base("attendee_added", companyId, eventId), category: "event_updates" },
    threadId: `event-${eventId}`,
    collapseId: `attendee-added-${eventId}`,
    category: "event_updates",
  };
}

/** The sender's invitation was accepted (declines are silent). Opens the event page. */
export function inviteAnsweredPush(companyId: string, eventId: string, eventTitle: string, inviteId: string, responderName: string): PushMessage {
  const who = shorten(responderName, 40) || "A coworker";
  return {
    title: "Invitation accepted",
    body: `${who} accepted your invite to ${shorten(eventTitle, TITLE_MAX)}.`,
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
export function challengeReviewedPush(companyId: string, challengeId: string, submissionId: string, approved: boolean, challengeTitle: string): PushMessage {
  return {
    title: approved ? "Your submission was approved" : "Changes requested on your submission",
    body: shorten(challengeTitle, TITLE_MAX) || "Weekly challenge",
    data: { ...challengeBase(approved ? "challenge_approved" : "challenge_changes_requested", companyId, challengeId), submissionId },
    threadId: `challenge-${challengeId}`,
    collapseId: `challenge-review-${submissionId}`,
    category: "challenges",
  };
}

/** A new weekly theme started. `windowEnd` (when known) makes APNs drop the push once the theme is over. */
export function weeklyThemePush(companyId: string, challengeId: string, themeTitle: string, windowEnd?: Date): PushMessage {
  return {
    title: "New weekly challenge",
    body: shorten(themeTitle, TITLE_MAX) || "A new theme just started.",
    data: challengeBase("weekly_theme", companyId, challengeId),
    threadId: `challenge-${challengeId}`,
    collapseId: `weekly-theme-${challengeId}`,
    category: "challenges",
    ...(windowEnd ? { expiresAt: windowEnd } : {}),
  };
}
