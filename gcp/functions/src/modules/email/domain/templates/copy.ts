import { SHARE_ORIGIN, collapseWhitespace } from "../../../share/domain/sharePage";
import type { EmailCategory } from "../categories";
import type { EventFacts, TemplateId, TemplateVariables } from "./types";

/** Deep link to one event; the Hosting rewrite opens the app or the share page. */
export function eventURL(eventId: string): string {
  return `${SHARE_ORIGIN}/e/${encodeURIComponent(eventId)}`;
}

export const SUBJECT_MAX = 78;

/** Why the footer says the member receives this email, per category. */
export const CATEGORY_REASON: Readonly<Record<EmailCategory, string>> = {
  invites: "you have invite emails turned on in DIP",
  event_updates: "you have event update emails turned on in DIP",
  reminders: "you turned on event reminder emails in DIP",
  challenges: "you have challenge emails turned on in DIP",
};

/** Plain-text pieces of one email, before layout. Everything here is unescaped. */
export interface EmailCopy {
  subject: string;
  preheader: string;
  /** Short lead sentence shown under the greeting. */
  lead: string;
  /** Event facts to show as a compact card, or null. */
  event: EventFacts | null;
  /** Extra sentence after the card. */
  note: string | null;
  ctaLabel: string;
  ctaURL: string;
}

const CHANGED_WORDS = { time: "time", venue: "location", title: "title", details: "details" } as const;

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

function withEvent(facts: EventFacts, rest: Pick<EmailCopy, "subject" | "preheader" | "lead" | "note">): EmailCopy {
  return { ...rest, event: facts, ctaLabel: "Open in DIP", ctaURL: eventURL(facts.eventId) };
}

export function buildCopy<T extends TemplateId>(template: T, variables: TemplateVariables[T]): EmailCopy {
  const id: TemplateId = template;
  switch (id) {
    case "invite_received": {
      const e = variables as TemplateVariables["invite_received"];
      const who = clean(e.inviterFirstName);
      return withEvent(e, {
        subject: fitSubject(`${who} invited you to `, clean(e.eventTitle)),
        preheader: `${who} invited you. Open DIP to respond.`,
        lead: `${who} invited you to join an event on DIP.`,
        note: "Open the event to see who else is going and to respond.",
      });
    }
    case "invite_answered": {
      const e = variables as TemplateVariables["invite_answered"];
      const who = clean(e.inviteeFirstName);
      const verb = e.answer === "accepted" ? "accepted" : "declined";
      return withEvent(e, {
        subject: fitSubject(`${who} ${verb} your invite to `, clean(e.eventTitle)),
        preheader: `${who} ${verb} your invite.`,
        lead: `${who} ${verb} your invite to this event.`,
        note: null,
      });
    }
    case "event_changed": {
      const e = variables as TemplateVariables["event_changed"];
      const words = e.changedFields.map((f) => CHANGED_WORDS[f]);
      const what = joinWords(words.length ? words : ["details"]);
      return withEvent(e, {
        subject: fitSubject("Updated: ", clean(e.eventTitle)),
        preheader: `The ${what} changed. Review the latest details.`,
        lead: `The ${what} of this event changed.`,
        note: "The latest details are below.",
      });
    }
    case "event_canceled": {
      const e = variables as TemplateVariables["event_canceled"];
      return withEvent(e, {
        subject: fitSubject("Canceled: ", clean(e.eventTitle)),
        preheader: "This event was canceled.",
        lead: "This event was canceled.",
        note: "Open DIP to find something else to join.",
      });
    }
    case "attendee_added": {
      const e = variables as TemplateVariables["attendee_added"];
      return withEvent(e, {
        subject: fitSubject("You were added to ", clean(e.eventTitle)),
        preheader: "You are on the guest list. See the details.",
        lead: "You were added to this event.",
        note: null,
      });
    }
    case "event_reminder": {
      const e = variables as TemplateVariables["event_reminder"];
      const day = e.window === "24h";
      return withEvent(e, {
        subject: fitSubject(day ? "Tomorrow: " : "Starting in about an hour: ", clean(e.eventTitle)),
        preheader: day ? "Your event is tomorrow." : "Your event starts in about an hour.",
        lead: day ? "This event is tomorrow." : "This event starts in about an hour.",
        note: null,
      });
    }
    case "challenge_reviewed": {
      const e = variables as TemplateVariables["challenge_reviewed"];
      const title = clean(e.challengeTitle);
      const approved = e.outcome === "approved";
      const points = approved && typeof e.points === "number" && e.points > 0 ? e.points : null;
      return {
        subject: fitSubject(approved ? "Approved: " : "Changes requested: ", title),
        preheader: approved ? "Your challenge submission was approved." : "A reviewer asked for changes to your submission.",
        lead: approved
          ? `Your submission for "${title}" was approved.`
          : `A reviewer asked for changes to your submission for "${title}".`,
        event: null,
        note:
          points !== null
            ? `You earned ${points} ${points === 1 ? "point" : "points"}.`
            : approved
              ? null
              : "Open DIP to see the feedback and resubmit.",
        ctaLabel: "Open DIP",
        ctaURL: `${SHARE_ORIGIN}/`,
      };
    }
  }
}
