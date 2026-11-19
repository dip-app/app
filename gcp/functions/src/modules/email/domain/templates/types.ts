import type { NotificationKind } from "../../../notifications/domain/categories";
import type { Locale } from "../../../i18n";
import type { OutboxCategory } from "../categories";

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
  calendar_invite: "calendar_invites",
  calendar_cancel: "calendar_invites",
  challenge_reviewed: "challenges",
  admin_suggestions: "admin_suggestions",
  // Opt-in emails added with the email catalog follow-up (docs/design/email-catalog.md): both categories default off.
  weekly_theme: "weekly_themes",
  admin_digest: "admin_digest",
  // Account emails (docs/design/email-catalog.md): transactional, not a member preference category.
  roster_invite: "account",
  welcome: "account",
  bug_report_resolved: "account",
} as const satisfies Record<string, OutboxCategory>;

export type TemplateId = keyof typeof TEMPLATE_CATEGORY;

/** Templates addressed to a roster entry (a person without an account yet) rather than a `users/{uid}` member. */
export function isRosterTemplate(template: TemplateId): template is "roster_invite" {
  return template === "roster_invite";
}

/** Outbox `uid` of a roster recipient: a stable, non-member key (`roster-<entryId>`) for caps and unsubscribe tokens. */
export function rosterRecipientKey(entryId: string): string {
  return `roster-${entryId}`;
}

/** The roster entry id inside a `roster-<entryId>` recipient key, or null for a member uid. */
export function rosterEntryOf(recipientKey: string): string | null {
  const match = /^roster-([0-9a-f]{64})$/.exec(recipientKey);
  return match ? match[1]! : null;
}

/**
 * Shared notification kind per template (notifications/domain/categories.ts); decides the per-event level gate. Account
 * templates never pass through the shared router and have no kind (null).
 */
export function templateKind(template: TemplateId, variables?: { outcome?: string }): NotificationKind | null {
  switch (template) {
    case "invite_received": return "invite";
    case "invite_answered": return "invite_answered";
    case "event_changed": return "event_changed";
    case "event_canceled": return "event_cancelled";
    case "attendee_added": return "attendee_added";
    case "event_reminder": return "reminder";
    case "calendar_invite":
    case "calendar_cancel": return "calendar_invite";
    case "challenge_reviewed": return variables?.outcome === "changes_requested" ? "challenge_changes_requested" : "challenge_approved";
    case "admin_suggestions": return "admin_suggestions";
    case "weekly_theme": return "weekly_theme_email";
    case "admin_digest": return "admin_digest";
    case "roster_invite":
    case "welcome":
    case "bug_report_resolved": return null;
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
  /**
   * `catalog://default/<category>`, `catalog://cover/<key>` or an approved https URL; anything else renders without an image.
   * Emails use the hosted JPEG of a library cover (`coverJpegURL` in covers/domain/coverCatalog.ts: Outlook has no WebP).
   */
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
  /**
   * Calendar invite (iCalendar METHOD:REQUEST). `sequence` is the per (event, member) SEQUENCE so a later invite or
   * update replaces the earlier calendar entry; `reason` only changes the copy.
   */
  calendar_invite: EventFacts & { sequence: number; reason: "joined" | "updated" };
  /** Calendar removal (iCalendar METHOD:CANCEL) with the SEQUENCE after the last invite. */
  calendar_cancel: EventFacts & { sequence: number; reason: "left" | "canceled" };
  challenge_reviewed: { challengeId: string; challengeTitle: string; outcome: "approved" | "changes_requested"; points?: number };
  /**
   * Invitation to a person an admin added to the roster before they signed in. The address is read at send time from
   * `companies/{c}/roster/{entryId}` (never stored here); the entry must still be `invited` then.
   */
  roster_invite: {
    /** Roster entry id: sha256 hex of the normalized address. */
    entryId: string;
    /** Company display name, at most 120 characters. */
    companyName: string;
    /** First name of the admin who sent it, at most 80 characters; absent when unknown. */
    inviterFirstName?: string;
    /** Organizers and admins are pointed at the admin portal, members at the app. */
    role: "member" | "organizer" | "admin";
    /** A second or later invitation email to the same entry. */
    reminder: boolean;
  };
  /** One-time welcome after a member's account is created (first membership resolve). */
  welcome: { companyName: string; role: "member" | "organizer" | "admin" };
  /** The member's own problem report was marked resolved. Never the report text, category or an admin note. */
  bug_report_resolved: { reportId: string; submittedAt: string };
  /**
   * Weekly theme announcement to a member who turned on `weekly_themes` emails, sent when the theme starts (same
   * audience and timing as the `weekly_theme` push). Theme copy as the organizer wrote it; the art is a catalog key.
   */
  weekly_theme: {
    challengeId: string;
    /** Theme title, at most 120 characters. */
    themeTitle: string;
    /** Theme description, at most 400 characters (longer descriptions are shortened at a word boundary when queued). */
    themeDescription?: string;
    /** Catalog key of `catalog://theme/<key>`; absent (unknown key) renders the card without art. */
    themeKey?: SuggestionTheme;
    /** Theme window, ISO-8601 UTC; the end is exclusive (the last day shown is the day before an end at midnight). */
    startDate: string;
    endDate: string;
    /** Points for finishing the theme, 1 to 1000; absent or 0 shows no points line. */
    pointsReward?: number;
  };
  /**
   * Daily roster digest for admins who turned on `admin_digest` (one per admin per company day, only when something
   * happened). Only what the roster and import pages already show admins: names of invited people who joined and the
   * counts of finished imports. No addresses, no file names, no row errors.
   */
  admin_digest: {
    /** Company-local day the digest covers, `YYYY-MM-DD`. */
    dayKey: string;
    /** Invited or imported people who joined that day; `names` holds at most 10 roster names (each at most 80 characters). */
    joined: { count: number; names: string[] };
    /** Up to 5 imports that finished that day, newest first; `finishedAt` (ISO-8601 UTC) labels each row with its time. */
    imports: Array<{ invited: number; updated: number; failed: number; finishedAt: string }>;
    /** All imports that finished that day (at least `imports.length`). */
    importCount: number;
  };
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
  /**
   * Recipient language (`users/{uid}.locale`, server-owned; missing means en). Our copy, dates and times follow it;
   * server content (event titles, names, idea text) never changes. Absent means English.
   */
  locale?: Locale;
  /**
   * The address this email goes to (the sender already holds it). Only the roster invitation shows it ("sign in with
   * Google using sam@acme.com"); it is never stored in the outbox.
   */
  recipientAddress?: string | null;
}

export interface RenderedEmail {
  subject: string;
  /** Short inbox preview text (hidden preheader). */
  preheader: string;
  html: string;
  text: string;
}
