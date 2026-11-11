import type { RespondToInviteResponse } from "../../../generated/models";
import { applyRsvp } from "../../participation/application/setRsvp";
import { InviteError } from "../domain/errors";
import { parseRespond } from "../domain/invitePolicy";
import type { InviteCaller, InviteStore } from "./ports";
import { requireCaller } from "./sendInvite";

/**
 * respondToInviteV1: the recipient accepts or declines a pending invitation.
 *
 * Accepting runs `applyRsvp`, the exact transaction body of `setRsvpV1` (event open, capacity, RSVP row, attendee
 * count), then marks the invite accepted, all in one transaction: if the event is full or closed the whole
 * transaction rolls back and the invite stays pending. Repeating the same response is a no-op that returns the
 * stored state; the opposite response after the first fails `INVITE_ALREADY_RESPONDED`. A caller who is not the
 * recipient (including the sender) gets `INVITE_NOT_FOUND`, never a hint that the invite exists.
 */
export async function respondToInvite(store: InviteStore, callerIn: InviteCaller | null, data: unknown,
  now: () => Date = () => new Date()): Promise<RespondToInviteResponse> {
  const caller = requireCaller(callerIn);
  const { companyId, inviteId, response } = parseRespond(data);
  const uid = caller.uid;
  return store.runTransaction(async (tx) => {
    const member = await tx.getMember(uid);
    if (!member || member.companyId !== companyId || (member.role !== "member" && member.role !== "admin")) {
      throw new InviteError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
    }
    const invite = await tx.getInvite(companyId, inviteId);
    if (!invite || invite.companyId !== companyId || invite.toUserId !== uid) {
      throw new InviteError("not-found", "INVITE_NOT_FOUND", "Invitation not found.");
    }
    const status = invite.status;
    const eventId = invite.eventId;
    if (typeof eventId !== "string" || (status !== "pending" && status !== "accepted" && status !== "declined")) {
      throw new InviteError("internal", "INVALID_STORED_DATA", "Invalid stored invitation data.");
    }
    if (status !== "pending") {
      if (status !== response) throw new InviteError("failed-precondition", "INVITE_ALREADY_RESPONDED", "You already responded to this invitation.");
      if (status === "declined") return { contractVersion: 1, inviteId, status: "declined" } satisfies RespondToInviteResponse;
      // Replay of an accepted invite: report the current state without re-joining someone who has since left.
      const rsvp = await tx.getRsvp(companyId, eventId, uid);
      const event = await tx.getEvent(companyId, eventId);
      const count = event && typeof event.attendeeCount === "number" ? event.attendeeCount : undefined;
      return {
        contractVersion: 1, inviteId, status: "accepted",
        ...(rsvp?.status === "going" ? { rsvpStatus: "going" as const } : {}),
        ...(count !== undefined ? { attendeeCount: count } : {}),
      } satisfies RespondToInviteResponse;
    }
    if (response === "declined") {
      tx.markResponded(companyId, inviteId, "declined");
      return { contractVersion: 1, inviteId, status: "declined" } satisfies RespondToInviteResponse;
    }
    // ParticipationError (EVENT_FULL, EVENT_CLOSED, EVENT_NOT_FOUND) aborts everything, leaving the invite pending.
    const joined = await applyRsvp(tx, member, companyId, eventId, uid, "going", now);
    tx.markResponded(companyId, inviteId, "accepted");
    return { contractVersion: 1, inviteId, status: "accepted", rsvpStatus: "going", attendeeCount: joined.attendeeCount } satisfies RespondToInviteResponse;
  });
}
