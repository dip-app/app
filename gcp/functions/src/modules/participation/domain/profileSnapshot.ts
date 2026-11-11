/** Pure rules for keeping the RSVP attendee snapshot (userName, userAvatarId, userDepartment, userJobTitle)
 * in step with the member's profile. Counts, status and attendance fields are never part of a patch. */
export interface ProfileSnapshot {
  userName: string;
  userAvatarId: string;
  userDepartment: string;
  userJobTitle: string;
}

export const SNAPSHOT_KEYS = ["userName", "userAvatarId", "userDepartment", "userJobTitle"] as const;
/** RSVPs of events that ended within this many days (or have not ended) are refreshed. */
export const REFRESH_WINDOW_DAYS = 30;
export const MAX_EVENTS_PER_REFRESH = 500;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Snapshot of a users/{uid} document; null when there is no display name to show. */
export function profileSnapshot(user: Record<string, unknown> | undefined | null): ProfileSnapshot | null {
  if (!user || typeof user.displayName !== "string" || user.displayName === "") return null;
  return {
    userName: user.displayName, userAvatarId: text(user.avatarId),
    userDepartment: text(user.department), userJobTitle: text(user.jobTitle),
  };
}

/** True when a profile edit changes anything the attendee list shows. */
export function snapshotChanged(before: Record<string, unknown> | undefined | null, after: Record<string, unknown> | undefined | null): boolean {
  const a = profileSnapshot(before), b = profileSnapshot(after);
  if (!b) return false;
  if (!a) return true;
  return SNAPSHOT_KEYS.some(key => a[key] !== b[key]);
}

/** Only the fields that differ from the stored RSVP; null when the RSVP is already current. */
export function snapshotPatch(rsvp: Record<string, unknown>, snapshot: ProfileSnapshot): Partial<ProfileSnapshot> | null {
  const patch: Partial<ProfileSnapshot> = {};
  for (const key of SNAPSHOT_KEYS) if (rsvp[key] !== snapshot[key]) patch[key] = snapshot[key];
  return Object.keys(patch).length > 0 ? patch : null;
}

export function refreshCutoff(now: Date): Date {
  return new Date(now.getTime() - REFRESH_WINDOW_DAYS * 86_400_000);
}

/** Events that have not ended, or ended inside the window, newest cap applied by the caller. */
export function inRefreshWindow(endTime: Date | null, now: Date): boolean {
  return endTime !== null && endTime.getTime() >= refreshCutoff(now).getTime();
}
