import { inRefreshWindow, profileSnapshot, snapshotChanged, snapshotPatch, MAX_EVENTS_PER_REFRESH, type ProfileSnapshot } from "../domain/profileSnapshot";
import { validDocumentId } from "../domain/request";

export interface SnapshotUpdate { companyId: string; eventId: string; uid: string; patch: Partial<ProfileSnapshot> }

export interface ProfileSnapshotStore {
  /** Events of the company that have not ended or ended since `cutoff` (ids and end times only). */
  recentEvents(companyId: string, cutoff: Date, limit: number): Promise<Array<{ eventId: string; endTime: Date | null }>>;
  /** The user's RSVP documents for the given events, only those that exist. */
  rsvpsFor(companyId: string, uid: string, eventIds: string[]): Promise<Array<{ eventId: string; data: Record<string, unknown> }>>;
  /** Applies field patches only (never counts); batched and idempotent. */
  applyUpdates(updates: SnapshotUpdate[]): Promise<void>;
}

export interface RefreshResult { events: number; updated: number; skipped: boolean }

/** users/{uid} updated -> refresh the attendee snapshot on RSVPs of upcoming and recent events of that company. */
export async function refreshRsvpSnapshots(store: ProfileSnapshotStore, uid: string,
  before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, now: Date): Promise<RefreshResult> {
  const snapshot = profileSnapshot(after);
  const companyId = after?.companyId;
  if (!snapshot || !validDocumentId(uid) || !validDocumentId(companyId) || !snapshotChanged(before, after)) {
    return { events: 0, updated: 0, skipped: true };
  }
  const events = (await store.recentEvents(companyId, new Date(now.getTime() - 30 * 86_400_000), MAX_EVENTS_PER_REFRESH))
    .filter(event => validDocumentId(event.eventId) && inRefreshWindow(event.endTime, now));
  const rsvps = await store.rsvpsFor(companyId, uid, events.map(event => event.eventId));
  const updates: SnapshotUpdate[] = [];
  for (const rsvp of rsvps) {
    // Only this user's own, same-company RSVP rows.
    if (rsvp.data.userId !== uid || rsvp.data.companyId !== companyId) continue;
    const patch = snapshotPatch(rsvp.data, snapshot);
    if (patch) updates.push({ companyId, eventId: rsvp.eventId, uid, patch });
  }
  if (updates.length > 0) await store.applyUpdates(updates);
  return { events: events.length, updated: updates.length, skipped: false };
}
