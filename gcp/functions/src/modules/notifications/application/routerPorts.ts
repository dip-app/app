/** Create-once delivery markers (`notificationReceipts/{id}`), server-only. */
export interface DeliveryReceipts {
  /** True only for the first caller of an id; false when the marker already exists. */
  claim(notificationId: string): Promise<boolean>;
}

/** Per-user push volume cap (`pushRateLimits/{uid}`), server-only. */
export interface PushRateLimiter {
  /** Returns the uids allowed to receive one more push now, and counts that push for them. */
  admit(uids: readonly string[], now: Date): Promise<Set<string>>;
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
