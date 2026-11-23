/**
 * Email view of the shared notification category registry, owned by the push workstream
 * (docs/design/stretch/notification-preferences.md, `notifications/domain/categories.ts`). Nothing here redefines
 * ids or defaults: email offers exactly `CHANNEL_CATEGORIES.email` and resolves switches with `resolvePreferences`.
 */
import { CHANNEL_CATEGORIES, type NotificationCategory } from "../../notifications/domain/categories";
import { resolvePreferences } from "../../notifications/domain/preferences";

export type EmailCategory = Extract<NotificationCategory, "invites" | "event_updates" | "reminders" | "challenges" | "discovery" | "calendar_invites" | "admin_suggestions" | "weekly_themes" | "admin_digest" | "day_before_reminders">;
export const EMAIL_CATEGORIES = CHANNEL_CATEGORIES.email as readonly EmailCategory[];

export function isEmailCategory(value: unknown): value is EmailCategory {
  return typeof value === "string" && (EMAIL_CATEGORIES as readonly string[]).includes(value);
}

/** Resolves the stored `email` map of `users/{uid}/settings/notifications` (possibly missing or partial) with the shared defaults. */
export function resolveEmailPreferences(storedEmailMap: Readonly<Record<string, unknown>> | null | undefined): Record<EmailCategory, boolean> {
  const resolved = resolvePreferences({ email: storedEmailMap ?? {} }).email;
  const out = {} as Record<EmailCategory, boolean>;
  for (const category of EMAIL_CATEGORIES) out[category] = resolved[category];
  return out;
}

/**
 * Outbox categories: the member-controlled email categories plus `account`, the transactional account emails (roster
 * invitation, welcome, problem report resolved; docs/design/email-catalog.md). `account` is not in the shared preference
 * registry and has no switch of its own: a member who turned every email category off gets no account email either, and
 * a roster invitee opts out of invitation emails from the link in the email (`emailInviteOptOuts/{emailHash}`).
 */
export const ACCOUNT_CATEGORY = "account" as const;
export type OutboxCategory = EmailCategory | typeof ACCOUNT_CATEGORY;

export function isOutboxCategory(value: unknown): value is OutboxCategory {
  return value === ACCOUNT_CATEGORY || isEmailCategory(value);
}
