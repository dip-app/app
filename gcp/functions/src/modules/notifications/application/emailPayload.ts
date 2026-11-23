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
  venueAddress?: unknown;
  revision?: number;
}

/** Event facts for an email, or null when a required fact (title, start, end) is missing. */
export function eventFacts(input: EventFactsInput): Facts | null {
  const start = asDate(input.startTime);
  const end = asDate(input.endTime);
  if (!start || !end || input.title.trim().length === 0) return null;
  const facts: Facts = { eventId: input.eventId, eventTitle: input.title, startTime: start.toISOString(), endTime: end.toISOString() };
  if (typeof input.venueName === "string" && input.venueName.trim().length > 0) facts.venueName = input.venueName;
  if (typeof input.venueAddress === "string" && input.venueAddress.trim().length > 0) facts.venueAddress = input.venueAddress;
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

const ADDRESS_MAX = 200;

/** One line "address, locality" (either part may be missing), capped at the template's limit; undefined when empty. */
export function addressLine(address: unknown, locality: unknown): string | undefined {
  const parts = [address, locality].filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim());
  return parts.length > 0 ? parts.join(", ").slice(0, ADDRESS_MAX) : undefined;
}

export function venueAddressOf(eventDoc: Doc): string | undefined {
  const venue = eventDoc.venue;
  if (!venue || typeof venue !== "object") return undefined;
  return addressLine((venue as Doc).address, (venue as Doc).locality);
}

/** `{ venueName?, venueAddress? }` of an event document, for push inputs that carry the email's Where row. */
export function venueFieldsOf(eventDoc: Doc): { venueName?: string; venueAddress?: string } {
  const name = venueNameOf(eventDoc);
  const address = venueAddressOf(eventDoc);
  return {
    ...(typeof name === "string" && name.trim().length > 0 ? { venueName: name } : {}),
    ...(address ? { venueAddress: address } : {}),
  };
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

export interface PreviousValues { startTime?: string; endTime?: string; venueName?: string; venueAddress?: string; eventTitle?: string }
export interface ChangeLike { field: string; from: string | null; to: string | null }

/** Old values for the fields whose visible value differs from the new facts; empty when nothing visible changed. */
export function previousOf(changes: readonly ChangeLike[], facts: Facts, after: Doc): PreviousValues {
  const by = new Map(changes.map((c) => [c.field, c]));
  const out: PreviousValues = {};
  const differs = (old: string | null | undefined, now: unknown): old is string => typeof old === "string" && old.trim().length > 0 && old !== now;
  const start = by.get("startTime");
  if (start && differs(start.from, facts.startTime)) out.startTime = start.from!;
  const end = by.get("endTime");
  if (end && differs(end.from, facts.endTime)) out.endTime = end.from!;
  const name = by.get("venue.name");
  if (name && differs(name.from, facts.venueName)) out.venueName = name.from!;
  const addr = by.get("venue.address");
  const loc = by.get("venue.locality");
  if (addr || loc) {
    const venue = (after.venue && typeof after.venue === "object" ? after.venue : {}) as Doc;
    const old = addressLine(addr ? addr.from : venue.address, loc ? loc.from : venue.locality);
    if (differs(old, facts.venueAddress)) out.venueAddress = old;
  }
  const title = by.get("title");
  if (title && differs(title.from, facts.eventTitle)) out.eventTitle = title.from!;
  return out;
}

/**
 * `event_changed` / `event_canceled`; outbox id uses the event revision. Without a cancellation, an update that changes nothing
 * the email can show (time, venue name/address, title) yields no email; push and in-app are unaffected.
 */
export function eventChangeEmail(
  eventId: string, revision: number, cancelled: boolean, changedFields: readonly string[], facts: Facts | null,
  changes?: readonly ChangeLike[], after: Doc = {},
): EmailPayload | undefined {
  if (!facts) return undefined;
  const base = { objectId: eventId, revisionOrWindow: String(revision) };
  if (cancelled) return { template: "event_canceled", variables: facts, ...base };
  const variables: Facts = { ...facts, changedFields: changedFieldsOf(changedFields) };
  if (changes) {
    const previous = previousOf(changes, facts, after);
    if (Object.keys(previous).length === 0) return undefined;
    variables.previous = previous;
  }
  return { template: "event_changed", variables, ...base };
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
