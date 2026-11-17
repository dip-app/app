import { SHARE_ORIGIN, collapseWhitespace, escapeHtml } from "../../../share/domain/sharePage";
import { EMAIL_ASSET_BASE, FINE, HAIRLINE, INK, MUTED, FONT, HEAD_FONT, STRIKE, SUPPORT_EMAIL, layoutShell, primaryButton } from "./layout";
import { renderAdminSuggestions, validateAdminSuggestions } from "./adminSuggestions";
import { buildCopy, CATEGORY_REASON, changeSummary, eventURL, hasVisibleChange } from "./copy";
import { TEMPLATE_CATEGORY, type EventFacts, type RenderContext, type RenderedEmail, type TemplateId, type TemplateVariables } from "./types";

export { eventURL, hasVisibleChange, EMAIL_ASSET_BASE };

const FALLBACK_ZONE = "America/New_York";
const TITLE_MAX = 200;
const NAME_MAX = 80;
const VENUE_MAX = 120;
const ADDRESS_MAX = 200;
const ID_MAX = 128;
const URL_MAX = 1024;

// ---------------------------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------------------------

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

const norm = (s: string): string => s.replace(/[  ]/g, " ");

/** "Thu, Nov 20, 6:30 PM to 8:00 PM EST". The zone abbreviation is always shown. Invalid input yields "". */
export function formatEventTime(startISO: string, endISO: string, timeZone: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime())) return "";
  const zone = safeZone(timeZone);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone });
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  const abbr =
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short", hour: "numeric", timeZone: zone })
      .formatToParts(start)
      .find((p) => p.type === "timeZoneName")?.value ?? zone;
  const startDay = norm(day.format(start));
  const startClock = norm(clock.format(start));
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return `${startDay}, ${startClock} ${abbr}`;
  const endDay = norm(day.format(end));
  const endClock = norm(clock.format(end));
  return endDay === startDay
    ? `${startDay}, ${startClock} to ${endClock} ${abbr}`
    : `${startDay}, ${startClock} to ${endDay}, ${endClock} ${abbr}`;
}

// ---------------------------------------------------------------------------------------------
// Validation (strict allow-list)
// ---------------------------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const FIELDS = ["time", "venue", "title", "details"] as const;

type Rec = Record<string, unknown>;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = collapseWhitespace(v);
  return s.length >= 1 && s.length <= max ? s : null;
}

function iso(v: unknown): string | null {
  return typeof v === "string" && ISO.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : null;
}

function onlyKeys(rec: Rec, allowed: readonly string[]): boolean {
  return Object.keys(rec).every((k) => allowed.includes(k));
}

const EVENT_KEYS = ["eventId", "eventTitle", "startTime", "endTime", "venueName", "venueAddress", "coverImageURL", "revision"] as const;

const PREVIOUS_KEYS = ["startTime", "endTime", "venueName", "venueAddress", "eventTitle"] as const;

function previousValues(v: unknown): TemplateVariables["event_changed"]["previous"] | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const rec = v as Rec;
  if (!onlyKeys(rec, PREVIOUS_KEYS)) return null;
  const out: NonNullable<TemplateVariables["event_changed"]["previous"]> = {};
  for (const k of ["startTime", "endTime"] as const) {
    if (rec[k] === undefined) continue;
    const t = iso(rec[k]);
    if (!t) return null;
    out[k] = t;
  }
  for (const [k, max] of [["venueName", VENUE_MAX], ["venueAddress", ADDRESS_MAX], ["eventTitle", TITLE_MAX]] as const) {
    if (rec[k] === undefined) continue;
    const t = str(rec[k], max);
    if (!t) return null;
    out[k] = t;
  }
  return out;
}

function eventFacts(rec: Rec): EventFacts | null {
  const eventId = typeof rec.eventId === "string" && ID.test(rec.eventId) ? rec.eventId : null;
  const eventTitle = str(rec.eventTitle, TITLE_MAX);
  const startTime = iso(rec.startTime);
  const endTime = iso(rec.endTime);
  if (!eventId || !eventTitle || !startTime || !endTime) return null;
  const out: EventFacts = { eventId, eventTitle, startTime, endTime };
  if (rec.venueName !== undefined) {
    const venue = str(rec.venueName, VENUE_MAX);
    if (!venue) return null;
    out.venueName = venue;
  }
  if (rec.venueAddress !== undefined) {
    const address = str(rec.venueAddress, ADDRESS_MAX);
    if (!address) return null;
    out.venueAddress = address;
  }
  if (rec.coverImageURL !== undefined) {
    if (typeof rec.coverImageURL !== "string" || rec.coverImageURL.length > URL_MAX) return null;
    out.coverImageURL = rec.coverImageURL;
  }
  if (rec.revision !== undefined) {
    if (typeof rec.revision !== "number" || !Number.isInteger(rec.revision) || rec.revision < 0 || rec.revision > 1_000_000) return null;
    out.revision = rec.revision;
  }
  return out;
}

/**
 * Strict allow-list check of stored template variables. Returns a NEW object holding only the allowed keys, or null
 * when anything is unknown, mistyped, overlong, out of enum or not an ISO date.
 */
export function validateVariables<T extends TemplateId>(template: T, value: unknown): TemplateVariables[T] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const rec = value as Rec;
  const id: TemplateId = template;
  let result: TemplateVariables[TemplateId] | null = null;
  switch (id) {
    case "admin_suggestions": {
      result = validateAdminSuggestions(rec);
      break;
    }
    case "invite_received": {
      if (!onlyKeys(rec, [...EVENT_KEYS, "inviterFirstName"])) return null;
      const facts = eventFacts(rec);
      const inviterFirstName = str(rec.inviterFirstName, NAME_MAX);
      result = facts && inviterFirstName ? { ...facts, inviterFirstName } : null;
      break;
    }
    case "invite_answered": {
      if (!onlyKeys(rec, [...EVENT_KEYS, "inviteeFirstName", "answer"])) return null;
      const facts = eventFacts(rec);
      const inviteeFirstName = str(rec.inviteeFirstName, NAME_MAX);
      const answer = rec.answer === "accepted" || rec.answer === "declined" ? rec.answer : null;
      result = facts && inviteeFirstName && answer ? { ...facts, inviteeFirstName, answer } : null;
      break;
    }
    case "event_changed": {
      if (!onlyKeys(rec, [...EVENT_KEYS, "changedFields", "previous"])) return null;
      const previous = previousValues(rec.previous);
      if (previous === null) return null;
      const facts = eventFacts(rec);
      const raw = rec.changedFields;
      if (!facts || !Array.isArray(raw) || raw.length < 1 || raw.length > FIELDS.length) return null;
      const fields: Array<(typeof FIELDS)[number]> = [];
      for (const f of raw) {
        const match = FIELDS.find((x) => x === f);
        if (!match || fields.includes(match)) return null;
        fields.push(match);
      }
      result = previous ? { ...facts, changedFields: fields, previous } : { ...facts, changedFields: fields };
      break;
    }
    case "event_canceled":
    case "attendee_added": {
      if (!onlyKeys(rec, EVENT_KEYS)) return null;
      result = eventFacts(rec);
      break;
    }
    case "event_reminder": {
      if (!onlyKeys(rec, [...EVENT_KEYS, "window"])) return null;
      const facts = eventFacts(rec);
      const window = rec.window === "24h" || rec.window === "1h" ? rec.window : null;
      result = facts && window ? { ...facts, window } : null;
      break;
    }
    case "challenge_reviewed": {
      if (!onlyKeys(rec, ["challengeId", "challengeTitle", "outcome", "points"])) return null;
      const challengeId = typeof rec.challengeId === "string" && ID.test(rec.challengeId) ? rec.challengeId : null;
      const challengeTitle = str(rec.challengeTitle, TITLE_MAX);
      const outcome = rec.outcome === "approved" || rec.outcome === "changes_requested" ? rec.outcome : null;
      if (!challengeId || !challengeTitle || !outcome) return null;
      const out: TemplateVariables["challenge_reviewed"] = { challengeId, challengeTitle, outcome };
      if (rec.points !== undefined) {
        if (typeof rec.points !== "number" || !Number.isInteger(rec.points) || rec.points < 0 || rec.points > 1_000_000) return null;
        out.points = rec.points;
      }
      result = out;
      break;
    }
  }
  return result as TemplateVariables[T] | null;
}

// ---------------------------------------------------------------------------------------------
// Layout (admin-site look: ink on white, hairlines, small radii, purple only on the primary button)
// ---------------------------------------------------------------------------------------------

const PREHEADER_MAX = 110;

/** One complete sentence: the copy sentence plus the event day when it fits; cut only at a word boundary, no ellipsis. */
function buildPreheader(template: TemplateId, sentence: string, when: string): string {
  const day = when.split(/, \d/)[0] ?? "";
  if (template !== "event_reminder" && day) {
    const withDay = `${sentence.replace(/\.$/, "")} on ${day}.`;
    if (withDay.length <= PREHEADER_MAX) return withDay;
  }
  if (sentence.length <= PREHEADER_MAX) return sentence;
  const cut = sentence.slice(0, PREHEADER_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/u, "")}.`;
}

function greeting(ctx: RenderContext): string {
  const name = ctx.recipientFirstName ? collapseWhitespace(ctx.recipientFirstName).slice(0, NAME_MAX) : "";
  return name ? `Hi ${name},` : "Hi there,";
}

/**
 * Renders one transactional email to subject, preheader, table-based HTML and a plain-text alternative.
 * Cover images are intentionally not rendered (too dominant, and Outlook cannot crop); `coverImageURL` stays in the
 * allow-list. The header and footer art are fixed brand assets, not event content.
 */
export function renderEmail<T extends TemplateId>(template: T, variables: TemplateVariables[T], ctx: RenderContext): RenderedEmail {
  if (template === "admin_suggestions") return renderAdminSuggestions(variables as TemplateVariables["admin_suggestions"], ctx);
  const zone = safeZone(ctx.timeZone);
  const copy = buildCopy(template, variables, zone);
  const hello = greeting(ctx);
  const reason = CATEGORY_REASON[TEMPLATE_CATEGORY[template]];

  const facts = copy.event;
  const title = facts ? collapseWhitespace(facts.eventTitle) : null;
  const when = facts ? formatEventTime(facts.startTime, facts.endTime, zone) : "";
  const venue = facts?.venueName ? collapseWhitespace(facts.venueName) : null;
  const address = facts?.venueAddress ? collapseWhitespace(facts.venueAddress) : null;

  // Old values for event_changed, only for fields that visibly changed.
  let oldTitle: string | null = null;
  let oldTime: string | null = null;
  let oldVenue: string | null = null;
  let oldAddress: string | null = null;
  if (template === "event_changed") {
    const v = variables as TemplateVariables["event_changed"];
    const c = changeSummary(v, zone);
    const prev = v.previous;
    if (c.title && prev?.eventTitle) oldTitle = collapseWhitespace(prev.eventTitle);
    if (c.time && prev && (prev.startTime !== undefined || prev.endTime !== undefined)) {
      const full = formatEventTime(prev.startTime ?? v.startTime, prev.endTime ?? v.endTime, zone);
      const dayOf = (t: string): string => t.split(/, \d/)[0] ?? "";
      const newDay = dayOf(when);
      oldTime = full && dayOf(full) === newDay && full.startsWith(`${newDay}, `) ? full.slice(newDay.length + 2) : full || null;
    }
    if (c.venueName && prev?.venueName) oldVenue = collapseWhitespace(prev.venueName);
    if (c.venueAddress && prev?.venueAddress) oldAddress = collapseWhitespace(prev.venueAddress);
  }
  const lead = `${hello} ${copy.lead}`;
  const preheader = buildPreheader(template, copy.preheader, when);

  const e = escapeHtml;
  const para = (text: string, margin = "16px"): string =>
    `<p class="text-main" style="margin:0 0 ${margin} 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(text)}</p>`;

  const nb = (t: string): string => e(t).replace(/(\d) (AM|PM)\b/g, "$1&nbsp;$2").replace(/(AM|PM) ([A-Z]{2,5}(?:[+-]\d+)?)$/, "$1&nbsp;$2");
  const old = (value: string | null, nbsp = false): string =>
    value
      ? `<div dir="auto" style="margin:0 0 2px 0;"><del style="text-decoration:line-through;color:${STRIKE};"><span style="position:absolute;display:inline-block;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;font-size:1px;line-height:1px;color:transparent;text-decoration:none;">was </span><span dir="auto">${nbsp ? nb(value) : e(value)}</span></del></div>`
      : "";
  const row = (label: string, value: string, first: boolean): string =>
    `<tr><td class="lbl text-muted${first ? "" : " border"}" valign="top" width="64" style="width:64px;padding:10px 12px 10px 0;${first ? "" : `border-top:1px solid ${HAIRLINE};`}font-family:${FONT};font-size:12px;line-height:20px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${label}</td><td dir="auto" class="text-main${first ? "" : " border"}" valign="top" style="padding:10px 0;${first ? "" : `border-top:1px solid ${HAIRLINE};`}font-family:${FONT};font-size:15px;line-height:20px;color:${INK};">${value}</td></tr>`;

  const pill = copy.badge
    ? `<div style="margin:0 0 10px 0;"><span class="pill border" style="display:inline-block;padding:2px 10px;border:1px solid ${HAIRLINE};border-radius:999px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${INK};">${e(copy.badge)}</span></div>`
    : "";
  const whenHtml = `${old(oldTime, true)}<span dir="auto">${nb(when)}</span>`;
  const nameHtml = venue ? `<div><span dir="auto">${e(venue)}</span></div>` : "";
  const whereHtml = [
    oldVenue && oldAddress ? `${old(oldVenue)}${old(oldAddress)}${nameHtml}` : `${old(oldVenue)}${nameHtml}${old(oldAddress)}`,
    address ? `<div class="text-muted" style="font-size:14px;line-height:20px;color:${MUTED};"><span dir="auto">${e(address)}</span></div>` : "",
  ].join("");
  const detailRows = [when ? row("When", whenHtml, true) : "", venue || address ? row("Where", whereHtml, !when) : ""].join("");
  const card =
    facts && title
      ? `${pill}${old(oldTitle)}<p dir="auto" class="text-main" style="margin:0 0 8px 0;font-family:${FONT};font-size:18px;line-height:26px;font-weight:700;color:${INK};"><span dir="auto">${e(title)}</span></p>
${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="border" style="margin:0 0 20px 0;border-top:1px solid ${HAIRLINE};border-bottom:1px solid ${HAIRLINE};">${detailRows}</table>` : `<div style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>`}`
      : "";

  const highlight = copy.highlight
    ? `<p class="text-main" style="margin:0 0 16px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${e(copy.highlight)}</p>`
    : "";

  const button = primaryButton(copy.ctaURL, copy.ctaLabel);

  const html = layoutShell({
    title: copy.subject,
    preheader,
    ctx,
    main: `<h1 class="text-main" style="margin:0 0 12px 0;font-family:${HEAD_FONT};font-size:24px;line-height:30px;font-weight:normal;letter-spacing:0.02em;color:${INK};">${e(copy.heading)}</h1>
${para(lead, "20px")}
${card}
${copy.note ? para(copy.note, "20px") : ""}
${highlight}
${button}`,
    footerRows: `<tr><td class="text-muted" style="padding:0;${FINE}">You are getting this because ${e(reason)} emails are on.</td></tr>
<tr><td class="text-muted" style="padding:12px 0;${FINE}"><a class="link" href="${e(ctx.unsubscribeURL)}" style="color:${INK};text-decoration:underline;">Unsubscribe</a> &middot; Manage in DIP: Profile&nbsp;&gt;&nbsp;Notifications</td></tr>
<tr><td class="text-muted" style="padding:0;${FINE}">Sent by DIP &middot; Questions? <a class="link" href="mailto:${SUPPORT_EMAIL}" style="color:${INK};text-decoration:underline;">${SUPPORT_EMAIL}</a></td></tr>`,
  });

  const lines: string[] = [copy.heading.toUpperCase(), "", lead, ""];
  if (facts && title) {
    if (copy.badge) lines.push(`[${copy.badge}]`);
    lines.push(`${title}${oldTitle ? `  (was: ${oldTitle})` : ""}`);
    if (when) lines.push(`When: ${when}${oldTime ? `  (was: ${oldTime})` : ""}`);
    if (venue || address) {
      if (venue) lines.push(`Where: ${venue}${oldVenue ? `  (was: ${oldVenue})` : ""}`);
      if (address) lines.push(`${venue ? "       " : "Where: "}${address}${oldAddress ? `  (was: ${oldAddress})` : ""}`);
    }
    lines.push("");
  }
  if (copy.note) lines.push(copy.note, "");
  if (copy.highlight) lines.push(copy.highlight, "");
  lines.push(`${copy.ctaLabel}: ${copy.ctaURL}`, "", "--");
  lines.push(`You are getting this because ${reason} emails are on.`);
  lines.push(`Unsubscribe: ${ctx.unsubscribeURL}`);
  lines.push("Manage in DIP: Profile > Notifications");
  lines.push(`Sent by DIP · Questions? ${SUPPORT_EMAIL}`);

  return { subject: copy.subject, preheader, html, text: `${lines.join("\n")}\n` };
}
