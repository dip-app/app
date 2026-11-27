import { SHARE_ORIGIN, collapseWhitespace } from "../../../share/domain/sharePage";
import { intlTag, splitAround, type Locale } from "../../../i18n";
import type { EmailCategory } from "../categories";
import { tEmail, type EmailMessageKey } from "./i18n";
import type { EventFacts, SuggestionTheme, TemplateId, TemplateVariables } from "./types";

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
  weekly_themes: categoryReason("weekly_themes"),
  admin_digest: categoryReason("admin_digest"),
  day_before_reminders: categoryReason("day_before_reminders"),
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
  /** Short list after the lead (welcome steps), or absent. */
  steps?: string[];
  /** Small muted line after the button ("Not expecting this? ..."), or absent. */
  fine?: string;
  /** Text inside `note` shown in bold in the HTML part (the address to sign in with), or absent. */
  emphasis?: string;
  /**
   * Account emails only: the footer reason sentence (replaces "You are getting this because <category> emails are on.")
   * and whether the "Manage in DIP: Profile > Notifications" path is shown (a roster invitee has no account yet).
   * `manageLink` replaces that path with a link (the admin digest is managed in the admin portal).
   */
  footer?: { reason: string; manage: boolean; unsubscribeLabel?: string; manageLink?: { label: string; url: string } };
  /**
   * Theme card (weekly_theme): catalog art tile on the theme accent, the title in the heading font, the description and
   * up to two short lines (dates, points). `artURL` null renders the card without art.
   */
  theme?: { artURL: string | null; accent: string; title: string; body: string | null; lines: string[] };
  /** Labeled bullet lists after the lead (admin_digest). */
  sections?: Array<{ label: string; items: string[] }>;
}

/** Sign-in links of the account emails: members use the app (the site links the App Store), organizers and admins the portal. */
export const APP_URL = `${SHARE_ORIGIN}/`;
export const PORTAL_URL = `${SHARE_ORIGIN}/admin/`;
/** Admin digest links: the roster page and Your settings, where the digest is switched on and off. */
export const ROSTER_URL = `${SHARE_ORIGIN}/admin/roster/`;
export const SETTINGS_URL = `${SHARE_ORIGIN}/admin/account/`;

/** Weekly theme accents (apps/admin/public/img/themes/ACCENTS.md), also the art tile background while images load. */
export const THEME_ACCENT: Readonly<Record<SuggestionTheme, string>> = {
  fitness: "#FB72E4", outdoors: "#6BE5D0", food: "#FF7C73", arts: "#7B88FA", games: "#FFCC3E",
  music: "#66D9FF", learning: "#6BFF9B", volunteering: "#1E212B", wellness: "#FF7C73",
};
/** Neutral tile color for a theme without known art. */
const NEUTRAL_ACCENT = "#E8EAF8";

/** Art tile of a catalog theme (the same 224x224 tiles as the ideas email, `ideas/<key>.png`). */
export function themeArtURL(key: SuggestionTheme): string {
  return `${SHARE_ORIGIN}/img/email/ideas/${key}.png`;
}

/** "Thursday, November 19" for a `YYYY-MM-DD` day key (a calendar day, so formatted in UTC). */
export function dayLabel(dayKey: string, locale: Locale): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return new Intl.DateTimeFormat(intlTag(locale), { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

/** "2:15 PM EST" (Spanish "2:15 p.m. EST"): a clock time in the zone with the US zone abbreviation, as the event emails show it. */
function clockWithZone(iso: string, zone: string, locale: Locale): string {
  const date = new Date(iso);
  const clock = new Intl.DateTimeFormat(intlTag(locale), { hour: "numeric", minute: "2-digit", timeZone: zone }).format(date);
  const abbr = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", hour: "numeric", timeZone: zone }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? zone;
  return `${clock} ${abbr}`.replace(/[\u00a0\u202f]/g, " ");
}

/** "Mon, Nov 23" in the zone; the end is exclusive, so a midnight end shows the day before. */
function themeDay(iso: string, zone: string, locale: Locale, exclusiveEnd = false): string {
  const date = new Date(new Date(iso).getTime() - (exclusiveEnd ? 1 : 0));
  return new Intl.DateTimeFormat(intlTag(locale), { weekday: "short", month: "short", day: "numeric", timeZone: zone }).format(date).replace(/[\u00a0\u202f]/g, " ");
}

const isStaff = (role: string): boolean => role === "organizer" || role === "admin";


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
export function buildCopy<T extends TemplateId>(template: T, variables: TemplateVariables[T], zone = "America/New_York", locale: Locale = "en", recipientAddress?: string | null): EmailCopy {
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
    case "roster_invite": {
      const e = variables as TemplateVariables["roster_invite"];
      const company = clean(e.companyName);
      const who = e.inviterFirstName ? clean(e.inviterFirstName) : "";
      const named = who ? "yes" : "no";
      const staff = isStaff(e.role) ? "yes" : "no";
      const address = recipientAddress?.trim() || t("email.rosterInvite.thisAddress");
      return {
        heading: t("email.rosterInvite.heading", { reminder: e.reminder ? "yes" : "no" }),
        subject: subject(locale, "email.rosterInvite.subject", company, { reminder: e.reminder ? "yes" : "no", named, who }),
        preheader: t("email.rosterInvite.preheader", { named, who, company }),
        lead: t("email.rosterInvite.lead", { named, who, company }),
        badge: null,
        event: null,
        highlight: null,
        note: t("email.rosterInvite.note", { staff, address }),
        ...(recipientAddress?.trim() ? { emphasis: address } : {}),
        ctaLabel: staff === "yes" ? t("email.cta.portal") : t("email.cta.getApp"),
        ctaURL: staff === "yes" ? PORTAL_URL : APP_URL,
        fine: t("email.rosterInvite.ignore"),
        footer: { reason: t("email.rosterInvite.reason", { named, who, company }), manage: false, unsubscribeLabel: t("email.footer.unsubscribeInvites") },
      };
    }
    case "welcome": {
      const e = variables as TemplateVariables["welcome"];
      const company = clean(e.companyName);
      const staff = isStaff(e.role);
      return {
        heading: t("email.welcome.heading"),
        subject: subject(locale, "email.welcome.subject", company),
        preheader: t("email.welcome.preheader", { company }),
        lead: t("email.welcome.lead", { company }),
        badge: null,
        event: null,
        highlight: null,
        note: null,
        steps: [
          ...(staff ? [t("email.welcome.step.portal")] : []),
          t("email.welcome.step.join"), t("email.welcome.step.interests"),
        ],
        ctaLabel: staff ? t("email.cta.portal") : t("email.cta.openApp"),
        ctaURL: staff ? PORTAL_URL : APP_URL,
        footer: { reason: t("email.welcome.reason", { company }), manage: true },
      };
    }
    case "weekly_theme": {
      const e = variables as TemplateVariables["weekly_theme"];
      const title = clean(e.themeTitle);
      const lines = [t("email.weeklyTheme.dates", { start: themeDay(e.startDate, zone, locale), end: themeDay(e.endDate, zone, locale, true) })];
      if (typeof e.pointsReward === "number" && e.pointsReward > 0) lines.push(t("email.weeklyTheme.points", { points: e.pointsReward }));
      return {
        heading: t("email.weeklyTheme.heading"),
        subject: subject(locale, "email.weeklyTheme.subject", title),
        preheader: t("email.weeklyTheme.preheader", { dates: lines[0]! }),
        lead: t("email.weeklyTheme.lead"),
        badge: null,
        event: null,
        highlight: null,
        theme: {
          artURL: e.themeKey ? themeArtURL(e.themeKey) : null,
          accent: e.themeKey ? THEME_ACCENT[e.themeKey] : NEUTRAL_ACCENT,
          title,
          body: e.themeDescription ? clean(e.themeDescription) : null,
          lines,
        },
        note: t("email.weeklyTheme.note"),
        ctaLabel: t("email.cta.openApp"),
        ctaURL: APP_URL,
      };
    }
    case "admin_digest": {
      const e = variables as TemplateVariables["admin_digest"];
      const day = dayLabel(e.dayKey, locale);
      const summaryParts: string[] = [];
      if (e.joined.count > 0) summaryParts.push(t("email.adminDigest.summary.joined", { count: e.joined.count }));
      if (e.importCount > 0) summaryParts.push(t("email.adminDigest.summary.imports", { count: e.importCount }));
      const summary = joinWords(summaryParts, locale);
      const sections: NonNullable<EmailCopy["sections"]> = [];
      if (e.joined.count > 0) {
        const names = e.joined.names.map(clean);
        const rest = e.joined.count - names.length;
        const items = names.length > 0
          ? [...names, ...(rest > 0 ? [t("email.adminDigest.joined.more", { count: rest })] : [])]
          : [t("email.adminDigest.joined.unnamed", { count: e.joined.count })];
        sections.push({ label: t("email.adminDigest.joined.label", { count: e.joined.count }), items });
      }
      if (e.importCount > 0) {
        const items = e.imports.map((i) => t("email.adminDigest.import", { time: clockWithZone(i.finishedAt, zone, locale), invited: i.invited, updated: i.updated, failed: i.failed }));
        const rest = e.importCount - e.imports.length;
        if (rest > 0) items.push(t("email.adminDigest.imports.more", { count: rest }));
        sections.push({ label: t("email.adminDigest.imports.label", { count: e.importCount }), items });
      }
      return {
        heading: t("email.adminDigest.heading"),
        subject: fitSubject(t("email.adminDigest.subject", { day }), ""),
        preheader: t("email.adminDigest.preheader", { summary: summary.charAt(0).toLocaleUpperCase(intlTag(locale)) + summary.slice(1), day }),
        lead: t("email.adminDigest.lead", { day }),
        badge: null,
        event: null,
        highlight: null,
        note: null,
        sections,
        ctaLabel: t("email.adminDigest.cta"),
        ctaURL: ROSTER_URL,
        footer: { reason: t("email.adminDigest.reason"), manage: false, manageLink: { label: t("email.adminDigest.manage"), url: SETTINGS_URL } },
      };
    }
    case "bug_report_resolved": {
      const e = variables as TemplateVariables["bug_report_resolved"];
      const day = new Intl.DateTimeFormat(intlTag(locale), { month: "long", day: "numeric", timeZone: zone }).format(new Date(e.submittedAt));
      return {
        heading: t("email.bugResolved.heading"),
        subject: t("email.bugResolved.subject"),
        preheader: t("email.bugResolved.preheader", { day }),
        lead: t("email.bugResolved.lead", { day }),
        badge: null,
        event: null,
        highlight: null,
        note: t("email.bugResolved.note"),
        ctaLabel: t("email.cta.openApp"),
        ctaURL: APP_URL,
        footer: { reason: t("email.bugResolved.reason"), manage: true },
      };
    }
  }
}
