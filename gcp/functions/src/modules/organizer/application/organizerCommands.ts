import type { CreateEventResponse, UpdateEventResponse } from "../../../generated/models";
import { isDeactivated } from "../../admin/domain/member";
import { isDynamicCoverURL } from "../../covers/domain/dynamicCovers";
import { parseCoverKey, type CoverKeySource } from "../../covers/domain/coverCatalog";
import { draftHash, parseCreateEventRequest, parseUpdateEventRequest } from "../domain/eventDraft";
import { OrganizerError } from "../domain/errors";
import type { OrganizerStore, OrganizerTransaction, StoredEvent, VenueLocationStamp } from "./ports";
import type { ParsedDraft } from "../domain/eventDraft";

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
  if (isDeactivated(membership)) throw new OrganizerError("permission-denied", "ACCOUNT_DEACTIVATED", "This account is deactivated.");
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

/**
 * A dynamic (live Pixabay) cover key must exist as an active stored cover. Without a key source it is rejected. The
 * generated library and legacy covers were already validated by the parser.
 */
async function requireStoredDynamicCover(url: string, coverKeys: CoverKeySource | undefined) {
  if (!isDynamicCoverURL(url)) return;
  const key = parseCoverKey(url);
  if (key === null || !coverKeys || !(await coverKeys.has(key))) {
    throw new OrganizerError("invalid-argument", "VALIDATION_FAILED", "Choose a cover from the library.", ["coverImageURL"]);
  }
}

/**
 * `venueLocationAt` is server-owned: it records when the venue coordinates were resolved from a Google place ID, which is what the
 * daily refresh job uses to keep them inside the 30-day caching limit. Stamped on create or when the place ID or the coordinates
 * change, kept when they did not, removed when the place ID is gone. Existing 0/0 semantics are untouched.
 */
export function venueLocationStamp(venue: ParsedDraft["venue"], current: Pick<StoredEvent, "venue" | "venueLocationAt"> | null, now: Date): VenueLocationStamp {
  if (!venue.placeId) return { kind: "clear" };
  const same = current?.venue !== undefined && current.venueLocationAt !== undefined && current.venue.placeId === venue.placeId
    && current.venue.latitude === venue.latitude && current.venue.longitude === venue.longitude;
  return same ? { kind: "keep" } : { kind: "set", at: now };
}

/** createEventV1: requestId makes retries return the same event; the same key with another payload fails. */
export async function createEvent(
  store: OrganizerStore,
  caller: Caller | null,
  data: unknown,
  ids: IdGenerator,
  clock: Clock = { now: () => new Date() },
  coverKeys?: CoverKeySource,
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
    await requireStoredDynamicCover(request.event.coverImageURL, coverKeys);
    const eventId = ids.eventId();
    tx.createEvent(request.companyId, eventId, authenticated.uid, request.event, venueLocationStamp(request.event.venue, null, clock.now()));
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
  coverKeys?: CoverKeySource,
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
    // Keeping the event's current cover needs no lookup (a cover later removed from the library stays on events that already use it).
    if (request.event.coverImageURL !== current.coverImageURL) await requireStoredDynamicCover(request.event.coverImageURL, coverKeys);
    const nextRevision = current.revision + 1;
    tx.updateEvent(request.companyId, request.eventId, request.event, request.status, nextRevision, authenticated.uid, venueLocationStamp(request.event.venue, current, clock.now()));
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
