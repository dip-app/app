import type { PushKind } from "./subscription";

/** Chat pushes carry at most this many characters of the message; other kinds carry no user text. */
export const CHAT_PREVIEW_MAX = 80;
const TITLE_MAX = 60;

/**
 * FCM `data` keys (all values are strings). The iOS app routes on `type` + `eventId`; `deepLink` is the
 * equivalent URL form (`dip://events/{eventId}` or `dip://events/{eventId}/chat`).
 */
export interface PushData {
  [key: string]: string;
  type: PushKind;
  companyId: string;
  eventId: string;
  deepLink: string;
}

export interface PushMessage {
  title: string;
  body: string;
  data: PushData;
  /** APNs thread identifier: groups an event's notifications together. */
  threadId: string;
  /** APNs collapse identifier: a newer push of the same key replaces an undelivered older one. */
  collapseId?: string;
}

export function shorten(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1).trimEnd()}…`;
}

function base(kind: PushKind, companyId: string, eventId: string, suffix = ""): PushData {
  return { type: kind, companyId, eventId, deepLink: `dip://events/${eventId}${suffix}` };
}

export function chatPush(companyId: string, eventId: string, eventTitle: string, messageId: string, authorName: string, text: string): PushMessage {
  const author = shorten(authorName, 40) || "Someone";
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: `${author}: ${shorten(text, CHAT_PREVIEW_MAX)}`,
    data: { ...base("chat", companyId, eventId, "/chat"), messageId },
    threadId: `event-${eventId}`,
  };
}

export function changePush(companyId: string, eventId: string, eventTitle: string, revision: number, summary: string): PushMessage {
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: summary,
    data: { ...base("event_changed", companyId, eventId), revision: String(revision) },
    threadId: `event-${eventId}`,
    collapseId: `change-${eventId}`,
  };
}

export type ReminderWindow = "24h" | "1h";

export function reminderPush(companyId: string, eventId: string, eventTitle: string, window: ReminderWindow, leadMs: number): PushMessage {
  const minutes = Math.max(1, Math.round(leadMs / 60_000));
  const when = window === "1h"
    ? (minutes >= 55 ? "in about an hour" : `in ${minutes} minutes`)
    : (minutes >= 22 * 60 ? "tomorrow" : `in about ${Math.round(minutes / 60)} hours`);
  return {
    title: shorten(eventTitle, TITLE_MAX),
    body: `Starts ${when}.`,
    data: { ...base("reminder", companyId, eventId), window },
    threadId: `event-${eventId}`,
    collapseId: `reminder-${eventId}`,
  };
}
