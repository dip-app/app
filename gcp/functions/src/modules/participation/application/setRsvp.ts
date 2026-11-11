import type { SetRsvpResponse } from "../../../generated/models";
import { ParticipationError } from "../domain/errors";
import { parseRequest, validDocumentId } from "../domain/request";
import type { Document, ParticipationIdentity, ParticipationStore } from "./ports";

function stored(condition: boolean): asserts condition {
  if (!condition) throw new ParticipationError("internal", "INVALID_STORED_DATA", "Invalid stored participation data.");
}
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/** All authorization, event checks and writes participate in the same transaction. */
export async function setRsvp(store: ParticipationStore, identity: ParticipationIdentity | null,
  data: unknown, now: () => Date = () => new Date()): Promise<SetRsvpResponse> {
  if (!identity || !validDocumentId(identity.uid)) throw new ParticipationError("unauthenticated", "UNAUTHENTICATED", "Sign in again.");
  if (!identity.emailVerified) throw new ParticipationError("permission-denied", "EMAIL_NOT_VERIFIED", "Verified email required.");
  if (identity.signInProvider !== "google.com") throw new ParticipationError("permission-denied", "PROVIDER_NOT_ALLOWED", "Google sign-in required.");
  const request = parseRequest(data);
  const { companyId, eventId, status } = request;
  const uid = identity.uid;
  return store.runTransaction(async tx => {
    // Check membership before reading tenant resources, avoiding existence disclosure.
    const member = await tx.getMember(uid);
    if (!member || member.companyId !== companyId || (member.role !== "member" && member.role !== "admin")) {
      throw new ParticipationError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
    }
    const event = await tx.getEvent(companyId, eventId);
    if (!event) throw new ParticipationError("not-found", "EVENT_NOT_FOUND", "Event not found.");
    stored(event.companyId === companyId && date(event.startTime) && integer(event.capacity) &&
      event.capacity >= 1 && event.capacity <= 10000 && integer(event.attendeeCount) &&
      event.attendeeCount >= 0 && event.attendeeCount <= event.capacity &&
      (event.status === "scheduled" || event.status === "cancelled" || event.status === "completed"));
    const rsvp = await tx.getRsvp(companyId, eventId, uid);
    if (rsvp) {
      validateRsvp(rsvp, companyId, eventId, uid);
      stored(rsvp.status !== "going" || (event.attendeeCount as number) > 0);
    }
    const count = event.attendeeCount as number;
    const response = (attendeeCount: number): SetRsvpResponse => ({ contractVersion: 1, eventId, status, attendeeCount });
    // An acknowledgement retry never reapplies a delta, even if the event since closed.
    if (rsvp?.status === status) return response(count);
    const instant = now();
    stored(date(instant));
    if ((event.startTime as Date).getTime() <= instant.getTime() || (status === "going" && event.status !== "scheduled")) {
      throw new ParticipationError("failed-precondition", "EVENT_CLOSED", "Event is closed.");
    }
    if (status === "going" && count >= (event.capacity as number)) {
      throw new ParticipationError("resource-exhausted", "EVENT_FULL", "Event is full.");
    }
    const delta = status === "going" ? 1 : rsvp?.status === "going" ? -1 : 0;
    stored(count + delta >= 0);
    if (rsvp) {
      // Preserve attendance/audit and snapshot-at-first-RSVP fields on cancellation/rejoin.
      tx.updateRsvp(companyId, eventId, uid, { status, eventStartTime: event.startTime });
    } else {
      stored(typeof member.displayName === "string" && typeof member.avatarId === "string" && typeof member.department === "string");
      tx.createRsvp(companyId, eventId, uid, {
        companyId, eventId, userId: uid, status,
        userName: member.displayName, userAvatarId: member.avatarId, userDepartment: member.department,
        // Optional profile field: "" when the member has not set a job title (kept current by onUserProfileUpdated).
        userJobTitle: typeof member.jobTitle === "string" ? member.jobTitle : "",
        eventStartTime: event.startTime, checkedIn: false, checkedInAt: null,
        // Adapter assigns createdAt with serverTimestamp, never caller-supplied data.
      });
    }
    if (delta !== 0) tx.setCount(companyId, eventId, count + delta);
    return response(count + delta);
  });
}

function validateRsvp(rsvp: Document, companyId: string, eventId: string, uid: string): void {
  stored(rsvp.companyId === companyId && rsvp.eventId === eventId && rsvp.userId === uid &&
    (rsvp.status === "going" || rsvp.status === "cancelled") && typeof rsvp.checkedIn === "boolean");
}
