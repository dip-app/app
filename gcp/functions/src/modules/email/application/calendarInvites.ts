import { diffEvent } from "../../notifications/domain/changeLog";
import { emailChannel, type ChannelDeps } from "./enqueueEmail";
import type { InviteEvent, InviteEventReader, InviteIntent, InviteSequenceStore } from "./ports";
import type { TemplateVariables } from "../domain/templates/types";

/**
 * Calendar invite triggers (CAL-8, docs/design/stretch/calendar.md "Emailed invites"). Three inputs, all email only:
 * a member joins an event (METHOD:REQUEST), an event's time, place or title changes (REQUEST again, same UID, higher
 * SEQUENCE) and a member leaves or the event is canceled (METHOD:CANCEL). Every email goes through `emailChannel`, so the
 * global switch, the company's `emailSettings` and the member's `calendar_invites` switch apply; the outbox id is
 * deterministic per trigger write, so a redelivered trigger cannot enqueue twice.
 */

export interface CalendarInviteDeps extends ChannelDeps {
  sequences: InviteSequenceStore;
  events: InviteEventReader;
}

/** Going members handled per event update (a bound on one trigger run; larger events are truncated). */
export const MAX_GOING_FANOUT = 500;
const FANOUT_PARALLELISM = 10;
const RETAIN_AFTER_END_MS = 30 * 24 * 60 * 60 * 1000;

export type InviteOutcome = "enqueued" | "not_applicable" | "no_event" | "event_over" | "duplicate" | "blocked";

type Doc = Record<string, unknown>;

const asDate = (value: unknown): Date | null => (value instanceof Date && Number.isFinite(value.getTime()) ? value : null);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value : undefined);

/** Plain event document (Dates, not Firestore Timestamps) to the invite's event facts; null without title, start or end. */
export function inviteEventFromDoc(eventId: string, doc: Doc): InviteEvent | null {
  const start = asDate(doc.startTime);
  const end = asDate(doc.endTime);
  const title = text(doc.title);
  if (!start || !end || !title) return null;
  const venue = doc.venue && typeof doc.venue === "object" ? doc.venue as Doc : {};
  const parts = [text(venue.address), text(venue.locality)].filter((p): p is string => p !== undefined).map((p) => p.trim());
  const revision = typeof doc.revision === "number" && Number.isInteger(doc.revision) && doc.revision >= 0 ? doc.revision : 0;
  const venueName = text(venue.name);
  return {
    eventId, title, status: typeof doc.status === "string" ? doc.status : "scheduled", startTime: start, endTime: end, revision,
    ...(venueName ? { venueName } : {}),
    ...(parts.length > 0 ? { venueAddress: parts.join(", ").slice(0, 200) } : {}),
  };
}

function factsOf(event: InviteEvent) {
  return {
    eventId: event.eventId, eventTitle: event.title, startTime: event.startTime.toISOString(), endTime: event.endTime.toISOString(),
    ...(event.venueName ? { venueName: event.venueName } : {}),
    ...(event.venueAddress ? { venueAddress: event.venueAddress } : {}),
    revision: event.revision,
  };
}

async function enqueueFor(
  deps: CalendarInviteDeps, companyId: string, event: InviteEvent, uid: string, intent: InviteIntent, key: string,
  reason: "joined" | "updated" | "left" | "canceled",
): Promise<InviteOutcome> {
  const now = deps.clock.now();
  const sequence = await deps.sequences.assign(companyId, event.eventId, uid, intent, key,
    new Date(event.endTime.getTime() + RETAIN_AFTER_END_MS), now);
  if (sequence === null) return "not_applicable";
  const cancel = intent === "cancel";
  const result = await emailChannel(deps, {
    template: cancel ? "calendar_cancel" : "calendar_invite",
    variables: { ...factsOf(event), sequence, reason } as TemplateVariables["calendar_invite"] | TemplateVariables["calendar_cancel"],
    uid, companyId, objectId: event.eventId,
    // `r` for REQUEST, `c` for CANCEL: both share the trigger key space without colliding.
    revisionOrWindow: `${cancel ? "c" : "r"}${key}`,
    // Useless once the event is over; the sender also re-checks.
    notAfter: event.endTime,
    eventLevel: null, pushWillDeliver: false,
  });
  if (result.enqueue === null) return "blocked";
  return result.enqueue.enqueued ? "enqueued" : result.enqueue.reason === "duplicate" ? "duplicate" : "blocked";
}

/**
 * RSVP document written (`rsvps/{uid}`; `before`/`after` are the status strings, null when the document is absent).
 * Becoming `going` sends the invite; leaving `going` (including a deleted RSVP) sends the cancellation.
 */
export async function onRsvpForInvite(
  deps: CalendarInviteDeps,
  input: { companyId: string; eventId: string; uid: string; before: string | null; after: string | null; writeTime: Date },
): Promise<InviteOutcome> {
  const wasGoing = input.before === "going";
  const isGoing = input.after === "going";
  if (wasGoing === isGoing) return "not_applicable";
  const event = await deps.events.get(input.companyId, input.eventId);
  if (event === null) return "no_event";
  if (event.endTime.getTime() <= deps.clock.now().getTime()) return "event_over";
  const key = String(input.writeTime.getTime());
  if (isGoing) {
    if (event.status !== "scheduled") return "event_over";
    return enqueueFor(deps, input.companyId, event, input.uid, "join", key, "joined");
  }
  return enqueueFor(deps, input.companyId, event, input.uid, "cancel", key, "left");
}

/** Visible fields that change an existing calendar entry (the same set the changelog tracks for the email). */
const CALENDAR_FIELDS = new Set(["startTime", "endTime", "title", "venue.name", "venue.address", "venue.locality"]);

export interface EventUpdateStats { recipients: number; enqueued: number; skipped: number }

/**
 * Event document updated. A time, place or title change re-sends the REQUEST to going members who hold the entry
 * (same UID, higher SEQUENCE); a change to `cancelled` sends the CANCEL to the same members. Anything else is ignored.
 */
export async function onEventUpdatedForInvites(
  deps: CalendarInviteDeps,
  input: { companyId: string; eventId: string; before: Doc; after: Doc; updateTime: Date },
): Promise<EventUpdateStats> {
  const none: EventUpdateStats = { recipients: 0, enqueued: 0, skipped: 0 };
  const changes = diffEvent(input.before, input.after);
  const cancelled = input.before.status !== "cancelled" && input.after.status === "cancelled";
  const relevant = cancelled || changes.some((c) => CALENDAR_FIELDS.has(c.field));
  if (!relevant) return none;
  const event = inviteEventFromDoc(input.eventId, input.after);
  if (event === null || event.endTime.getTime() <= deps.clock.now().getTime()) return none;
  if (!cancelled && event.status !== "scheduled") return none;
  const uids = await deps.events.goingUids(input.companyId, input.eventId, MAX_GOING_FANOUT);
  const stats: EventUpdateStats = { recipients: uids.length, enqueued: 0, skipped: 0 };
  const key = String(input.updateTime.getTime());
  for (let i = 0; i < uids.length; i += FANOUT_PARALLELISM) {
    const outcomes = await Promise.all(uids.slice(i, i + FANOUT_PARALLELISM).map((uid) =>
      enqueueFor(deps, input.companyId, event, uid, cancelled ? "cancel" : "update", key, cancelled ? "canceled" : "updated")));
    for (const outcome of outcomes) outcome === "enqueued" ? stats.enqueued++ : stats.skipped++;
  }
  return stats;
}
