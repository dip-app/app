import { SHARE_ORIGIN, collapseWhitespace } from "../../../share/domain/sharePage";
import { intlTag, splitAround, type Locale } from "../../../i18n";
import type { EmailCategory } from "../categories";
import { tEmail, type EmailMessageKey } from "./i18n";
import type { EventFacts, TemplateId, TemplateVariables } from "./types";

/** Deep link to one event; the Hosting rewrite opens the app or the share page. */
export function eventURL(eventId: string): string {
  return `${SHARE_ORIGIN}/e/${encodeURIComponent(eventId)}`;
}

export const SUBJECT_MAX = 78;

/** Category noun for the footer sentence "You are getting this because <noun> emails are on." (catalog `email.reason.*`). */
export function categoryReason(category: EmailCategory, locale: Locale = "en"): string {
  return tEmail(locale, `email.reason.${category}`);
}

/** English category nouns (kept for callers that predate the catalog). */
export const CATEGORY_REASON: Readonly<Record<EmailCategory, string>> = {
  invites: categoryReason("invites"),
  event_updates: categoryReason("event_updates"),
  reminders: categoryReason("reminders"),
  challenges: categoryReason("challenges"),
  discovery: categoryReason("discovery"),
  calendar_invites: categoryReason("calendar_invites"),
  admin_suggestions: categoryReason("admin_suggestions"),
};

/** Plain-text pieces of one email, before layout. Everything here is unescaped. */
export interface EmailCopy {
  subject: string;
  /** Short heading shown in the heading font (22 to 24px), for example "New invitation". */
  heading: string;
  preheader: string;
  /** First sentence; the renderer prefixes the greeting ("Hi Sam, "), so it starts with a name or in lower case. */
  lead: string;
  /** Small neutral pill above the event title, or null. */
  badge: string | null;
  /** Bold highlight line after the card (for example "+50 points"), or null. */
  highlight: string | null;
  /** Event facts to show as a compact card, or null. */
  event: EventFacts | null;
  /** Extra sentence after the card. */
  note: string | null;
  ctaLabel: string;
  ctaURL: string;
}


/** "time", "time and location", "time, location, and title"; other languages use Intl.ListFormat ("la hora y el lugar"). */
export function joinWords(words: readonly string[], locale: Locale = "en"): string {
  if (locale !== "en") return new Intl.ListFormat(intlTag(locale), { style: "long", type: "conjunction" }).format(words);
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/** Truncates by UTF-16 length at a word boundary with "...". */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 3) return ".".repeat(Math.max(0, max));
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max - 3) break;
    out += ch;
  }
  const lastSpace = out.lastIndexOf(" ");
  if (lastSpace >= (max - 3) * 0.5) out = out.slice(0, lastSpace);
  return `${out.replace(/[\s.,;:!?-]+$/u, "")}...`;
}

/** Builds `prefix + title + suffix` within SUBJECT_MAX, shortening the title first. */
export function fitSubject(prefix: string, title: string, suffix = ""): string {
  const full = `${prefix}${title}${suffix}`;
  if (full.length <= SUBJECT_MAX) return full;
  const budget = SUBJECT_MAX - prefix.length - suffix.length;
  if (budget >= 12) return `${prefix}${truncate(title, budget)}${suffix}`;
  return truncate(full, SUBJECT_MAX);
}

const clean = (value: string): string => collapseWhitespace(value);

type ChangedVars = TemplateVariables["event_changed"];

/** What visibly changed in an `event_changed` email. `venue` is also true when the old values are unknown. */
export interface ChangeSummary {
  time: boolean;
  /** The start day (in the recipient zone) differs from the old start day. */
  date: boolean;
  title: boolean;
  venue: boolean;
  /** Strike flags: only set when the old value is known and differs. */
  venueName: boolean;
  venueAddress: boolean;
}

const sameInstant = (a: string, b: string): boolean => new Date(a).getTime() === new Date(b).getTime();

const dayKey = (iso: string, zone: string): string => new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).format(new Date(iso));

export function changeSummary(v: ChangedVars, zone = "America/New_York"): ChangeSummary {
  const prev = v.previous;
  const has = (f: ChangedVars["changedFields"][number]): boolean => v.changedFields.includes(f);
  const timeKnown = prev !== undefined && (prev.startTime !== undefined || prev.endTime !== undefined);
  const time =
    has("time") && (!timeKnown || !sameInstant(prev?.startTime ?? v.startTime, v.startTime) || !sameInstant(prev?.endTime ?? v.endTime, v.endTime));
  const titleKnown = prev?.eventTitle !== undefined;
  const title = has("title") && (!titleKnown || clean(prev?.eventTitle ?? "") !== clean(v.eventTitle));
  const venueKnown = prev !== undefined && (prev.venueName !== undefined || prev.venueAddress !== undefined);
  const venueName = has("venue") && prev?.venueName !== undefined && clean(prev.venueName) !== clean(v.venueName ?? "");
  const venueAddress = has("venue") && prev?.venueAddress !== undefined && clean(prev.venueAddress) !== clean(v.venueAddress ?? "");
  const venue = has("venue") && (!venueKnown || venueName || venueAddress);
  const date = time && prev?.startTime !== undefined && dayKey(prev.startTime, zone) !== dayKey(v.startTime, zone);
  return { time, date, title, venue, venueName, venueAddress };
}

/** False when no time, venue or title value actually differs (for example only "details", or previous equals current). */
export function hasVisibleChange(v: ChangedVars): boolean {
  const c = changeSummary(v);
  return c.time || c.title || c.venue;
}

/** Builds a subject from a catalog message with a `{title}` slot, shortening only the title (server content). */
function subject(locale: Locale, key: EmailMessageKey, title: string, vars: Record<string, string | number> = {}): string {
  const [prefix, suffix] = splitAround(tEmail, locale, key, "title", vars);
  return fitSubject(prefix, title, suffix);
}

function changedWords(v: ChangedVars, zone: string, locale: Locale, subjectLine = false): string[] {
  const c = changeSummary(v, zone);
  const timeWord: EmailMessageKey = c.date ? (subjectLine ? "email.change.date" : "email.change.dateAndTime") : "email.change.time";
  const keys = [c.time ? timeWord : null, c.venue ? "email.change.location" : null, c.title ? "email.change.title" : null]
    .filter((k): k is EmailMessageKey => k !== null);
  return (keys.length ? keys : ["email.change.details" as const]).map((k) => tEmail(locale, k));
}

function withEvent(facts: EventFacts, locale: Locale, rest: Pick<EmailCopy, "subject" | "heading" | "preheader" | "lead" | "note"> & { badge?: string }): EmailCopy {
  return { badge: null, highlight: null, ...rest, event: facts, ctaLabel: tEmail(locale, "email.cta.open"), ctaURL: eventURL(facts.eventId) };
}

/**
 * Plain-text copy of one template in the recipient's language. English is the source and renders byte-identically to
 * the pre-catalog templates (golden snapshots); server content (titles, names) is never translated.
 */
export function buildCopy<T extends TemplateId>(template: T, variables: TemplateVariables[T], zone = "America/New_York", locale: Locale = "en"): EmailCopy {
  const id: TemplateId = template;
  const t = (key: EmailMessageKey, vars: Record<string, string | number> = {}) => tEmail(locale, key, vars);
  switch (id) {
    case "admin_suggestions":
      throw new Error("admin_suggestions has its own renderer (adminSuggestions.ts)");
    case "invite_received": {
      const e = variables as TemplateVariables["invite_received"];
      const who = clean(e.inviterFirstName);
      const title = clean(e.eventTitle);
      return withEvent(e, locale, {
        heading: t("email.inviteReceived.heading"),
        subject: subject(locale, "email.inviteReceived.subject", title, { who }),
        preheader: t("email.inviteReceived.preheader", { who, title }),
        lead: t("email.inviteReceived.lead", { who }),
        note: t("email.inviteReceived.note"),
      });
    }
    case "invite_answered": {
      const e = variables as TemplateVariables["invite_answered"];
      const who = clean(e.inviteeFirstName);
      const title = clean(e.eventTitle);
      const answer = e.answer === "accepted" ? "accepted" : "declined";
      return withEvent(e, locale, {
        heading: t("email.inviteAnswered.heading", { answer }),
        subject: subject(locale, "email.inviteAnswered.subject", title, { who, answer }),
        preheader: t("email.inviteAnswered.preheader", { who, answer, title }),
        lead: t("email.inviteAnswered.lead", { who, answer }),
        note: null,
      });
    }
    case "event_changed": {
      const e = variables as TemplateVariables["event_changed"];
      const title = clean(e.eventTitle);
      const what = joinWords(changedWords(e, zone, locale), locale);
      const subjectWhat = joinWords(changedWords(e, zone, locale, true), locale);
      return withEvent(e, locale, {
        heading: t("email.eventChanged.heading"),
        subject: subject(locale, "email.eventChanged.subject", title, { what: subjectWhat }),
        preheader: t("email.eventChanged.preheader", { what, title }),
        lead: t("email.eventChanged.lead", { what }),
        note: t("email.note.calendar"),
        badge: t("email.badge.updated"),
      });
    }
    case "event_canceled": {
      const e = variables as TemplateVariables["event_canceled"];
      const title = clean(e.eventTitle);
      return withEvent(e, locale, {
        heading: t("email.eventCanceled.heading"),
        subject: subject(locale, "email.eventCanceled.subject", title),
        preheader: t("email.eventCanceled.preheader", { title }),
        lead: t("email.eventCanceled.lead"),
        note: t("email.eventCanceled.note"),
      });
    }
    case "attendee_added": {
      const e = variables as TemplateVariables["attendee_added"];
      const title = clean(e.eventTitle);
      return withEvent(e, locale, {
        heading: t("email.attendeeAdded.heading"),
        subject: subject(locale, "email.attendeeAdded.subject", title),
        preheader: t("email.attendeeAdded.preheader", { title }),
        lead: t("email.attendeeAdded.lead"),
        note: null,
      });
    }
    case "event_reminder": {
      const e = variables as TemplateVariables["event_reminder"];
      const title = clean(e.eventTitle);
      const window = e.window === "24h" ? "day" : "hour";
      return withEvent(e, locale, {
        heading: t("email.reminder.heading", { window }),
        subject: subject(locale, "email.reminder.subject", title, { window }),
        preheader: t("email.reminder.preheader", { window, title }),
        lead: t("email.reminder.lead", { window, title }),
        note: t("email.note.calendar"),
      });
    }
    case "calendar_invite": {
      const e = variables as TemplateVariables["calendar_invite"];
      const title = clean(e.eventTitle);
      const reason = e.reason === "updated" ? "updated" : "joined";
      return withEvent(e, locale, {
        heading: t("email.calendarInvite.heading", { reason }),
        subject: subject(locale, "email.calendarInvite.subject", title, { reason }),
        preheader: t("email.calendarInvite.preheader", { reason, title }),
        lead: t("email.calendarInvite.lead", { reason }),
        note: t("email.calendarInvite.note", { reason }),
        ...(reason === "updated" ? { badge: t("email.badge.updated") } : {}),
      });
    }
    case "calendar_cancel": {
      const e = variables as TemplateVariables["calendar_cancel"];
      const title = clean(e.eventTitle);
      const reason = e.reason === "left" ? "left" : "canceled";
      return withEvent(e, locale, {
        heading: t("email.calendarCancel.heading", { reason }),
        subject: subject(locale, "email.calendarCancel.subject", title, { reason }),
        preheader: t("email.calendarCancel.preheader", { reason, title }),
        lead: t("email.calendarCancel.lead", { reason }),
        note: t("email.calendarCancel.note"),
        ...(reason === "left" ? {} : { badge: t("email.badge.canceled") }),
      });
    }
    case "challenge_reviewed": {
      const e = variables as TemplateVariables["challenge_reviewed"];
      const title = clean(e.challengeTitle);
      const outcome = e.outcome === "approved" ? "approved" : "changes_requested";
      const points = outcome === "approved" && typeof e.points === "number" && e.points > 0 ? e.points : null;
      return {
        heading: t("email.challenge.heading", { outcome }),
        subject: subject(locale, "email.challenge.subject", title, { outcome }),
        preheader: t("email.challenge.preheader", { outcome, title }),
        lead: t("email.challenge.lead", { outcome, title }),
        badge: null,
        event: null,
        highlight: points !== null ? t("email.challenge.points", { points }) : null,
        note: outcome === "approved" ? null : t("email.challenge.note"),
        ctaLabel: t("email.cta.open"),
        ctaURL: `${SHARE_ORIGIN}/`,
      };
    }
  }
}
