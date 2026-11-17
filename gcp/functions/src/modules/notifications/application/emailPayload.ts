import type { NotificationRequest } from "./router";

/**
 * Builders for `NotificationRequest.email` (docs/contracts/email.md, "Router integration"). Variables here mirror the
 * email templates' strict allow-lists (`modules/email/domain/templates/types.ts`): event facts, a first name, a
 * changed-field list, a window or an outcome. No address, token, chat text or comment text ever goes in. This file
 * stays free of imports from `modules/email` so there is no runtime cycle; the email channel validates the payload
 * and skips anything that does not match, so a builder returning `undefined` (missing facts) just means "no email".
 */
export type EmailPayload = NonNullable<NotificationRequest["email"]>;

type Doc = Record<string, unknown>;
type Facts = Record<string, unknown>;

const asDate = (value: unknown): Date | null => (value instanceof Date && Number.isFinite(value.getTime()) ? value : null);

export interface EventFactsInput {
  eventId: string;
  title: string;
  startTime: unknown;
  endTime: unknown;
  venueName?: unknown;
  revision?: number;
}

/** Event facts for an email, or null when a required fact (title, start, end) is missing. */
export function eventFacts(input: EventFactsInput): Facts | null {
  const start = asDate(input.startTime);
  const end = asDate(input.endTime);
  if (!start || !end || input.title.trim().length === 0) return null;
  const facts: Facts = { eventId: input.eventId, eventTitle: input.title, startTime: start.toISOString(), endTime: end.toISOString() };
  if (typeof input.venueName === "string" && input.venueName.trim().length > 0) facts.venueName = input.venueName;
  if (input.revision !== undefined) facts.revision = input.revision;
  return facts;
}

/** First name for greetings; null when the display name is empty. */
export function firstNameOf(displayName: string): string | null {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first : null;
}

export function venueNameOf(eventDoc: Doc): unknown {
  const venue = eventDoc.venue;
  return venue && typeof venue === "object" ? (venue as Doc).name : undefined;
}

export type ChangedField = "time" | "venue" | "title" | "details";

/** Maps tracked change-log fields to the template's coarse labels (anything else counts as details). */
export function changedFieldsOf(fields: readonly string[]): ChangedField[] {
  const out = new Set<ChangedField>();
  for (const field of fields) {
    if (field === "startTime" || field === "endTime") out.add("time");
    else if (field.startsWith("venue.")) out.add("venue");
    else if (field === "title") out.add("title");
    else out.add("details");
  }
  return [...out];
}

/** `event_changed` / `event_canceled`; outbox id uses the event revision. */
export function eventChangeEmail(eventId: string, revision: number, cancelled: boolean, changedFields: readonly string[], facts: Facts | null): EmailPayload | undefined {
  if (!facts) return undefined;
  const base = { objectId: eventId, revisionOrWindow: String(revision) };
  if (cancelled) return { template: "event_canceled", variables: facts, ...base };
  return { template: "event_changed", variables: { ...facts, changedFields: changedFieldsOf(changedFields) }, ...base };
}

/** `event_reminder`; the email is useless after the event starts, so `notAfter` is the start time. */
export function reminderEmail(eventId: string, window: "24h" | "1h", startTime: Date, facts: Facts | null): EmailPayload | undefined {
  if (!facts) return undefined;
  return { template: "event_reminder", variables: { ...facts, window }, objectId: eventId, revisionOrWindow: `${window}_${startTime.getTime()}`, notAfter: startTime };
}

export function attendeeAddedEmail(eventId: string, notificationId: string, facts: Facts | null): EmailPayload | undefined {
  return facts ? { template: "attendee_added", variables: facts, objectId: eventId, revisionOrWindow: notificationId } : undefined;
}

export function inviteReceivedEmail(inviteId: string, inviterName: string, facts: Facts | null): EmailPayload | undefined {
  const name = firstNameOf(inviterName);
  return facts && name ? { template: "invite_received", variables: { ...facts, inviterFirstName: name }, objectId: inviteId, revisionOrWindow: "invite" } : undefined;
}

/** Only acceptances notify the sender today, so `answer` is always "accepted". */
export function inviteAnsweredEmail(inviteId: string, responderName: string, facts: Facts | null): EmailPayload | undefined {
  const name = firstNameOf(responderName);
  return facts && name ? { template: "invite_answered", variables: { ...facts, inviteeFirstName: name, answer: "accepted" }, objectId: inviteId, revisionOrWindow: "accepted" } : undefined;
}

export function challengeReviewedEmail(challengeId: string, title: string, approved: boolean, notificationId: string): EmailPayload | undefined {
  if (title.trim().length === 0) return undefined;
  return {
    template: "challenge_reviewed", variables: { challengeId, challengeTitle: title, outcome: approved ? "approved" : "changes_requested" },
    objectId: challengeId, revisionOrWindow: notificationId,
  };
}
