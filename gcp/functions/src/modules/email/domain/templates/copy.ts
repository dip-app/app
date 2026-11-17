import { SHARE_ORIGIN, collapseWhitespace } from "../../../share/domain/sharePage";
import type { EmailCategory } from "../categories";
import type { EventFacts, TemplateId, TemplateVariables } from "./types";

/** Deep link to one event; the Hosting rewrite opens the app or the share page. */
export function eventURL(eventId: string): string {
  return `${SHARE_ORIGIN}/e/${encodeURIComponent(eventId)}`;
}

export const SUBJECT_MAX = 78;

/** Category noun for the footer sentence "You are getting this because <noun> emails are on." */
export const CATEGORY_REASON: Readonly<Record<EmailCategory, string>> = {
  invites: "invite",
  event_updates: "event update",
  reminders: "reminder",
  challenges: "challenge",
  discovery: "event suggestion",
  admin_suggestions: "weekly event idea",
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


/** "time", "time and location", "time, location, and title". */
export function joinWords(words: readonly string[]): string {
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

function changedWords(v: ChangedVars, zone: string, subject = false): string[] {
  const c = changeSummary(v, zone);
  const timeWord = c.date ? (subject ? "date" : "date and time") : "time";
  const words = [c.time ? timeWord : "", c.venue ? "location" : "", c.title ? "title" : ""].filter(Boolean);
  return words.length ? words : ["details"];
}

function withEvent(facts: EventFacts, rest: Pick<EmailCopy, "subject" | "heading" | "preheader" | "lead" | "note"> & { badge?: string }): EmailCopy {
  return { badge: null, highlight: null, ...rest, event: facts, ctaLabel: "Open in DIP", ctaURL: eventURL(facts.eventId) };
}

export function buildCopy<T extends TemplateId>(template: T, variables: TemplateVariables[T], zone = "America/New_York"): EmailCopy {
  const id: TemplateId = template;
  switch (id) {
    case "admin_suggestions":
      throw new Error("admin_suggestions has its own renderer (adminSuggestions.ts)");
    case "invite_received": {
      const e = variables as TemplateVariables["invite_received"];
      const who = clean(e.inviterFirstName);
      return withEvent(e, {
        heading: "New invitation",
        subject: fitSubject(`${who} invited you to `, clean(e.eventTitle)),
        preheader: `${who} invited you to ${clean(e.eventTitle)}.`,
        lead: `${who} invited you to join an event on DIP.`,
        note: "See who is going and respond.",
      });
    }
    case "invite_answered": {
      const e = variables as TemplateVariables["invite_answered"];
      const who = clean(e.inviteeFirstName);
      const verb = e.answer === "accepted" ? "accepted" : "declined";
      return withEvent(e, {
        heading: e.answer === "accepted" ? "Invitation accepted" : "Invitation declined",
        subject: fitSubject(`${who} ${verb} your invite to `, clean(e.eventTitle)),
        preheader: `${who} ${verb} your invite to ${clean(e.eventTitle)}.`,
        lead: `${who} ${verb} your invite to this event.`,
        note: null,
      });
    }
    case "event_changed": {
      const e = variables as TemplateVariables["event_changed"];
      const what = joinWords(changedWords(e, zone));
      const subjectWhat = joinWords(changedWords(e, zone, true));
      return withEvent(e, {
        heading: "Event updated",
        subject: fitSubject("Updated: ", clean(e.eventTitle), ` (${subjectWhat} changed)`),
        preheader: `The ${what} changed for ${clean(e.eventTitle)}.`,
        lead: `the ${what} changed for this event.`,
        note: null,
        badge: "Updated",
      });
    }
    case "event_canceled": {
      const e = variables as TemplateVariables["event_canceled"];
      return withEvent(e, {
        heading: "Event canceled",
        subject: fitSubject("Canceled: ", clean(e.eventTitle)),
        preheader: `${clean(e.eventTitle)} was canceled.`,
        lead: "this event was canceled.",
        note: "Browse other events.",
      });
    }
    case "attendee_added": {
      const e = variables as TemplateVariables["attendee_added"];
      return withEvent(e, {
        heading: "You were added",
        subject: fitSubject("You were added to ", clean(e.eventTitle)),
        preheader: `You are on the guest list for ${clean(e.eventTitle)}.`,
        lead: "you were added to this event.",
        note: null,
      });
    }
    case "event_reminder": {
      const e = variables as TemplateVariables["event_reminder"];
      const day = e.window === "24h";
      return withEvent(e, {
        heading: day ? "Starts tomorrow" : "Starts in about an hour",
        subject: fitSubject(day ? "Tomorrow: " : "Starting in about an hour: ", clean(e.eventTitle)),
        preheader: day ? `${clean(e.eventTitle)} is tomorrow.` : `${clean(e.eventTitle)} starts in about an hour.`,
        lead: day ? `${clean(e.eventTitle)} starts tomorrow.` : `${clean(e.eventTitle)} starts in about an hour.`,
        note: null,
      });
    }
    case "challenge_reviewed": {
      const e = variables as TemplateVariables["challenge_reviewed"];
      const title = clean(e.challengeTitle);
      const approved = e.outcome === "approved";
      const points = approved && typeof e.points === "number" && e.points > 0 ? e.points : null;
      return {
        heading: approved ? "Submission approved" : "Changes requested",
        subject: fitSubject(approved ? "Approved: " : "Changes requested: ", title),
        preheader: approved ? `Your submission for ${title} was approved.` : `A reviewer asked for changes to ${title}.`,
        lead: approved ? `your submission for \u201C${title}\u201D was approved.` : `a reviewer asked for changes to your submission for \u201C${title}\u201D.`,
        badge: null,
        event: null,
        highlight: points !== null ? `+${points} ${points === 1 ? "point" : "points"}` : null,
        note: approved ? null : "See the feedback and resubmit.",
        ctaLabel: "Open in DIP",
        ctaURL: `${SHARE_ORIGIN}/`,
      };
    }
  }
}
