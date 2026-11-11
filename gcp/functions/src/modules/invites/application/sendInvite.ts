import type { SendInviteResponse } from "../../../generated/models";
import { InviteError } from "../domain/errors";
import {
  SEND_LIMIT, SEND_WINDOW_MS, inviteIdFor, inviteNotificationText, nextBudget, notificationIdFor, parseSend, validWireId,
} from "../domain/invitePolicy";
import type { InviteCaller, InviteNotifier, InviteStore } from "./ports";

const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
function stored(condition: boolean): asserts condition {
  if (!condition) throw new InviteError("internal", "INVALID_STORED_DATA", "Invalid stored invitation data.");
}

export function requireCaller(caller: InviteCaller | null): InviteCaller {
  if (!caller || !validWireId(caller.uid)) throw new InviteError("unauthenticated", "UNAUTHENTICATED", "Sign in again.");
  if (!caller.emailVerified) throw new InviteError("permission-denied", "EMAIL_NOT_VERIFIED", "Verified email required.");
  if (caller.signInProvider !== "google.com") throw new InviteError("permission-denied", "PROVIDER_NOT_ALLOWED", "Google sign-in required.");
  return caller;
}

const isMember = (member: Record<string, unknown> | null, companyId: string) =>
  member !== null && member.companyId === companyId && (member.role === "member" || member.role === "admin");

/**
 * sendInviteV1: one same-company member invites another to a scheduled, future, not-full event.
 *
 * Everything runs in one transaction: sender and recipient membership (a recipient of another company is
 * indistinguishable from a missing one), the event, replay detection, the recipient's RSVP, the sender's
 * hourly budget, and the creation of both the invite and the recipient's in-app notification. The invite id
 * is `{eventId}_{toUserId}`, so concurrent or repeated invitations of the same person create exactly one
 * document. Only the very first send is `created: true` and triggers a push (best-effort, after commit).
 */
export async function sendInvite(store: InviteStore, notifier: InviteNotifier | null, callerIn: InviteCaller | null,
  data: unknown, now: () => Date = () => new Date()): Promise<SendInviteResponse> {
  const caller = requireCaller(callerIn);
  const request = parseSend(data);
  const { companyId, eventId, toUserId, message, requestId } = request;
  const uid = caller.uid;
  if (toUserId === uid) throw new InviteError("failed-precondition", "CANNOT_INVITE_SELF", "You can't invite yourself.");
  const inviteId = inviteIdFor(eventId, toUserId);
  let pushInput: Parameters<InviteNotifier["invited"]>[0] | null = null;
  const response = await store.runTransaction(async (tx) => {
    pushInput = null;
    const sender = await tx.getMember(uid);
    if (!isMember(sender, companyId)) throw new InviteError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
    const recipient = await tx.getMember(toUserId);
    if (!isMember(recipient, companyId)) throw new InviteError("not-found", "RECIPIENT_NOT_FOUND", "That coworker could not be found.");
    const event = await tx.getEvent(companyId, eventId);
    if (!event) throw new InviteError("not-found", "EVENT_NOT_FOUND", "Event not found.");
    stored(event.companyId === companyId && date(event.startTime) && typeof event.title === "string" &&
      integer(event.capacity) && integer(event.attendeeCount) && event.attendeeCount >= 0 &&
      (event.status === "scheduled" || event.status === "cancelled"));
    const existing = await tx.getInvite(companyId, inviteId);
    if (existing) {
      stored(existing.companyId === companyId && existing.eventId === eventId && existing.toUserId === toUserId &&
        typeof existing.status === "string");
      if (existing.fromUserId === uid && existing.requestId === requestId) {
        return { contractVersion: 1, inviteId, status: existing.status as "pending", created: false } satisfies SendInviteResponse;
      }
      throw new InviteError("failed-precondition", "ALREADY_INVITED", "That coworker is already invited.");
    }
    if (event.status !== "scheduled") throw new InviteError("failed-precondition", "EVENT_CANCELLED", "This event was cancelled.");
    const instant = now();
    stored(date(instant));
    if ((event.startTime as Date).getTime() <= instant.getTime()) {
      throw new InviteError("failed-precondition", "EVENT_CLOSED", "This event has already started.");
    }
    if ((event.attendeeCount as number) >= (event.capacity as number)) {
      throw new InviteError("failed-precondition", "EVENT_FULL", "This event is full.");
    }
    const rsvp = await tx.getRsvp(companyId, eventId, toUserId);
    if (rsvp && rsvp.status === "going") throw new InviteError("failed-precondition", "ALREADY_GOING", "That coworker is already going.");
    const budgetKey = `send_${uid}`;
    const budget = nextBudget(await tx.getBudget(budgetKey), instant.getTime(), SEND_LIMIT, SEND_WINDOW_MS);
    if (!budget) throw new InviteError("resource-exhausted", "RATE_LIMITED", "You've sent a lot of invitations. Try again later.");
    stored(typeof sender?.displayName === "string" && typeof recipient?.displayName === "string");
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    tx.setBudget(budgetKey, budget, new Date(budget.windowStart + SEND_WINDOW_MS));
    tx.createInvite(companyId, inviteId, {
      companyId, eventId, eventTitle: event.title, eventStartTime: event.startTime,
      fromUserId: uid, fromUserName: sender.displayName, fromUserAvatarId: text(sender.avatarId),
      toUserId, toUserName: recipient.displayName, toUserAvatarId: text(recipient.avatarId),
      message, status: "pending", requestId,
    });
    const notice = inviteNotificationText(sender.displayName as string, event.title as string);
    tx.createNotification(toUserId, notificationIdFor(inviteId), {
      userId: toUserId, companyId, type: "invite", title: notice.title, body: notice.body,
      targetType: "invite", targetId: inviteId, isRead: false,
    });
    pushInput = { companyId, eventId, eventTitle: event.title as string, inviteId, toUserId, fromName: sender.displayName as string };
    return { contractVersion: 1, inviteId, status: "pending", created: true } satisfies SendInviteResponse;
  });
  if (response.created && pushInput && notifier) {
    // A failed push never undoes or fails the committed invitation; the in-app notification already exists.
    await notifier.invited(pushInput).catch(() => undefined);
  }
  return response;
}
