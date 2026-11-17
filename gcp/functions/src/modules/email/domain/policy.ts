import { EVENT_LEVEL_GATE, isEmailCategory } from "./categories";

/**
 * Email channel decision for one candidate notification (docs/design/stretch/email.md, Delivery routing with push).
 * Precedence follows the shared model: category preference, then the per-event level, then deliverability.
 * Suppression and caps are checked again by the sender at send time, where the address is known.
 */

export interface EmailRoutingInput {
  /** Shared registry category id (may be one email never offers, such as `chat`). */
  category: string;
  /** EMAIL_ENABLED server param. */
  globalEnabled: boolean;
  /** `emailSettings/{companyId}.enabled` (server-owned). */
  companyEnabled: boolean;
  /** Resolved email preference for this category (stored value or default). */
  emailPreference: boolean;
  /** Per-event subscription level for event-scoped categories; null when the notification is not event-scoped. */
  eventLevel: string | null;
  /** Whether the event-scoped gate applies to this notification. */
  eventScoped: boolean;
  /** Push will be delivered for this same notification (push category on and at least one device token). */
  pushWillDeliver: boolean;
}

export type EmailRoutingDecision =
  | { send: true }
  | { send: false; reason: "disabled" | "company_disabled" | "not_offered" | "preference_off" | "event_level" | "push_covers" };

/**
 * Policy per category:
 * - invites, event_updates: email and push both (low volume, high value).
 * - reminders: follows the email preference (default off), regardless of push.
 * - challenges: email only when push will not be delivered, to avoid double notifying.
 */
export function decideEmail(input: EmailRoutingInput): EmailRoutingDecision {
  if (!input.globalEnabled) return { send: false, reason: "disabled" };
  if (!isEmailCategory(input.category)) return { send: false, reason: "not_offered" };
  if (!input.companyEnabled) return { send: false, reason: "company_disabled" };
  if (!input.emailPreference) return { send: false, reason: "preference_off" };
  const gate = EVENT_LEVEL_GATE[input.category];
  if (input.eventScoped && gate) {
    // A missing level keeps today's behavior for joined events: the default level is `changes`.
    const level = input.eventLevel ?? "changes";
    if (!gate.includes(level)) return { send: false, reason: "event_level" };
  }
  if (input.category === "challenges" && input.pushWillDeliver) return { send: false, reason: "push_covers" };
  return { send: true };
}
