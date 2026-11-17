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
