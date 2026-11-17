import type { EmailCategory } from "../categories";

/**
 * Template ids (docs/design/stretch/email.md, Template catalog). Each template has a fixed category and an
 * allow-listed variable shape; nothing else from the triggering document may reach an email.
 */
export const TEMPLATE_CATEGORY = {
  invite_received: "invites",
  invite_answered: "invites",
  event_changed: "event_updates",
  event_canceled: "event_updates",
  attendee_added: "event_updates",
  event_reminder: "reminders",
  challenge_reviewed: "challenges",
} as const satisfies Record<string, EmailCategory>;

export type TemplateId = keyof typeof TEMPLATE_CATEGORY;
export const TEMPLATE_IDS = Object.keys(TEMPLATE_CATEGORY) as TemplateId[];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TEMPLATE_CATEGORY, value);
}

/** Event facts shared by event templates. Times are ISO-8601 UTC strings; the renderer localizes them. */
export interface EventFacts {
  eventId: string;
  eventTitle: string;
  startTime: string;
  endTime: string;
  /** Venue display name only; never the street address or coordinates. */
  venueName?: string;
  /** `catalog://default/<key>` or an approved https URL; anything else renders without an image. */
  coverImageURL?: string;
}

/** Stored, allow-listed variables per template (what the outbox document carries). No email addresses, chat or comment text. */
export interface TemplateVariables {
  invite_received: EventFacts & { inviterFirstName: string };
  invite_answered: EventFacts & { inviteeFirstName: string; answer: "accepted" | "declined" };
  event_changed: EventFacts & { changedFields: Array<"time" | "venue" | "title" | "details"> };
  event_canceled: EventFacts;
  attendee_added: EventFacts;
  event_reminder: EventFacts & { window: "24h" | "1h" };
  challenge_reviewed: { challengeId: string; challengeTitle: string; outcome: "approved" | "changes_requested"; points?: number };
}

/** Values the sender adds at send time (never stored in the outbox). */
export interface RenderContext {
  /** Recipient first name from `users/{uid}.displayName`, or null when unknown. */
  recipientFirstName: string | null;
  /** IANA zone for times, with its abbreviation shown next to every time. */
  timeZone: string;
  /** Category-specific one-click unsubscribe URL (`https://letsdip.work/u/<token>`). */
  unsubscribeURL: string;
  /** Postal address for the footer (owner-provided param). */
  postalAddress: string;
}

export interface RenderedEmail {
  subject: string;
  /** Short inbox preview text (hidden preheader). */
  preheader: string;
  html: string;
  text: string;
}
