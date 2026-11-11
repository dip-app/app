import type { CreateEventResponse, UpdateEventResponse } from "../../../generated/models";
import { draftHash, parseCreateEventRequest, parseUpdateEventRequest } from "../domain/eventDraft";
import { OrganizerError } from "../domain/errors";
import type { OrganizerStore, OrganizerTransaction } from "./ports";

/** Trusted caller identity, derived only from the verified Auth token. */
export interface Caller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}

export interface Clock { now(): Date }
export interface IdGenerator { eventId(): string }

/**
 * Authorization comes from the server-owned membership document, never from the payload: the caller must
 * be a verified Google user with role "admin", and the supplied companyId must equal their own company.
 */
async function requireOrganizer(tx: OrganizerTransaction, caller: Caller, companyId: string) {
  const membership = await tx.getMembership(caller.uid);
  if (!membership || (membership.role !== "admin" && membership.role !== "organizer")) {
    throw new OrganizerError("permission-denied", "NOT_ORGANIZER", "Only organizers can manage events.");
  }
  if (membership.companyId !== companyId) {
    throw new OrganizerError("permission-denied", "COMPANY_MISMATCH", "You can only manage your own company's events.");
  }
  return membership;
}

function requireCaller(caller: Caller | null): Caller {
  if (!caller) throw new OrganizerError("unauthenticated", "UNAUTHENTICATED", "Sign in to continue.");
  if (!caller.emailVerified || caller.signInProvider !== "google.com") {
    throw new OrganizerError("permission-denied", "NOT_ORGANIZER", "Only organizers can manage events.");
  }
  return caller;
}

async function requireKnownTags(tx: OrganizerTransaction, tagIds: readonly string[]) {
  const missing = await tx.missingTagIds(tagIds);
  if (missing.length > 0) throw new OrganizerError("invalid-argument", "TAG_NOT_FOUND", "Choose tags from the list.", ["tagIds"]);
}

/** createEventV1: requestId makes retries return the same event; the same key with another payload fails. */
export async function createEvent(
  store: OrganizerStore,
  caller: Caller | null,
  data: unknown,
  ids: IdGenerator,
  clock: Clock = { now: () => new Date() },
): Promise<CreateEventResponse> {
  const authenticated = requireCaller(caller);
  const request = parseCreateEventRequest(data);
  const hash = draftHash(request.event);
  return store.runTransaction(async (tx) => {
    await requireOrganizer(tx, authenticated, request.companyId);
    const receipt = await tx.getReceipt(request.companyId, authenticated.uid, request.requestId);
    if (receipt) {
      if (receipt.hash !== hash) {
        throw new OrganizerError("invalid-argument", "REQUEST_REUSED", "This request ID was already used with different details.", ["requestId"]);
      }
      return { contractVersion: 1, eventId: receipt.eventId, revision: receipt.revision };
    }
    if (request.event.startTime.getTime() <= clock.now().getTime()) {
      throw new OrganizerError("invalid-argument", "VALIDATION_FAILED", "New events must start in the future.", ["startTime"]);
    }
    await requireKnownTags(tx, request.event.tagIds);
    const eventId = ids.eventId();
    tx.createEvent(request.companyId, eventId, authenticated.uid, request.event);
    tx.createReceipt(request.companyId, authenticated.uid, request.requestId, { hash, eventId, revision: 1 });
    return { contractVersion: 1, eventId, revision: 1 };
  });
}

/**
 * updateEventV1: full-draft replacement guarded by expectedRevision. Capacity may not fall below the
 * active attendeeCount. Start-time changes are refused while anyone is going, because the denormalized
 * RSVP eventStartTime snapshots cannot be updated in one transaction (up to 10,000 RSVPs). V1 decision
 * (issue #14): any RSVP record, including cancelled ones, locks both the start and end time; every other
 * validated field and the cancelled status stay editable.
 */
export async function updateEvent(
  store: OrganizerStore,
  caller: Caller | null,
  data: unknown,
  clock: Clock = { now: () => new Date() },
): Promise<UpdateEventResponse> {
  const authenticated = requireCaller(caller);
  const request = parseUpdateEventRequest(data);
  return store.runTransaction(async (tx) => {
    const membership = await requireOrganizer(tx, authenticated, request.companyId);
    const current = await tx.getEvent(request.companyId, request.eventId);
    if (!current) throw new OrganizerError("not-found", "EVENT_NOT_FOUND", "That event doesn't exist.");
    if (current.revision !== request.expectedRevision) {
      throw new OrganizerError("aborted", "REVISION_CONFLICT", "Someone else changed this event. Reload it and try again.");
    }
    if (request.event.capacity < current.attendeeCount) {
      throw new OrganizerError("failed-precondition", "CAPACITY_BELOW_ATTENDEES",
        "Capacity can't be lower than the number of people already going.", ["capacity"]);
    }
    const timesChanged = request.event.startTime.getTime() !== current.startTime.getTime()
      || request.event.endTime.getTime() !== current.endTime.getTime();
    if (timesChanged && await tx.hasAnyRsvp(request.companyId, request.eventId)) {
      throw new OrganizerError("failed-precondition", "TIME_CHANGE_BLOCKED",
        "The times can't be changed once anyone has responded. Cancel and recreate the event instead.", ["startTime", "endTime"]);
    }
    if (request.status !== current.status) await checkStatusChange(tx, request, current.status, membership.role, clock.now());
    await requireKnownTags(tx, request.event.tagIds);
    const nextRevision = current.revision + 1;
    tx.updateEvent(request.companyId, request.eventId, request.event, request.status, nextRevision, authenticated.uid);
    return { contractVersion: 1, eventId: request.eventId, revision: nextRevision };
  });
}

/**
 * Status transitions. Only a scheduled event that has ended can be marked completed (a cancelled one cannot).
 * Reopening or cancelling a completed event is free until the album has photos; after that only an admin with a
 * `statusReason` may do it, because members' photos and attendance hang off the completed event.
 */
async function checkStatusChange(tx: OrganizerTransaction, request: { companyId: string; eventId: string; status: string; statusReason?: string; event: { endTime: Date } },
  from: string, role: string, now: Date) {
  if (request.status === "completed") {
    if (from !== "scheduled") throw new OrganizerError("failed-precondition", "STATUS_TRANSITION_BLOCKED", "Only a scheduled event can be marked completed.", ["status"]);
    if (request.event.endTime.getTime() > now.getTime()) throw new OrganizerError("failed-precondition", "EVENT_NOT_ENDED", "The event hasn't ended yet.", ["status"]);
    return;
  }
  if (from === "completed" && await tx.hasAnyPhoto(request.companyId, request.eventId)) {
    if (role !== "admin" || !request.statusReason) {
      throw new OrganizerError("failed-precondition", "STATUS_TRANSITION_BLOCKED",
        "A completed event with photos can only be reopened by an admin with a reason.", ["status", "statusReason"]);
    }
  }
}
