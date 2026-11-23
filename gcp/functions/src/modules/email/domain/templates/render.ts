import { SHARE_ORIGIN, collapseWhitespace, escapeHtml } from "../../../share/domain/sharePage";
import { EMAIL_ASSET_BASE, FINE, HAIRLINE, INK, MUTED, FONT, HEAD_FONT, STRIKE, SUPPORT_EMAIL, layoutShell, primaryButton } from "./layout";
import { renderAdminSuggestions, validateAdminSuggestions } from "./adminSuggestions";
import { intlTag, localeOrDefault, splitAround, type Locale } from "../../../i18n";
import { buildCopy, categoryReason, changeSummary, eventURL, hasVisibleChange } from "./copy";
import { tEmail } from "./i18n";
import type { EmailCategory } from "../categories";
import { SUGGESTION_THEMES, templateCategory, type EventFacts, type RenderContext, type RenderedEmail, type TemplateId, type TemplateVariables } from "./types";

export { eventURL, hasVisibleChange, EMAIL_ASSET_BASE };

const FALLBACK_ZONE = "America/New_York";
const TITLE_MAX = 200;
const NAME_MAX = 80;
const VENUE_MAX = 120;
const ADDRESS_MAX = 200;
const ID_MAX = 128;
const URL_MAX = 1024;
const COMPANY_MAX = 120;
const ROLES = ["member", "organizer", "admin"] as const;

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

/** A formatted event time and its first day ("Thu, Nov 20"), which the preheader and the old-time line reuse. */
interface EventWhen { text: string; startDay: string }

function eventWhen(startISO: string, endISO: string, timeZone: string, locale: Locale): EventWhen {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime())) return { text: "", startDay: "" };
  const zone = safeZone(timeZone);
  const tag = intlTag(locale);
  const day = new Intl.DateTimeFormat(tag, { weekday: "short", month: "short", day: "numeric", timeZone: zone });
  const clock = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: zone });
  // The zone abbreviation stays the US English one in every language ("EST", not "GMT-5"): the existing time zone logic.
  const abbr =
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short", hour: "numeric", timeZone: zone })
      .formatToParts(start)
      .find((p) => p.type === "timeZoneName")?.value ?? zone;
  const startDay = norm(day.format(start));
  const startClock = norm(clock.format(start));
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return { text: `${startDay}, ${startClock} ${abbr}`, startDay };
  const endDay = norm(day.format(end));
  const endClock = norm(clock.format(end));
  const range = (from: string, to: string) => tEmail(locale, "email.time.range", { start: from, end: to });
  return {
    text: endDay === startDay
      ? `${startDay}, ${range(startClock, endClock)} ${abbr}`
      : `${startDay}, ${range(startClock, `${endDay}, ${endClock}`)} ${abbr}`,
    startDay,
  };
}

/**
 * "Thu, Nov 20, 6:30 PM to 8:00 PM EST" (Spanish: "vie, 20 nov, 6:30 p.m. a 8:00 p.m. EST"). Dates and clock times
 * follow the locale through Intl; the zone abbreviation is always shown. Invalid input yields "".
 */
export function formatEventTime(startISO: string, endISO: string, timeZone: string, locale: Locale = "en"): string {
  return eventWhen(startISO, endISO, timeZone, locale).text;
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

const THEME_TITLE_MAX = 120;
export const THEME_DESCRIPTION_MAX = 400;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const DIGEST_NAMES_MAX = 10;
export const DIGEST_IMPORTS_MAX = 5;
const COUNT_MAX = 1_000_000;

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= COUNT_MAX ? v : null);

function weeklyThemeVariables(rec: Rec): TemplateVariables["weekly_theme"] | null {
  if (!onlyKeys(rec, ["challengeId", "themeTitle", "themeDescription", "themeKey", "startDate", "endDate", "pointsReward"])) return null;
  const challengeId = typeof rec.challengeId === "string" && ID.test(rec.challengeId) ? rec.challengeId : null;
  const themeTitle = str(rec.themeTitle, THEME_TITLE_MAX);
  const startDate = iso(rec.startDate);
  const endDate = iso(rec.endDate);
  if (!challengeId || !themeTitle || !startDate || !endDate || new Date(endDate).getTime() <= new Date(startDate).getTime()) return null;
  const out: TemplateVariables["weekly_theme"] = { challengeId, themeTitle, startDate, endDate };
  if (rec.themeDescription !== undefined) {
    const description = str(rec.themeDescription, THEME_DESCRIPTION_MAX);
    if (!description) return null;
    out.themeDescription = description;
  }
  if (rec.themeKey !== undefined) {
    const key = SUGGESTION_THEMES.find((theme) => theme === rec.themeKey);
    if (!key) return null;
    out.themeKey = key;
  }
  if (rec.pointsReward !== undefined) {
    const points = count(rec.pointsReward);
    if (points === null || points > 1000) return null;
    out.pointsReward = points;
  }
  return out;
}

function adminDigestVariables(rec: Rec): TemplateVariables["admin_digest"] | null {
  if (!onlyKeys(rec, ["dayKey", "joined", "imports", "importCount"])) return null;
  const dayKey = typeof rec.dayKey === "string" && DAY_KEY.test(rec.dayKey) && !Number.isNaN(new Date(`${rec.dayKey}T00:00:00Z`).getTime()) ? rec.dayKey : null;
  const joinedRec = rec.joined;
  if (!dayKey || typeof joinedRec !== "object" || joinedRec === null || Array.isArray(joinedRec)) return null;
  const joined = joinedRec as Rec;
  if (!onlyKeys(joined, ["count", "names"])) return null;
  const joinedCount = count(joined.count);
  if (joinedCount === null || !Array.isArray(joined.names) || joined.names.length > DIGEST_NAMES_MAX || joined.names.length > joinedCount) return null;
  const names: string[] = [];
  for (const raw of joined.names) {
    const name = str(raw, NAME_MAX);
    if (!name) return null;
    names.push(name);
  }
  const importCount = count(rec.importCount);
  if (importCount === null || !Array.isArray(rec.imports) || rec.imports.length > DIGEST_IMPORTS_MAX || rec.imports.length > importCount) return null;
  const imports: TemplateVariables["admin_digest"]["imports"] = [];
  for (const raw of rec.imports) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !onlyKeys(raw as Rec, ["invited", "updated", "failed", "finishedAt"])) return null;
    const item = raw as Rec;
    const invited = count(item.invited);
    const updated = count(item.updated);
    const failed = count(item.failed);
    const finishedAt = iso(item.finishedAt);
    if (invited === null || updated === null || failed === null || !finishedAt) return null;
    imports.push({ invited, updated, failed, finishedAt });
  }
  // Nothing to report is never an email.
  if (joinedCount === 0 && importCount === 0) return null;
  return { dayKey, joined: { count: joinedCount, names }, imports, importCount };
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
    case "calendar_invite":
    case "calendar_cancel": {
      if (!onlyKeys(rec, [...EVENT_KEYS, "sequence", "reason"])) return null;
      const facts = eventFacts(rec);
      const sequence = typeof rec.sequence === "number" && Number.isInteger(rec.sequence) && rec.sequence >= 0 && rec.sequence <= 1_000_000 ? rec.sequence : null;
      const allowed = id === "calendar_invite" ? ["joined", "updated"] : ["left", "canceled"];
      const reason = typeof rec.reason === "string" && allowed.includes(rec.reason) ? rec.reason : null;
      result = facts && sequence !== null && reason ? ({ ...facts, sequence, reason } as TemplateVariables["calendar_invite"] | TemplateVariables["calendar_cancel"]) : null;
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
    case "roster_invite": {
      if (!onlyKeys(rec, ["entryId", "companyName", "inviterFirstName", "role", "reminder"])) return null;
      const entryId = typeof rec.entryId === "string" && /^[0-9a-f]{64}$/.test(rec.entryId) ? rec.entryId : null;
      const companyName = str(rec.companyName, COMPANY_MAX);
      const role = ROLES.find((r) => r === rec.role) ?? null;
      if (!entryId || !companyName || !role || typeof rec.reminder !== "boolean") return null;
      const out: TemplateVariables["roster_invite"] = { entryId, companyName, role, reminder: rec.reminder };
      if (rec.inviterFirstName !== undefined) {
        const name = str(rec.inviterFirstName, NAME_MAX);
        if (!name) return null;
        out.inviterFirstName = name;
      }
      result = out;
      break;
    }
    case "welcome": {
      if (!onlyKeys(rec, ["companyName", "role"])) return null;
      const companyName = str(rec.companyName, COMPANY_MAX);
      const role = ROLES.find((r) => r === rec.role) ?? null;
      result = companyName && role ? { companyName, role } : null;
      break;
    }
    case "weekly_theme": {
      result = weeklyThemeVariables(rec);
      break;
    }
    case "admin_digest": {
      result = adminDigestVariables(rec);
      break;
    }
    case "bug_report_resolved": {
      if (!onlyKeys(rec, ["reportId", "submittedAt"])) return null;
      const reportId = typeof rec.reportId === "string" && ID.test(rec.reportId) ? rec.reportId : null;
      const submittedAt = iso(rec.submittedAt);
      result = reportId && submittedAt ? { reportId, submittedAt } : null;
      break;
    }
  }
  return result as TemplateVariables[T] | null;
}

// ---------------------------------------------------------------------------------------------
// Layout (admin-site look: ink on white, hairlines, small radii, purple only on the primary button)
// ---------------------------------------------------------------------------------------------

const PREHEADER_MAX = 110;

/** Theme card classes (weekly_theme only): stacked art on phones, darker card in dark mode. */
const THEME_STYLE = `
  @media (max-width: 620px) {
    .stack { display: block !important; width: 100% !important; box-sizing: border-box !important; }
    .tile-col { padding: 16px 16px 0 16px !important; }
    .theme-text { padding: 14px 16px 16px 16px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .theme-card { background-color: #22242C !important; border-color: #2C2F38 !important; }
  }
  [data-ogsb] .theme-card { background-color: #22242C !important; border-color: #2C2F38 !important; }
`;

/** One complete sentence: the copy sentence plus the event day when it fits; cut only at a word boundary, no ellipsis. */
function buildPreheader(template: TemplateId, sentence: string, day: string, locale: Locale): string {
  if (template !== "event_reminder" && day) {
    const withDay = tEmail(locale, "email.preheader.onDay", { sentence: sentence.replace(/\.$/, ""), day });
    if (withDay.length <= PREHEADER_MAX) return withDay;
  }
  if (sentence.length <= PREHEADER_MAX) return sentence;
  const cut = sentence.slice(0, PREHEADER_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/u, "")}.`;
}

/** "Hi Sam, " + the lead sentence ("¡Hola, Sam! " in Spanish, where the lead starts a new sentence). */
function greetingLead(ctx: RenderContext, locale: Locale, lead: string): string {
  const name = ctx.recipientFirstName ? collapseWhitespace(ctx.recipientFirstName).slice(0, NAME_MAX) : "";
  return name ? tEmail(locale, "email.lead.named", { name, lead }) : tEmail(locale, "email.lead.anonymous", { lead });
}

/** The recipient language of a render; absent or unsupported means English. */
export function renderLocale(ctx: Pick<RenderContext, "locale">): Locale {
  return localeOrDefault(ctx.locale);
}

/**
 * Renders one transactional email to subject, preheader, table-based HTML and a plain-text alternative.
 * Cover images are intentionally not rendered (too dominant, and Outlook cannot crop); `coverImageURL` stays in the
 * allow-list. The header and footer art are fixed brand assets, not event content.
 */
export function renderEmail<T extends TemplateId>(template: T, variables: TemplateVariables[T], ctx: RenderContext): RenderedEmail {
  if (template === "admin_suggestions") return renderAdminSuggestions(variables as TemplateVariables["admin_suggestions"], ctx);
  const locale = renderLocale(ctx);
  const t = (key: Parameters<typeof tEmail>[1], vars: Record<string, string | number> = {}) => tEmail(locale, key, vars);
  const zone = safeZone(ctx.timeZone);
  const copy = buildCopy(template, variables, zone, locale, ctx.recipientAddress);
  const category = templateCategory(template, variables);

  const facts = copy.event;
  const title = facts ? collapseWhitespace(facts.eventTitle) : null;
  const whenParts = facts ? eventWhen(facts.startTime, facts.endTime, zone, locale) : { text: "", startDay: "" };
  const when = whenParts.text;
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
      const full = eventWhen(prev.startTime ?? v.startTime, prev.endTime ?? v.endTime, zone, locale);
      const newDay = whenParts.startDay;
      oldTime = full.text && full.startDay === newDay && full.text.startsWith(`${newDay}, `) ? full.text.slice(newDay.length + 2) : full.text || null;
    }
    if (c.venueName && prev?.venueName) oldVenue = collapseWhitespace(prev.venueName);
    if (c.venueAddress && prev?.venueAddress) oldAddress = collapseWhitespace(prev.venueAddress);
  }
  const lead = greetingLead(ctx, locale, copy.lead);
  const preheader = buildPreheader(template, copy.preheader, whenParts.startDay, locale);

  const e = escapeHtml;
  const para = (text: string, margin = "16px"): string =>
    `<p class="text-main" style="margin:0 0 ${margin} 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(text)}</p>`;

  // Keep "6:30 PM" and "PM EST" (Spanish "6:30 p.m." and "p.m. EST") on one line.
  const nb = (text: string): string => {
    const out = e(text).replace(/(\d) (AM|PM)\b/g, "$1&nbsp;$2").replace(/(AM|PM) ([A-Z]{2,5}(?:[+-]\d+)?)$/, "$1&nbsp;$2");
    return locale === "en" ? out : out.replace(/(\d) ([ap]\.(?: |&nbsp;)?m\.)/g, "$1&nbsp;$2").replace(/(m\.) ([A-Z]{2,5}(?:[+-]\d+)?)$/, "$1&nbsp;$2");
  };
  const was = e(t("email.card.was"));
  const old = (value: string | null, nbsp = false): string =>
    value
      ? `<div dir="auto" style="margin:0 0 2px 0;"><del style="text-decoration:line-through;color:${STRIKE};"><span style="position:absolute;display:inline-block;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;font-size:1px;line-height:1px;color:transparent;text-decoration:none;">${was}</span><span dir="auto">${nbsp ? nb(value) : e(value)}</span></del></div>`
      : "";
  const row = (label: string, value: string, first: boolean): string =>
    `<tr><td class="lbl text-muted${first ? "" : " border"}" valign="top" width="64" style="width:64px;padding:10px 12px 10px 0;${first ? "" : `border-top:1px solid ${HAIRLINE};`}font-family:${FONT};font-size:12px;line-height:20px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${e(label)}</td><td dir="auto" class="text-main${first ? "" : " border"}" valign="top" style="padding:10px 0;${first ? "" : `border-top:1px solid ${HAIRLINE};`}font-family:${FONT};font-size:15px;line-height:20px;color:${INK};">${value}</td></tr>`;

  const pill = copy.badge
    ? `<div style="margin:0 0 10px 0;"><span class="pill border" style="display:inline-block;padding:2px 10px;border:1px solid ${HAIRLINE};border-radius:999px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${INK};">${e(copy.badge)}</span></div>`
    : "";
  const whenLabel = t("email.card.when");
  const whereLabel = t("email.card.where");
  const whenHtml = `${old(oldTime, true)}<span dir="auto">${nb(when)}</span>`;
  const nameHtml = venue ? `<div><span dir="auto">${e(venue)}</span></div>` : "";
  const whereHtml = [
    oldVenue && oldAddress ? `${old(oldVenue)}${old(oldAddress)}${nameHtml}` : `${old(oldVenue)}${nameHtml}${old(oldAddress)}`,
    address ? `<div class="text-muted" style="font-size:14px;line-height:20px;color:${MUTED};"><span dir="auto">${e(address)}</span></div>` : "",
  ].join("");
  const detailRows = [when ? row(whenLabel, whenHtml, true) : "", venue || address ? row(whereLabel, whereHtml, !when) : ""].join("");
  const card =
    facts && title
      ? `${pill}${old(oldTitle)}<p dir="auto" class="text-main" style="margin:0 0 8px 0;font-family:${FONT};font-size:18px;line-height:26px;font-weight:700;color:${INK};"><span dir="auto">${e(title)}</span></p>
${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="border" style="margin:0 0 20px 0;border-top:1px solid ${HAIRLINE};border-bottom:1px solid ${HAIRLINE};">${detailRows}</table>` : `<div style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>`}`
      : "";

  const highlight = copy.highlight
    ? `<p class="text-main" style="margin:0 0 16px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${INK};">${e(copy.highlight)}</p>`
    : "";

  const button = primaryButton(copy.ctaURL, copy.ctaLabel);
  // Account emails only: a short list after the lead and a small line after the button.
  const steps = copy.steps?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">${copy.steps.map((step) => `<tr><td class="text-main" valign="top" width="20" style="width:20px;padding:0 0 8px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">&bull;</td><td class="text-main" valign="top" style="padding:0 0 8px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(step)}</td></tr>`).join("")}</table>`
    : "";
  // Opt-in emails only: labeled lists (admin digest) and the theme card (weekly theme). Absent for every other template.
  const sectionLabel = (label: string): string =>
    `<div class="text-muted" style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:20px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${e(label)}</div>`;
  const sections = copy.sections?.length
    ? copy.sections.map((section) => `${sectionLabel(section.label)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">${section.items.map((item) => `<tr><td class="text-main" valign="top" width="20" style="width:20px;padding:0 0 6px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">&bull;</td><td dir="auto" class="text-main" valign="top" style="padding:0 0 6px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(item).replace(/(\d) (?=\S)/g, "$1&nbsp;")}</td></tr>`).join("")}</table>`).join("\n")
    : "";
  const theme = copy.theme;
  const themeCard = theme
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="theme-card border" style="margin:0 0 20px 0;border:1px solid ${HAIRLINE};border-radius:12px;border-collapse:separate;">
<tr>
${theme.artURL ? `<td class="stack tile-col" width="112" valign="top" style="width:112px;padding:16px 0 16px 16px;"><table role="presentation" width="112" cellpadding="0" cellspacing="0" border="0" style="width:112px;"><tr><td width="112" height="112" bgcolor="${theme.accent}" style="width:112px;height:112px;background-color:${theme.accent};border-radius:8px;font-size:0;line-height:0;"><img src="${e(theme.artURL)}" width="112" height="112" alt="" style="display:block;width:112px;height:112px;border:0;border-radius:8px;" /></td></tr></table></td>\n` : ""}<td class="stack theme-text" valign="top" style="padding:16px;">
<h2 dir="auto" class="text-main" style="margin:0 0 6px 0;padding:0;font-family:${HEAD_FONT};font-size:20px;line-height:26px;font-weight:normal;letter-spacing:0.02em;text-transform:uppercase;color:${INK};">${e(theme.title)}</h2>
${theme.body ? `<p dir="auto" class="text-main" style="margin:0 0 8px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(theme.body)}</p>\n` : ""}${theme.lines.map((line) => `<p class="text-muted" style="margin:0;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};">${e(line)}</p>`).join("\n")}
</td>
</tr>
</table>`
    : "";
  const emphasisAt = copy.emphasis && copy.note ? copy.note.indexOf(copy.emphasis) : -1;
  const noteHtml = (note: string): string => (emphasisAt < 0 || !copy.emphasis
    ? para(note, "20px")
    : `<p class="text-main" style="margin:0 0 20px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(note.slice(0, emphasisAt))}<strong style="font-weight:700;">${e(copy.emphasis)}</strong>${e(note.slice(emphasisAt + copy.emphasis.length))}</p>`);
  const fine = copy.fine ? `<p class="text-muted" style="margin:16px 0 0 0;${FINE}">${e(copy.fine)}</p>` : "";

  const profile = t("email.footer.profile");
  const notifications = t("email.footer.notifications");
  const [managePrefix, manageSuffix] = splitAround(tEmail, locale, "email.footer.manage", "path");
  const reasonLine = copy.footer?.reason ?? t("email.footer.reason", { reason: categoryReason(category as EmailCategory, locale) });
  const showManage = copy.footer?.manage ?? true;
  const unsubscribe = copy.footer?.unsubscribeLabel ?? t("email.footer.unsubscribe");
  const sentBy = t("email.footer.sentBy");
  const questions = t("email.footer.questions");
  const manageLink = copy.footer?.manageLink;
  const manageHtml = manageLink
    ? ` &middot; <a class="link" href="${e(manageLink.url)}" style="color:${INK};text-decoration:underline;">${e(manageLink.label)}</a>`
    : showManage ? ` &middot; ${e(managePrefix)}${e(profile)}&nbsp;&gt;&nbsp;${e(notifications)}${e(manageSuffix)}` : "";

  const html = layoutShell({
    title: copy.subject,
    preheader,
    ctx,
    lang: locale,
    ...(themeCard ? { extraStyle: THEME_STYLE } : {}),
    main: `<h1 class="text-main" style="margin:0 0 12px 0;font-family:${HEAD_FONT};font-size:24px;line-height:30px;font-weight:normal;letter-spacing:0.02em;color:${INK};">${e(copy.heading)}</h1>
${para(lead, "20px")}
${steps ? `${steps}\n` : ""}${sections ? `${sections}\n` : ""}${themeCard ? `${themeCard}\n` : ""}${card}
${copy.note ? noteHtml(copy.note) : ""}
${highlight}
${button}${fine ? `\n${fine}` : ""}`,
    footerRows: `<tr><td class="text-muted" style="padding:0;${FINE}">${e(reasonLine)}</td></tr>
<tr><td class="text-muted" style="padding:12px 0;${FINE}"><a class="link" href="${e(ctx.unsubscribeURL)}" style="color:${INK};text-decoration:underline;">${e(unsubscribe)}</a>${manageHtml}</td></tr>
<tr><td class="text-muted" style="padding:0;${FINE}">${e(sentBy)} &middot; ${e(questions)} <a class="link" href="mailto:${SUPPORT_EMAIL}" style="color:${INK};text-decoration:underline;">${SUPPORT_EMAIL}</a></td></tr>`,
  });

  const wasText = (value: string | null): string => (value ? `  ${t("email.text.was", { value })}` : "");
  const lines: string[] = [copy.heading.toLocaleUpperCase(intlTag(locale)), "", lead, ""];
  if (copy.steps?.length) lines.push(...copy.steps.map((step) => `- ${step}`), "");
  for (const section of copy.sections ?? []) lines.push(section.label, ...section.items.map((item) => `- ${item}`), "");
  if (theme) lines.push(theme.title.toLocaleUpperCase(intlTag(locale)), ...(theme.body ? [theme.body] : []), ...theme.lines, "");
  if (facts && title) {
    if (copy.badge) lines.push(`[${copy.badge}]`);
    lines.push(`${title}${wasText(oldTitle)}`);
    if (when) lines.push(`${whenLabel}: ${when}${wasText(oldTime)}`);
    if (venue || address) {
      if (venue) lines.push(`${whereLabel}: ${venue}${wasText(oldVenue)}`);
      if (address) lines.push(`${venue ? " ".repeat(whereLabel.length + 2) : `${whereLabel}: `}${address}${wasText(oldAddress)}`);
    }
    lines.push("");
  }
  if (copy.note) lines.push(copy.note, "");
  if (copy.highlight) lines.push(copy.highlight, "");
  lines.push(`${copy.ctaLabel}: ${copy.ctaURL}`, "");
  if (copy.fine) lines.push(copy.fine, "");
  lines.push("--");
  lines.push(reasonLine);
  lines.push(`${unsubscribe}: ${ctx.unsubscribeURL}`);
  if (manageLink) lines.push(`${manageLink.label}: ${manageLink.url}`);
  else if (showManage) lines.push(`${managePrefix}${profile} > ${notifications}${manageSuffix}`);
  lines.push(`${sentBy} · ${questions} ${SUPPORT_EMAIL}`);

  return { subject: copy.subject, preheader, html, text: `${lines.join("\n")}\n` };
}
