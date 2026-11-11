import type {
  AddEventAttendeeResponse, RecordAttendanceResponse, RemoveEventAttendeeResponse,
} from "../../../generated/models";
import { change } from "../domain/audit";
import { AdminError, stored } from "../domain/errors";
import { isDeactivated } from "../domain/member";
import { paths, SERVER_TIME, increment } from "../domain/ops";
import { parseAddAttendee, parseRecordAttendance, parseRemoveAttendee } from "../domain/requests";
import { authorize, loadEvent, loadMember, once, requireCaller, writeAudit, type Actor } from "./context";
import type { AdminDeps, AdminTransaction, Caller, Doc } from "./ports";

const MAX_CAPACITY = 10000;

/** Same-company member that is allowed to attend: present, not deactivated. Another tenant's user is MEMBER_NOT_FOUND. */
async function loadAttendee(tx: AdminTransaction, actor: Actor, uid: string): Promise<Doc> {
  const member = await loadMember(tx, actor, uid);
  if (isDeactivated(member)) throw new AdminError("not-found", "MEMBER_NOT_FOUND", "Member not found.");
  return member;
}

function notification(actor: Actor, uid: string, type: string, title: string, body: string, eventId: string): Doc {
  return {
    userId: uid, companyId: actor.companyId, type, title: [...title].slice(0, 120).join(""), body: [...body].slice(0, 280).join(""),
    targetType: "event", targetId: eventId, isRead: false, createdAt: SERVER_TIME,
  };
}

export interface RemoveResult { removed: boolean; attendeeCount: number; notified: boolean }

/**
 * Cancels a going RSVP inside the caller's transaction (shared by removeEventAttendeeV1 and member deactivation).
 * The event must not have ended; a cancelled event may still have attendees removed. Attendance fields are kept.
 */
export async function cancelAttendance(tx: AdminTransaction, actor: Actor, eventId: string, uid: string, options: {
  now: Date; notify: boolean; auditId: string; requestId?: string | undefined; reason?: string | undefined; notificationId: string;
}): Promise<RemoveResult> {
  const event = await loadEvent(tx, actor, eventId);
  const rsvp = await tx.get(paths.rsvp(actor.companyId, eventId, uid));
  if (!rsvp || rsvp.status !== "going") return { removed: false, attendeeCount: event.attendeeCount, notified: false };
  stored(rsvp.companyId === actor.companyId && rsvp.eventId === eventId && rsvp.userId === uid && event.attendeeCount > 0, "rsvp");
  if (event.endTime.getTime() <= options.now.getTime()) throw new AdminError("failed-precondition", "EVENT_CLOSED", "This event has ended.");
  const attendeeCount = event.attendeeCount - 1;
  tx.update(paths.rsvp(actor.companyId, eventId, uid), { status: "cancelled", managedBy: actor.uid });
  tx.update(paths.event(actor.companyId, eventId), { attendeeCount });
  if (options.notify) {
    tx.create(paths.notification(uid, options.notificationId),
      notification(actor, uid, "attendee_removed", "Your spot was released", `An organizer removed you from ${event.title}.`, eventId));
  }
  writeAudit(tx, actor, {
    id: options.auditId, action: "attendee.remove", targetType: "attendee", targetId: `${eventId}/${uid}`,
    summary: `Removed a member from ${event.title}`, changes: [change("status", "going", "cancelled"), change("attendeeCount", event.attendeeCount, attendeeCount)],
    reason: options.reason, requestId: options.requestId,
  });
  return { removed: true, attendeeCount, notified: options.notify };
}

/**
 * addEventAttendeeV1: RSVPs an active same-company member as going on behalf of an admin. Capacity is respected
 * unless a reason is given, in which case the event capacity is raised to attendeeCount + 1 (keeping the
 * attendeeCount <= capacity invariant that setRsvpV1 relies on) and the change is audited. The default notification
 * subscription is created by the existing RSVP trigger.
 */
export async function addEventAttendee(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<AddEventAttendeeResponse> {
  const authenticated = requireCaller(caller);
  const req = parseAddAttendee(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "attendee.manage");
    const payload = { eventId: req.eventId, userId: req.userId, notify: req.notify, override: req.capacityOverrideReason ?? null };
    return once(tx, actor, "addEventAttendeeV1", req.requestId, payload, async () => {
      const member = await loadAttendee(tx, actor, req.userId);
      const event = await loadEvent(tx, actor, req.eventId);
      const rsvp = await tx.get(paths.rsvp(actor.companyId, req.eventId, req.userId));
      if (rsvp) stored(rsvp.companyId === actor.companyId && rsvp.eventId === req.eventId && rsvp.userId === req.userId && (rsvp.status === "going" || rsvp.status === "cancelled"), "rsvp");
      const unchanged = (): AddEventAttendeeResponse => ({
        contractVersion: 1, eventId: req.eventId, userId: req.userId, added: false, attendeeCount: event.attendeeCount, capacity: event.capacity,
        capacityOverridden: false, notified: false,
      });
      if (rsvp?.status === "going") return unchanged();
      if (event.status !== "scheduled" || event.endTime.getTime() <= now.getTime()) {
        throw new AdminError("failed-precondition", "EVENT_CLOSED", "Event is closed.");
      }
      let capacity = event.capacity;
      let overridden = false;
      if (event.attendeeCount >= capacity) {
        if (!req.capacityOverrideReason || capacity >= MAX_CAPACITY) throw new AdminError("resource-exhausted", "EVENT_FULL", "Event is full.");
        capacity = event.attendeeCount + 1;
        overridden = true;
      }
      const attendeeCount = event.attendeeCount + 1;
      const eventUpdate: Doc = { attendeeCount };
      if (overridden) { eventUpdate.capacity = capacity; eventUpdate.revision = event.revision + 1; eventUpdate.updatedBy = actor.uid; }
      tx.update(paths.event(actor.companyId, req.eventId), eventUpdate);
      if (rsvp) {
        tx.update(paths.rsvp(actor.companyId, req.eventId, req.userId), { status: "going", eventStartTime: event.startTime, source: "admin", managedBy: actor.uid });
      } else {
        stored(typeof member.displayName === "string" && typeof member.avatarId === "string" && typeof member.department === "string", "member");
        tx.create(paths.rsvp(actor.companyId, req.eventId, req.userId), {
          companyId: actor.companyId, eventId: req.eventId, userId: req.userId, status: "going",
          userName: member.displayName, userAvatarId: member.avatarId, userDepartment: member.department,
          userJobTitle: typeof member.jobTitle === "string" ? member.jobTitle : "",
          eventStartTime: event.startTime, checkedIn: false, checkedInAt: null, createdAt: SERVER_TIME, source: "admin", managedBy: actor.uid,
        });
      }
      if (req.notify) {
        tx.create(paths.notification(req.userId, `admin_${req.requestId}`),
          notification(actor, req.userId, "attendee_added", "You're going!", `An organizer added you to ${event.title}.`, req.eventId));
      }
      const changes = [change("status", rsvp?.status ?? null, "going"), change("attendeeCount", event.attendeeCount, attendeeCount)];
      if (overridden) changes.push(change("capacity", event.capacity, capacity));
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "attendee.add", targetType: "attendee", targetId: `${req.eventId}/${req.userId}`,
        summary: `Added a member to ${event.title}${overridden ? " beyond capacity" : ""}`, changes,
        reason: req.capacityOverrideReason, requestId: req.requestId,
      });
      return {
        contractVersion: 1, eventId: req.eventId, userId: req.userId, added: true, attendeeCount, capacity, capacityOverridden: overridden, notified: req.notify,
      } satisfies AddEventAttendeeResponse;
    }, now);
  })).value;
}

/** removeEventAttendeeV1: cancels a member's going RSVP (before the event ends), decrementing the count. */
export async function removeEventAttendee(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<RemoveEventAttendeeResponse> {
  const authenticated = requireCaller(caller);
  const req = parseRemoveAttendee(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "attendee.manage");
    const payload = { eventId: req.eventId, userId: req.userId, notify: req.notify, reason: req.reason ?? null };
    return once(tx, actor, "removeEventAttendeeV1", req.requestId, payload, async () => {
      await loadMember(tx, actor, req.userId);
      const result = await cancelAttendance(tx, actor, req.eventId, req.userId, {
        now, notify: req.notify, auditId: `${actor.uid}_${req.requestId}`, requestId: req.requestId, reason: req.reason, notificationId: `admin_${req.requestId}`,
      });
      return { contractVersion: 1, eventId: req.eventId, userId: req.userId, ...result } satisfies RemoveEventAttendeeResponse;
    }, now);
  })).value;
}

/**
 * recordAttendanceV1: confirms (or clears) check-in for a going RSVP once the event has started. Awards the event's
 * points exactly once through the deterministic ledger entry `attendance_{eventId}_{uid}`; the state-based command
 * needs no request id and a repeat changes and awards nothing. A no-show cannot be recorded after points were awarded.
 */
export async function recordAttendance(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<RecordAttendanceResponse> {
  const authenticated = requireCaller(caller);
  const req = parseRecordAttendance(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "attendance.record");
    const member = await loadMember(tx, actor, req.userId);
    const event = await loadEvent(tx, actor, req.eventId);
    const rsvp = await tx.get(paths.rsvp(actor.companyId, req.eventId, req.userId));
    if (!rsvp || rsvp.status !== "going") throw new AdminError("failed-precondition", "NOT_GOING", "Only going attendees can be checked in.");
    stored(typeof rsvp.checkedIn === "boolean" && rsvp.userId === req.userId, "rsvp");
    if (event.status === "cancelled" || event.startTime.getTime() > now.getTime()) {
      throw new AdminError("failed-precondition", event.status === "cancelled" ? "EVENT_CLOSED" : "EVENT_NOT_STARTED", "Attendance can be recorded once the event has started.");
    }
    const points = event.pointsValue;
    const ledgerPath = paths.pointTransaction(actor.companyId, `attendance_${req.eventId}_${req.userId}`);
    const ledger = await tx.get(ledgerPath);
    const respond = (pointsAwarded: number, changed: boolean): RecordAttendanceResponse =>
      ({ contractVersion: 1, eventId: req.eventId, userId: req.userId, pointsAwarded, checkedIn: req.checkedIn, changed });
    const auditId = `attendance_${req.eventId}_${req.userId}_${req.checkedIn ? "in" : "out"}_${now.getTime()}`;
    if (!req.checkedIn) {
      if (ledger) throw new AdminError("failed-precondition", "ATTENDANCE_LOCKED", "Points were already awarded for this attendance.");
      if (!rsvp.checkedIn) return respond(0, false);
      tx.update(paths.rsvp(actor.companyId, req.eventId, req.userId), { checkedIn: false, checkedInAt: null, managedBy: actor.uid });
      writeAudit(tx, actor, { id: auditId, action: "attendance.record", targetType: "attendee", targetId: `${req.eventId}/${req.userId}`,
        summary: `Marked a member as not attended at ${event.title}`, changes: [change("checkedIn", true, false)] });
      return respond(0, true);
    }
    const award = !ledger && points > 0;
    if (rsvp.checkedIn && !award) return respond(0, false);
    if (!rsvp.checkedIn) {
      tx.update(paths.rsvp(actor.companyId, req.eventId, req.userId), { checkedIn: true, checkedInAt: SERVER_TIME, managedBy: actor.uid });
    }
    if (award) {
      stored(typeof member.pointsBalance === "number" && Number.isSafeInteger(member.pointsBalance), "member");
      tx.create(ledgerPath, { companyId: actor.companyId, userId: req.userId, amount: points, reason: "attendance", sourceId: req.eventId, createdAt: SERVER_TIME });
      tx.update(paths.user(req.userId), { pointsBalance: increment(points) });
    }
    writeAudit(tx, actor, { id: auditId, action: "attendance.record", targetType: "attendee", targetId: `${req.eventId}/${req.userId}`,
      summary: `Checked in a member at ${event.title}${award ? ` (+${points} points)` : ""}`,
      changes: [change("checkedIn", rsvp.checkedIn, true), ...(award ? [change("pointsBalance", member.pointsBalance, (member.pointsBalance as number) + points)] : [])] });
    return respond(award ? points : 0, !rsvp.checkedIn || award);
  });
}
