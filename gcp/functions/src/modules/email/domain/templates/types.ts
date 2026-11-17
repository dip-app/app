import type { NotificationKind } from "../../../notifications/domain/categories";
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
  admin_suggestions: "admin_suggestions",
} as const satisfies Record<string, EmailCategory>;

export type TemplateId = keyof typeof TEMPLATE_CATEGORY;

/** Shared notification kind per template (notifications/domain/categories.ts); decides the per-event level gate. */
export function templateKind(template: TemplateId, variables?: { outcome?: string }): NotificationKind {
  switch (template) {
    case "invite_received": return "invite";
    case "invite_answered": return "invite_answered";
    case "event_changed": return "event_changed";
    case "event_canceled": return "event_cancelled";
    case "attendee_added": return "attendee_added";
    case "event_reminder": return "reminder";
    case "challenge_reviewed": return variables?.outcome === "changes_requested" ? "challenge_changes_requested" : "challenge_approved";
    case "admin_suggestions": return "admin_suggestions";
  }
}
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
  /** Venue display name. */
  venueName?: string;
  /**
   * Venue street address and locality as one line (members of the event's company see it in the app; the email goes
   * only to such members). Never coordinates.
   */
  venueAddress?: string;
  /** `catalog://default/<key>` or an approved https URL; anything else renders without an image. */
  coverImageURL?: string;
  /** Event revision, used as the ICS SEQUENCE so calendar clients replace older copies. */
  revision?: number;
}

/** Stored, allow-listed variables per template (what the outbox document carries). No email addresses, chat or comment text. */
export interface TemplateVariables {
  invite_received: EventFacts & { inviterFirstName: string };
  invite_answered: EventFacts & { inviteeFirstName: string; answer: "accepted" | "declined" };
  /**
   * `previous` holds the OLD values of the fields that changed (earliest old value when several changes are collapsed);
   * the EventFacts fields hold the current values. Only time, venue and title changes are shown, so an update that
   * touches nothing else visible is never emailed.
   */
  event_changed: EventFacts & {
    changedFields: Array<"time" | "venue" | "title" | "details">;
    previous?: { startTime?: string; endTime?: string; venueName?: string; venueAddress?: string; eventTitle?: string };
  };
  event_canceled: EventFacts;
  attendee_added: EventFacts;
  event_reminder: EventFacts & { window: "24h" | "1h" };
  challenge_reviewed: { challengeId: string; challengeTitle: string; outcome: "approved" | "changes_requested"; points?: number };
  /** Weekly ideas for company admins (docs/design/stretch/admin-suggestions-email.md). Company aggregates only; no names or emails. */
  admin_suggestions: {
    /** ISO week in the company zone, `^\d{4}-W\d{2}$`. */
    weekKey: string;
    /** For example "Week of Dec 1", at most 40 characters. */
    weekLabel: string;
    /** One calm line shown above the ideas (for example when there is little data yet), at most 200 characters. */
    dataNote: string | null;
    /** One to five ideas, best first. */
    ideas: SuggestionIdeaVariables[];
  };
}

/** Weekly theme ids of the admin ideas email (tile art `ideas/<theme>.png`). */
export const SUGGESTION_THEMES = ["fitness", "outdoors", "food", "arts", "games", "music", "learning", "volunteering", "wellness"] as const;
export type SuggestionTheme = (typeof SUGGESTION_THEMES)[number];
export type SuggestionFitLabel = "perfect" | "great" | "good";

export interface SuggestionIdeaVariables {
  /** Catalog idea id, `^[a-z0-9-]{1,64}$`. */
  ideaId: string;
  /** At most 80 characters. */
  title: string;
  /** At most 160 characters. */
  pitch: string;
  theme: SuggestionTheme;
  /** Friendly label for strong matches only; never a percentage. */
  fitLabel: SuggestionFitLabel | null;
  /** Zero to two grounded "why" lines, each at most 120 characters. */
  reasons: string[];
  /** One line, at most 120 characters, for example "90 min · 8 to 20 people · Under $15 per person". */
  facts: string;
  /** At most 80 characters. */
  whenHint: string | null;
  /** Signed deep link, `https://letsdip.work/admin/ideas/suggested/?t=<token>`, at most 1024 characters. */
  linkURL: string;
}

/** Values the sender adds at send time (never stored in the outbox). */
export interface RenderContext {
  /** Recipient first name from `users/{uid}.displayName`, or null when unknown. */
  recipientFirstName: string | null;
  /** IANA zone for times, with its abbreviation shown next to every time. */
  timeZone: string;
  /** Category-specific one-click unsubscribe URL (`https://letsdip.work/u/<token>`). */
  unsubscribeURL: string;
  /**
   * Signed open-tracking pixel (`https://letsdip.work/o/<token>.gif`), or null to render none. Opens are an
   * approximate signal (Apple Mail Privacy Protection and Gmail's image proxy prefetch images).
   */
  openPixelURL?: string | null;
}

export interface RenderedEmail {
  subject: string;
  /** Short inbox preview text (hidden preheader). */
  preheader: string;
  html: string;
  text: string;
}
