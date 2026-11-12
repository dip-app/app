import { buildEntry, summarizeChanges } from "../domain/changeLog";
import { changePush, chatPush, reminderPush, shorten } from "../domain/push";
import { dueWindow, reminderKey, REMINDER_WINDOWS } from "../domain/reminders";
import { LEVELS_FOR } from "../domain/subscription";
import type {
  ChangeLogStore, ClaimStore, Clock, EventReader, InboxWriter, PushDependencies, SubscriptionStore, UpcomingEvents,
} from "./ports";
import { sendPush, type PushStats } from "./sendPush";

type Doc = Record<string, unknown>;

const emptyStats = (): PushStats => ({ recipients: 0, tokens: 0, sent: 0, failed: 0, removed: 0 });

/**
 * (4a) A chat message was created: push to subscribers with level `all` who are still `going`, excluding
 * the author. Rules already guarantee the author was going and the event open; a duplicate trigger
 * delivery is absorbed by the `chat_{messageId}` claim.
 */
export async function onChatMessageCreated(
  deps: PushDependencies & { events: EventReader; claims: ClaimStore },
  companyId: string, eventId: string, messageId: string, message: Doc,
): Promise<PushStats> {
  const authorId = message.authorId;
  const text = message.text;
  if (typeof authorId !== "string" || typeof text !== "string") return emptyStats();
  const event = await deps.events.get(companyId, eventId);
  if (!event || event.status !== "scheduled") return emptyStats();
  const subscribers = (await deps.recipients.subscribers(companyId, eventId, LEVELS_FOR.chat)).filter((uid) => uid !== authorId);
  if (subscribers.length === 0) return emptyStats();
  // Chat previews go only to current participants (people who could read the chat), even if a former
  // participant kept an `all` subscription.
  const going = await deps.recipients.going(companyId, eventId, subscribers);
  const recipients = subscribers.filter((uid) => going.has(uid));
  if (recipients.length === 0) return emptyStats();
  if (!(await deps.claims.claim(companyId, eventId, `chat_${messageId}`))) return emptyStats();
  const author = typeof message.authorName === "string" ? message.authorName : "";
  return sendPush(deps, recipients, chatPush(companyId, eventId, event.title, messageId, author, text));
}

/**
 * (5 + 4b) An event document was updated: append a changeLog entry for user-visible changes (idempotent by
 * revision + changes) and, only when this call appended it, push the one-line summary to `all`/`changes`
 * subscribers except the editor. Bookkeeping-only writes (changeLog, attendeeCount, revision, updatedBy)
 * produce no entry, so the trigger's own changeLog write ends the loop.
 */
export async function onEventDocumentUpdated(
  deps: PushDependencies & { changeLog: ChangeLogStore; clock: Clock; inbox?: InboxWriter },
  companyId: string, eventId: string, before: Doc, after: Doc, updateTime: Date,
): Promise<{ appended: boolean; push: PushStats }> {
  const entry = buildEntry(before, after, updateTime);
  if (!entry) return { appended: false, push: emptyStats() };
  const appended = await deps.changeLog.append(companyId, eventId, entry);
  if (!appended) return { appended, push: emptyStats() };
  // Edits to an already-cancelled or finished event are logged but not pushed.
  const endTime = after.endTime instanceof Date ? after.endTime : null;
  const ended = endTime !== null && endTime.getTime() <= deps.clock.now().getTime();
  const wasAndIsCancelled = before.status === "cancelled" && after.status === "cancelled";
  if (ended || wasAndIsCancelled) return { appended, push: emptyStats() };
  const recipients = (await deps.recipients.subscribers(companyId, eventId, LEVELS_FOR.event_changed)).filter((uid) => uid !== entry.by);
  const title = typeof after.title === "string" ? after.title : "Activity update";
  const summary = summarizeChanges(entry.changes);
  const push = await sendPush(deps, recipients, changePush(companyId, eventId, title, entry.revision, summary));
  // The in-app center mirrors the push for the same recipients, whether or not they have a device token. Best-effort:
  // a failure here never fails the trigger (the changeLog entry is already stored and a retry would be a duplicate).
  if (deps.inbox && recipients.length > 0) {
    const cancelled = entry.changes.some((change) => change.field === "status" && change.to === "cancelled");
    try {
      await deps.inbox.createMany([...new Set(recipients)].map((uid) => ({
        uid, id: `event_${eventId}_${entry.revision}`, companyId, type: cancelled ? "event_cancelled" : "event_updated",
        title: shorten(title, 60), body: summary, targetType: "event", targetId: eventId,
      })));
    } catch { /* best-effort */ }
  }
  return { appended, push };
}

/**
 * (4c) Scheduled every 15 minutes: send the ~24 h and ~1 h reminders. Each (event, window, startTime) is
 * claimed exactly once with a create-only receipt before sending, so retries and overlapping runs never
 * double-send. Cancelled and already-started events are never selected.
 */
export async function sendDueReminders(
  deps: PushDependencies & { upcoming: UpcomingEvents; claims: ClaimStore; clock: Clock },
): Promise<{ events: number; sent: number; skipped: number }> {
  const now = deps.clock.now();
  const at = (offset: number) => new Date(now.getTime() + offset);
  const candidates = [
    ...await deps.upcoming.scheduledStartingIn(at(REMINDER_WINDOWS["1h"].fromMs), at(REMINDER_WINDOWS["1h"].toMs)),
    ...await deps.upcoming.scheduledStartingIn(at(REMINDER_WINDOWS["24h"].fromMs), at(REMINDER_WINDOWS["24h"].toMs)),
  ];
  let sent = 0;
  let skipped = 0;
  for (const event of candidates) {
    const window = dueWindow(event.startTime, now);
    if (!window || event.status !== "scheduled") { skipped++; continue; }
    if (!(await deps.claims.claim(event.companyId, event.eventId, reminderKey(window, event.startTime)))) { skipped++; continue; }
    const recipients = await deps.recipients.subscribers(event.companyId, event.eventId, LEVELS_FOR.reminder);
    const stats = await sendPush(deps, recipients,
      reminderPush(event.companyId, event.eventId, event.title, window, event.startTime.getTime() - now.getTime()));
    sent += stats.sent;
  }
  return { events: candidates.length, sent, skipped };
}

/**
 * (3) An RSVP row was written by setRsvpV1: reconcile the default subscription from the CURRENT state (so
 * out-of-order or duplicate deliveries converge). Joining creates `changes` if no subscription exists;
 * leaving deletes the subscription unless the member changed it after this RSVP write.
 */
export async function onRsvpWritten(
  store: SubscriptionStore, companyId: string, eventId: string, uid: string, rsvpWriteTime: Date,
) {
  return store.reconcile(companyId, eventId, uid, ({ rsvpStatus, subscriptionLevel, subscriptionUpdatedAt }) => {
    if (rsvpStatus === "going") return subscriptionLevel === null ? "create-default" : "keep";
    if (subscriptionLevel === null) return "keep";
    const changedLater = subscriptionUpdatedAt !== null && subscriptionUpdatedAt.getTime() > rsvpWriteTime.getTime();
    return changedLater ? "keep" : "delete";
  });
}


