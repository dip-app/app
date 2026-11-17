import type { RateClass } from "../domain/rateLimit";

/**
 * Delivery markers (`notificationReceipts/{id}`), server-only. Two-phase: `claim` writes `state: "processing"` with a
 * lease, `complete` marks it `done`. A claim succeeds when there is no receipt, or the receipt is `processing` and its
 * lease has expired (the previous attempt crashed). Receipts without a `state` (written before two-phase) count as done.
 */
export interface DeliveryReceipts {
  /** True for the first caller of an id, or for a caller after an expired lease; false when done or leased. */
  claim(notificationId: string): Promise<boolean>;
  /** Marks a claimed id as delivered (idempotent). */
  complete(notificationId: string): Promise<void>;
  /** Cheap read: true only when the id is fully delivered (not merely leased). Never claims. */
  isDone(notificationId: string): Promise<boolean>;
}

/** Per-user push volume cap (`pushRateLimits/{uid}`), server-only. */
export interface PushRateLimiter {
  /** Returns the uids allowed to receive one more push of this class now, and counts that push for them. */
  admit(uids: readonly string[], now: Date, rateClass?: RateClass): Promise<Set<string>>;
}

/** Resolves which users are still active members of a company at send time. */
export interface MembershipReader {
  /** The subset of `uids` whose `users/{uid}` document belongs to `companyId` and is not deactivated. */
  activeIn(companyId: string, uids: readonly string[]): Promise<Set<string>>;
}

/** Minimal structured logger; implementations must never receive tokens, emails, names or message text. */
export interface DeliveryLog {
  info(message: string, fields: Record<string, unknown>): void;
  warn(message: string, fields: Record<string, unknown>): void;
  error(message: string, fields: Record<string, unknown>): void;
}

/** A weekly theme (`companies/{c}/challenges/{id}`, `type: "weekly"`) as the scheduler sees it. */
export interface WeeklyTheme { companyId: string; challengeId: string; title: string; startDate: Date; endDate: Date }

export interface WeeklyThemeReader {
  /** Weekly challenges (all companies) whose startDate is in (from, to]. */
  startedBetween(from: Date, to: Date): Promise<WeeklyTheme[]>;
}

/** Active company members, paged by uid so a large company never loads at once. */
export interface MemberPager {
  /** Active member uids (roles member/admin, not deactivated) among the next `limit` users after `afterUid`, ascending. `last` is the cursor for the next page, or null when no more users remain. */
  page(companyId: string, afterUid: string | null, limit: number): Promise<{ uids: string[]; last: string | null }>;
}
