/**
 * Per-user, per-event notification preference stored at
 * `companies/{c}/events/{eventId}/subscriptions/{uid}` as `{ level, updatedAt }`.
 * A missing document means "none" (not subscribed).
 *
 * - `all`: chat messages + event changes + reminders
 * - `changes`: event changes + reminders (default created when a member joins)
 * - `reminders`: reminders only
 * - `none`: nothing
 */
export const SUBSCRIPTION_LEVELS = ["all", "changes", "reminders", "none"] as const;
export type SubscriptionLevel = (typeof SUBSCRIPTION_LEVELS)[number];

export const DEFAULT_LEVEL_ON_JOIN: SubscriptionLevel = "changes";

export type PushKind = "chat" | "event_changed" | "reminder";

/** Which stored levels receive each push kind. `none` never appears here. */
export const LEVELS_FOR: Readonly<Record<PushKind, readonly SubscriptionLevel[]>> = {
  chat: ["all"],
  event_changed: ["all", "changes"],
  reminder: ["all", "changes", "reminders"],
};

export function isSubscriptionLevel(value: unknown): value is SubscriptionLevel {
  return typeof value === "string" && (SUBSCRIPTION_LEVELS as readonly string[]).includes(value);
}
