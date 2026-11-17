import { NOTIFICATION_KINDS, type NotificationKind } from "../../notifications/domain/categories";
import { evaluateDelivery, type ResolvedPreferences } from "../../notifications/domain/preferences";
import type { SubscriptionLevel } from "../../notifications/domain/subscription";

/**
 * Email channel decision for one recipient of one notification (docs/design/stretch/email.md, Delivery routing with push).
 * Steps 1 and 2 (category switch, per-event level) are the shared `evaluateDelivery` rule; the destination step is
 * deferred to the sender, which reads the address and checks suppression at send time. On top of that: the global and
 * per-company switches, and the push-or-email policy.
 */

export interface EmailRoutingInput {
  kind: NotificationKind;
  /** EMAIL_ENABLED server param. */
  globalEnabled: boolean;
  /** `emailSettings/{companyId}.enabled` (server-owned). */
  companyEnabled: boolean;
  preferences: ResolvedPreferences;
  /** Per-event subscription level (null = no subscription document, which the shared rule treats as `none`). */
  eventLevel: SubscriptionLevel | null;
  /** Push will be delivered for this same notification (push switch on, device token present, not rate limited). */
  pushWillDeliver: boolean;
}

export type EmailRoutingDecision =
  | { send: true }
  | { send: false; reason: "disabled" | "company_disabled" | "category_off" | "event_level" | "push_covers" };

/**
 * Policy per category:
 * - invites, event_updates: email and push both (low volume, high value).
 * - reminders, discovery: follow the email switch (default off), regardless of push.
 * - challenges: email only when push will not be delivered, to avoid double notifying.
 */
export function decideEmail(input: EmailRoutingInput): EmailRoutingDecision {
  if (!input.globalEnabled) return { send: false, reason: "disabled" };
  if (!input.companyEnabled) return { send: false, reason: "company_disabled" };
  const shared = evaluateDelivery({
    kind: input.kind, channel: "email", preferences: input.preferences, eventLevel: input.eventLevel, hasDestination: true,
  });
  if (!shared.deliver) return { send: false, reason: shared.reason === "event_level" ? "event_level" : "category_off" };
  if (NOTIFICATION_KINDS[input.kind].category === "challenges" && input.pushWillDeliver) return { send: false, reason: "push_covers" };
  return { send: true };
}
