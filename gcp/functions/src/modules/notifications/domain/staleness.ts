/** Maximum trigger-event age before a retried delivery is dropped, so a deterministic failure cannot retry for days. */
export const MAX_EVENT_AGE_MS = { chat: 10 * 60_000, eventChange: 60 * 60_000, rsvp: 60 * 60_000, social: 60 * 60_000 } as const;

/**
 * True when the trigger event is older than `maxAgeMs` at `now`. An unparseable or missing time is not stale
 * (the handler runs as before), and a future time has negative age.
 */
export function isStaleEvent(eventTime: string | undefined | null, now: Date, maxAgeMs: number): boolean {
  if (!eventTime) return false;
  const at = Date.parse(eventTime);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at > maxAgeMs;
}
