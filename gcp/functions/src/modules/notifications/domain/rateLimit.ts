/** Hard caps on pushes per user, a backstop against runaway triggers (not a product feature). */
export const PUSH_RATE_LIMITS = { perHour: 20, perDay: 100 } as const;

export interface RateLimitState { hourKey: string; hourCount: number; dayKey: string; dayCount: number }

/** "YYYY-MM-DDTHH" in UTC. */
export const hourBucket = (now: Date): string => now.toISOString().slice(0, 13);
/** "YYYY-MM-DD" in UTC. */
export const dayBucket = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Pure counter step: counts reset when the bucket key changes; a push is admitted only while both counts are
 * below their caps, and only an admitted push increments them.
 */
export function nextCounts(state: RateLimitState | null, now: Date): { admitted: boolean; state: RateLimitState } {
  const hourKey = hourBucket(now);
  const dayKey = dayBucket(now);
  const hourCount = state && state.hourKey === hourKey ? state.hourCount : 0;
  const dayCount = state && state.dayKey === dayKey ? state.dayCount : 0;
  if (hourCount >= PUSH_RATE_LIMITS.perHour || dayCount >= PUSH_RATE_LIMITS.perDay) {
    return { admitted: false, state: { hourKey, hourCount, dayKey, dayCount } };
  }
  return { admitted: true, state: { hourKey, hourCount: hourCount + 1, dayKey, dayCount: dayCount + 1 } };
}
