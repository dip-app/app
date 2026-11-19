import type { NotificationKind } from "./categories";

/** Hard caps on pushes per user, a backstop against runaway triggers (not a product feature). */
export const PUSH_RATE_LIMITS = { perHour: 20, perDay: 100 } as const;

/**
 * Rate classes. High-volume social kinds (chat) get their own counter so a busy conversation can never use up the
 * shared budget; event changes get a separate generous counter; cancellations and reminders are critical and never
 * counted (their volume is bounded by organizer actions and the 15-minute schedule, and silently dropping them is
 * worse than any runaway risk).
 */
export type RateClass = "shared" | "chat" | "changes" | "social" | "exempt";

export const RATE_CLASS_LIMITS: Readonly<Record<Exclude<RateClass, "exempt">, { perHour: number; perDay: number }>> = {
  shared: PUSH_RATE_LIMITS,
  chat: { perHour: 30, perDay: 200 },
  changes: { perHour: 60, perDay: 300 },
  /** Photo comments and new-photo notices: an opt-in category, so a small separate budget that never eats the shared one. */
  social: { perHour: 10, perDay: 40 },
};

const KIND_CLASS: Readonly<Record<NotificationKind, RateClass>> = {
  chat: "chat",
  event_changed: "changes",
  event_cancelled: "exempt",
  reminder: "exempt",
  invite: "shared",
  invite_answered: "shared",
  attendee_added: "shared",
  attendee_removed: "shared",
  challenge_approved: "shared",
  challenge_changes_requested: "shared",
  weekly_theme: "shared",
  event_interest: "shared",
  photo_comment: "social",
  photo_added: "social",
  // Email only (push never offers the category); listed so the map stays total.
  calendar_invite: "shared",
  admin_suggestions: "shared",
  weekly_theme_email: "shared",
  admin_digest: "shared",
};

export const rateClassOf = (kind: NotificationKind): RateClass => KIND_CLASS[kind];

export interface RateCounter { hourKey: string; hourCount: number; dayKey: string; dayCount: number }
/**
 * The shared counter lives in the top-level fields (unchanged shape). Other classes live under `buckets`; documents
 * written before this field existed have no buckets and read as zero.
 */
export interface RateLimitState extends RateCounter { buckets?: Partial<Record<"chat" | "changes" | "social", RateCounter>> }

/** "YYYY-MM-DDTHH" in UTC. */
export const hourBucket = (now: Date): string => now.toISOString().slice(0, 13);
/** "YYYY-MM-DD" in UTC. */
export const dayBucket = (now: Date): string => now.toISOString().slice(0, 10);

function step(counter: RateCounter | null | undefined, now: Date, limits: { perHour: number; perDay: number }): { admitted: boolean; counter: RateCounter } {
  const hourKey = hourBucket(now);
  const dayKey = dayBucket(now);
  const hourCount = counter && counter.hourKey === hourKey ? counter.hourCount : 0;
  const dayCount = counter && counter.dayKey === dayKey ? counter.dayCount : 0;
  if (hourCount >= limits.perHour || dayCount >= limits.perDay) return { admitted: false, counter: { hourKey, hourCount, dayKey, dayCount } };
  return { admitted: true, counter: { hourKey, hourCount: hourCount + 1, dayKey, dayCount: dayCount + 1 } };
}

/**
 * Pure counter step: counts reset when the bucket key changes; a push is admitted only while both counts of its
 * class are below their caps, and only an admitted push increments them. The exempt class is always admitted
 * and leaves the state untouched.
 */
export function nextCounts(state: RateLimitState | null, now: Date, rateClass: RateClass = "shared"): { admitted: boolean; state: RateLimitState } {
  if (rateClass === "exempt") {
    return { admitted: true, state: state ?? { hourKey: hourBucket(now), hourCount: 0, dayKey: dayBucket(now), dayCount: 0 } };
  }
  const buckets = state?.buckets;
  if (rateClass === "shared") {
    const { admitted, counter } = step(state, now, RATE_CLASS_LIMITS.shared);
    return { admitted, state: buckets ? { ...counter, buckets } : counter };
  }
  const { admitted, counter } = step(buckets?.[rateClass], now, RATE_CLASS_LIMITS[rateClass]);
  const base: RateCounter = state ?? { hourKey: hourBucket(now), hourCount: 0, dayKey: dayBucket(now), dayCount: 0 };
  return {
    admitted,
    state: { hourKey: base.hourKey, hourCount: base.hourCount, dayKey: base.dayKey, dayCount: base.dayCount, buckets: { ...buckets, [rateClass]: counter } },
  };
}
