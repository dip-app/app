import {
  CHANNEL_CATEGORIES, DEFAULT_PREFERENCES, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, NOTIFICATION_KINDS,
  eventLevelsFor, type NotificationCategory, type NotificationChannel, type NotificationKind,
} from "./categories";
import type { SubscriptionLevel } from "./subscription";

/** Firestore path of the member's preference document (client-owned, rules-validated). */
export const PREFERENCES_COLLECTION = "settings";
export const PREFERENCES_DOC_ID = "notifications";
export const preferencesPath = (uid: string) => `users/${uid}/${PREFERENCES_COLLECTION}/${PREFERENCES_DOC_ID}`;

/** Fully resolved switches: every category of every channel; categories a channel does not offer are false. */
export type ResolvedPreferences = Readonly<Record<NotificationChannel, Readonly<Record<NotificationCategory, boolean>>>>;

function resolveChannel(channel: NotificationChannel, stored: unknown): Record<NotificationCategory, boolean> {
  const map = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const offered = CHANNEL_CATEGORIES[channel];
  const result = {} as Record<NotificationCategory, boolean>;
  for (const category of NOTIFICATION_CATEGORIES) {
    if (!offered.includes(category)) { result[category] = false; continue; }
    const value = map[category];
    result[category] = typeof value === "boolean" ? value : DEFAULT_PREFERENCES[channel][category] === true;
  }
  return result;
}

/**
 * Resolves a stored `users/{uid}/settings/notifications` document (or undefined/null when missing) against the
 * registry defaults. Tolerant by design: unknown keys and non-boolean values are ignored, so an old server
 * never fails on a newer document and a missing document means "defaults".
 */
export function resolvePreferences(stored: unknown): ResolvedPreferences {
  const doc = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const result = {} as Record<NotificationChannel, Record<NotificationCategory, boolean>>;
  for (const channel of NOTIFICATION_CHANNELS) result[channel] = resolveChannel(channel, doc[channel]);
  return result;
}

export const DEFAULT_RESOLVED_PREFERENCES: ResolvedPreferences = resolvePreferences(undefined);

export type DeliveryBlock = "category_off" | "event_level" | "no_destination";
export type DeliveryDecision = { deliver: true } | { deliver: false; reason: DeliveryBlock };

export interface DeliveryCandidate {
  kind: NotificationKind;
  channel: NotificationChannel;
  preferences: ResolvedPreferences;
  /**
   * The member's per-event subscription level for event-scoped kinds (null = no subscription document, which
   * means `none`). Ignored for kinds whose registry entry has no event gate.
   */
  eventLevel?: SubscriptionLevel | null;
  /** Push: at least one registered device token. Email: a deliverable, unsuppressed address. */
  hasDestination: boolean;
}

/**
 * The single precedence rule for every channel (push-triggers.md, "Categories"):
 * (1) the kind's category is on for the channel, (2) for event-scoped kinds the per-event level allows it,
 * (3) a destination exists. All three must pass; the first failing step is reported.
 */
export function evaluateDelivery(candidate: DeliveryCandidate): DeliveryDecision {
  const category = NOTIFICATION_KINDS[candidate.kind].category;
  if (!candidate.preferences[candidate.channel][category]) return { deliver: false, reason: "category_off" };
  const levels = eventLevelsFor(candidate.kind);
  if (levels !== null) {
    const level = candidate.eventLevel ?? null;
    if (level === null || !levels.includes(level)) return { deliver: false, reason: "event_level" };
  }
  if (!candidate.hasDestination) return { deliver: false, reason: "no_destination" };
  return { deliver: true };
}

/** Convenience for fan-outs that already know the level and destination: is the category switch on? */
export function categoryEnabled(preferences: ResolvedPreferences, channel: NotificationChannel, kind: NotificationKind): boolean {
  return preferences[channel][NOTIFICATION_KINDS[kind].category];
}
