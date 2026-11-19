import { LEVELS_FOR, type PushKind } from "./subscription";

/**
 * Canonical notification category registry shared by push, email and the in-app center
 * (docs/design/stretch/notification-preferences.md). Mirrored in iOS by `DIPNotificationCategory` (DIPCore).
 *
 * Adding a category is additive (new optional key, default below). Renaming or removing one is a breaking
 * wire change: stored preference documents and the iOS mirror use these ids verbatim.
 */
export const NOTIFICATION_CATEGORIES = [
  "invites", "event_updates", "reminders", "chat", "challenges", "social", "discovery", "calendar_invites", "admin_suggestions",
  "weekly_themes", "admin_digest",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ["push", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Categories each channel offers. `chat` and `social` are never emailed; `calendar_invites`, `admin_suggestions`,
 * `weekly_themes` (weekly theme announcement email) and `admin_digest` (daily roster digest for admins) are email only.
 */
export const CHANNEL_CATEGORIES: Readonly<Record<NotificationChannel, readonly NotificationCategory[]>> = {
  push: ["invites", "event_updates", "reminders", "chat", "challenges", "social", "discovery"],
  email: ["invites", "event_updates", "reminders", "challenges", "discovery", "calendar_invites", "admin_suggestions", "weekly_themes", "admin_digest"],
};

/**
 * Defaults applied when the member has no preference document or no key for a category. Evaluated
 * server-side on every read, so changing a default needs no data migration. Company-wide fan-outs (`weekly_themes`)
 * and admin digests (`admin_suggestions`, `admin_digest`) are opt-in: false here, and a category missing from this
 * map also resolves to false (`=== true` in resolvePreferences).
 */
export const DEFAULT_PREFERENCES: Readonly<Record<NotificationChannel, Readonly<Partial<Record<NotificationCategory, boolean>>>>> = {
  push: { invites: true, event_updates: true, reminders: true, chat: true, challenges: true, social: false, discovery: false },
  email: { invites: true, event_updates: true, reminders: false, challenges: true, discovery: false, calendar_invites: true, admin_suggestions: false, weekly_themes: false, admin_digest: false },
};

/**
 * Every notification the server can produce. `category` decides which preference switch governs it;
 * `eventLevel` names the per-event subscription gate (`LEVELS_FOR`) for event-scoped kinds, or null when the
 * per-activity level does not apply. `inAppType` is the `users/{uid}/notifications` type, or null when the
 * kind has no in-app notice.
 */
export interface NotificationKindSpec {
  category: NotificationCategory;
  eventLevel: PushKind | null;
  inAppType: string | null;
}

export const NOTIFICATION_KINDS = {
  chat: { category: "chat", eventLevel: "chat", inAppType: null },
  event_changed: { category: "event_updates", eventLevel: "event_changed", inAppType: "event_updated" },
  event_cancelled: { category: "event_updates", eventLevel: "event_changed", inAppType: "event_cancelled" },
  reminder: { category: "reminders", eventLevel: "reminder", inAppType: "reminder" },
  invite: { category: "invites", eventLevel: null, inAppType: "invite" },
  invite_answered: { category: "invites", eventLevel: null, inAppType: "invite_answered" },
  attendee_added: { category: "event_updates", eventLevel: null, inAppType: "attendee_added" },
  attendee_removed: { category: "event_updates", eventLevel: null, inAppType: "attendee_removed" },
  challenge_approved: { category: "challenges", eventLevel: null, inAppType: "challenge_approved" },
  challenge_changes_requested: { category: "challenges", eventLevel: null, inAppType: "challenge_changes_requested" },
  weekly_theme: { category: "challenges", eventLevel: null, inAppType: null },
  event_interest: { category: "discovery", eventLevel: null, inAppType: null },
  /** Someone commented on the recipient's album photo (push default off: `social`). */
  photo_comment: { category: "social", eventLevel: null, inAppType: "comment" },
  /** A new photo landed in the album of an activity the recipient attended (push default off: `social`). */
  photo_added: { category: "social", eventLevel: null, inAppType: "photo_added" },
  /** Calendar invite emails (METHOD:REQUEST and METHOD:CANCEL .ics); email only, no push or in-app twin. */
  calendar_invite: { category: "calendar_invites", eventLevel: null, inAppType: null },
  admin_suggestions: { category: "admin_suggestions", eventLevel: null, inAppType: null },
  /** Weekly theme announcement email (email only; the `weekly_theme` push stays under `challenges`). */
  weekly_theme_email: { category: "weekly_themes", eventLevel: null, inAppType: null },
  /** Daily roster digest for admins (email only). */
  admin_digest: { category: "admin_digest", eventLevel: null, inAppType: null },
} as const satisfies Record<string, NotificationKindSpec>;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === "string" && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NOTIFICATION_KINDS, value);
}

export function channelOffers(channel: NotificationChannel, category: NotificationCategory): boolean {
  return CHANNEL_CATEGORIES[channel].includes(category);
}

/** Subscription levels that let an event-scoped kind through, or null when the per-event level does not apply. */
export function eventLevelsFor(kind: NotificationKind) {
  const gate = NOTIFICATION_KINDS[kind].eventLevel;
  return gate === null ? null : LEVELS_FOR[gate];
}
