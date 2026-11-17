import { collapseWhitespace, escapeHtml } from "../../../share/domain/sharePage";
import { buildCopy, CATEGORY_REASON, eventURL, truncate } from "./copy";
import { TEMPLATE_CATEGORY, type EventFacts, type RenderContext, type RenderedEmail, type TemplateId, type TemplateVariables } from "./types";

export { eventURL };

const FALLBACK_ZONE = "America/New_York";
const TITLE_MAX = 200;
const NAME_MAX = 80;
const VENUE_MAX = 120;
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

const EVENT_KEYS = ["eventId", "eventTitle", "startTime", "endTime", "venueName", "coverImageURL", "revision"] as const;

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
      if (!onlyKeys(rec, [...EVENT_KEYS, "changedFields"])) return null;
      const facts = eventFacts(rec);
      const raw = rec.changedFields;
      if (!facts || !Array.isArray(raw) || raw.length < 1 || raw.length > FIELDS.length) return null;
      const fields: Array<(typeof FIELDS)[number]> = [];
      for (const f of raw) {
        const match = FIELDS.find((x) => x === f);
        if (!match || fields.includes(match)) return null;
        fields.push(match);
      }
      result = { ...facts, changedFields: fields };
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
// Layout
// ---------------------------------------------------------------------------------------------

const ACCENT = "#7B88FA";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const STYLE = `
  body, table, td { margin: 0; padding: 0; }
  @media (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .btn-table { width: 100% !important; }
    .btn-a { display: block !important; text-align: center !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .bg-outer { background-color: #16181D !important; }
    .bg-card { background-color: #1F2229 !important; border-color: #343841 !important; }
    .bg-soft { background-color: #272B33 !important; border-color: #343841 !important; }
    .text-main { color: #E5E7EB !important; }
    .text-muted { color: #9CA3AF !important; }
    .border { border-color: #343841 !important; }
    .brand { color: #AEB7FF !important; }
    .pill { background-color: #2B3052 !important; color: #C7CCFF !important; }
    .link { color: #AEB7FF !important; }
    .btn-link { color: #FFFFFF !important; }
  }`;

interface Footer {
  reason: string;
  unsubscribeURL: string;
  postalAddress: string;
}

function greeting(ctx: RenderContext): string {
  const name = ctx.recipientFirstName ? collapseWhitespace(ctx.recipientFirstName).slice(0, NAME_MAX) : "";
  return name ? `Hi ${name},` : "Hi there,";
}


/**
 * Renders one transactional email to subject, preheader, table-based HTML and a plain-text alternative.
 * Cover images are intentionally not rendered (too dominant, and Outlook cannot crop); `coverImageURL` stays in the
 * allow-list, and a pre-cropped 1200x280 banner can return later.
 */
export function renderEmail<T extends TemplateId>(template: T, variables: TemplateVariables[T], ctx: RenderContext): RenderedEmail {
  const copy = buildCopy(template, variables);
  const zone = safeZone(ctx.timeZone);
  const hello = greeting(ctx);
  const reason = CATEGORY_REASON[TEMPLATE_CATEGORY[template]];

  const facts = copy.event;
  const title = facts ? collapseWhitespace(facts.eventTitle) : null;
  const when = facts ? formatEventTime(facts.startTime, facts.endTime, zone) : "";
  const venue = facts?.venueName ? collapseWhitespace(facts.venueName) : null;
  const lead = `${hello} ${copy.lead}`;
  const preheader = truncate(when ? `${copy.preheader} ${when}` : copy.preheader, 90);

  const e = escapeHtml;
  const para = (text: string, margin = "16px"): string =>
    `<p class="text-main" style="margin:0 0 ${margin} 0;font-family:${FONT};font-size:16px;line-height:24px;color:#1F2937;">${e(text)}</p>`;

  const pill = copy.badge
    ? `<div style="margin:0 0 8px 0;"><span class="pill" style="display:inline-block;padding:2px 8px;border-radius:10px;background-color:#EEF0FF;color:#4F5BD5;font-size:12px;line-height:16px;font-weight:600;">${e(copy.badge)}</span></div>`
    : "";
  const card =
    facts && title
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft border" style="margin:4px 0 16px 0;background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;border-left:3px solid ${ACCENT};">
<tr><td style="padding:16px 18px;font-family:${FONT};">
${pill}<div dir="auto" class="text-main" style="font-size:18px;line-height:26px;font-weight:600;color:#1F2937;"><bdi>${e(title)}</bdi></div>
${when ? `<div class="text-muted" style="margin-top:6px;font-size:14px;line-height:20px;color:#6B7280;">${e(when)}</div>` : ""}
${venue ? `<div dir="auto" class="text-muted" style="margin-top:2px;font-size:14px;line-height:20px;color:#6B7280;"><bdi>${e(venue)}</bdi></div>` : ""}
</td></tr></table>`
      : "";

  const highlight = copy.highlight
    ? `<p class="text-main" style="margin:0 0 16px 0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:#1F2937;">${e(copy.highlight)}</p>`
    : "";

  const cta = e(copy.ctaURL);
  const label = e(copy.ctaLabel);
  const button = `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${cta}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="18%" stroke="f" fillcolor="${ACCENT}"><w:anchorlock/><center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<table role="presentation" class="btn-table" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr><td align="center" bgcolor="${ACCENT}" style="background-color:${ACCENT};border-radius:8px;"><a class="btn-a btn-link" href="${cta}" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;">${label}</a></td></tr></table>
<!--<![endif]-->`;

  const fine = `font-family:${FONT};font-size:12px;line-height:18px;color:#6B7280;`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(copy.subject)}</title>
<style>${STYLE}
</style>
</head>
<body class="bg-outer" style="margin:0;padding:0;background-color:#F3F4F6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#F3F4F6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="container bg-card border" style="width:560px;max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;border-top:3px solid ${ACCENT};border-radius:12px;">
<tr><td class="px" style="padding:20px 28px 0 28px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:#4F5BD5;" align="left"><span class="brand" style="color:#4F5BD5;">DIP</span></td></tr>
<tr><td class="px" style="padding:16px 28px 28px 28px;">
${para(lead)}
${card}
${copy.note ? para(copy.note) : ""}
${highlight}
${button}
</td></tr>
<tr><td class="px" style="padding:0 28px 24px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="border" style="border-top:1px solid #E5E7EB;padding-top:16px;font-family:${FONT};">
<p class="text-muted" style="margin:0 0 4px 0;${fine}">You are getting this because ${e(reason)} emails are on. <a class="link" href="${e(ctx.unsubscribeURL)}" style="color:#4B5563;text-decoration:underline;">Unsubscribe</a> &middot; Manage in the DIP app (Profile &gt; Notifications)</p>
<p class="text-muted" style="margin:0;${fine}">DIP &middot; ${e(ctx.postalAddress)}</p>
</td></tr></table>
</td></tr>
</table>
</td></tr></table>
</body>
</html>
`;

  const lines: string[] = [lead, ""];
  if (facts && title) {
    if (copy.badge) lines.push(`[${copy.badge}]`);
    lines.push(title);
    if (when) lines.push(when);
    if (venue) lines.push(venue);
    lines.push("");
  }
  if (copy.note) lines.push(copy.note, "");
  if (copy.highlight) lines.push(copy.highlight, "");
  lines.push(`${copy.ctaLabel}: ${copy.ctaURL}`, "", "--");
  lines.push(`You are getting this because ${reason} emails are on.`);
  lines.push(`Unsubscribe: ${ctx.unsubscribeURL}`);
  lines.push("Manage in the DIP app (Profile > Notifications)");
  lines.push(`DIP · ${ctx.postalAddress}`);

  return { subject: copy.subject, preheader, html, text: `${lines.join("\n")}\n` };
}
