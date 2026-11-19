import { createHash } from "node:crypto";
import { collapseWhitespace } from "../../share/domain/sharePage";
import { localeOrDefault, type Locale } from "../../i18n";
import { eventURL } from "./templates/copy";
import { tEmail } from "./templates/i18n";
import type { EventFacts, TemplateId, TemplateVariables } from "./templates/types";

export type IcsFacts = EventFacts & { revision: number; canceled?: boolean };

export interface IcsAttachment {
  filename: string;
  contentType: string;
  content: string;
}

const CRLF = "\r\n";

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds one content line at 75 octets without splitting a UTF-8 sequence. Continuation lines start with one space. */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 1; // leading space of the continuation line
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join(CRLF);
}

function utc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Informational RFC 5545 file (METHOD:PUBLISH). No longer attached to any email (it would duplicate the invite's entry); kept for a future feed. METHOD:PUBLISH because DIP has no organizer mailbox to receive iTIP replies. */
export function buildEventIcs(facts: IcsFacts, now: Date): string {
  const start = new Date(facts.startTime);
  const end = new Date(facts.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Invalid event time");
  const url = eventURL(facts.eventId);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DIP//letsdip.work//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${facts.eventId}@letsdip.work`,
    `SEQUENCE:${Math.max(0, Math.trunc(facts.revision))}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${escapeIcsText(collapseWhitespace(facts.eventTitle))}`,
  ];
  if (facts.venueName) lines.push(`LOCATION:${escapeIcsText(collapseWhitespace(facts.venueName))}`);
  lines.push(
    `URL:${url}`,
    `DESCRIPTION:${escapeIcsText(`Open in DIP: ${url}`)}`,
    `STATUS:${facts.canceled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------------------------------------------------
// Calendar invites (iTIP METHOD:REQUEST / METHOD:CANCEL), one per (event, member).
// ---------------------------------------------------------------------------------------------------------------------

/** Invite mailbox. The domain is verified with the provider; the mailbox itself need not exist (replies go to support@). */
export const INVITE_ORGANIZER_EMAIL = "events@letsdip.work";
export const INVITE_ORGANIZER_NAME = "DIP Events";
/** From header of invite emails; replies go to support@letsdip.work. */
export const INVITE_FROM = `${INVITE_ORGANIZER_NAME} <${INVITE_ORGANIZER_EMAIL}>`;
export const INVITE_REPLY_TO = "support@letsdip.work";
/** Minutes before the start for the reminder alarm of a REQUEST. */
export const INVITE_ALARM_MINUTES = 30;

export type InviteMethod = "REQUEST" | "CANCEL";

export interface InviteContext {
  /** Recipient address (the ATTENDEE). Appears only in the .ics of the email sent to that address. */
  attendeeEmail: string;
  /** Recipient display name, or null. */
  attendeeName: string | null;
  /** Member uid, hashed into the stable UID; never written to the calendar file. */
  memberUid: string;
  now: Date;
  /** Recipient language for our calendar text (description, alarm). Absent means English; the event title is never translated. */
  locale?: Locale;
}

export interface InviteFacts extends EventFacts { sequence: number }

/**
 * Stable per (event, member) UID: later REQUESTs and the CANCEL modify the same calendar entry. The member id is
 * hashed so the calendar file never carries it. Event ids are opaque `[A-Za-z0-9_-]` strings.
 */
export function inviteUid(eventId: string, memberUid: string): string {
  const member = createHash("sha256").update(memberUid, "utf8").digest("hex").slice(0, 16);
  return `dip-${eventId}-${member}@letsdip.work`;
}

/** Parameter value in DQUOTEs; quotes and control characters are dropped (RFC 5545 forbids them inside). */
function paramText(value: string): string {
  return `"${collapseWhitespace(value).replace(/["\u0000-\u001f\u007f]/g, "")}"`;
}

const SAFE_ADDRESS = /^[^\s<>()"\\,;:\u0000-\u001f]+@[^\s<>()"\\,;:\u0000-\u001f]+$/;

/**
 * RFC 5545 / RFC 5546 invite for one member. Times are UTC instants (`...Z`), so daylight saving changes can never
 * shift an entry and no VTIMEZONE is needed. ORGANIZER is the invite mailbox; the attendee is ACCEPTED with RSVP=FALSE
 * because the member already joined in DIP, so clients show an "Add to calendar" card and expect no reply.
 * CANCEL carries the same UID and a higher SEQUENCE, STATUS:CANCELLED and no alarm.
 */
export function buildInviteIcs(method: InviteMethod, facts: InviteFacts, ctx: InviteContext): string {
  const start = new Date(facts.startTime);
  const end = new Date(facts.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Invalid event time");
  if (!SAFE_ADDRESS.test(ctx.attendeeEmail)) throw new Error("Invalid attendee address");
  if (!Number.isInteger(facts.sequence) || facts.sequence < 0) throw new Error("Invalid sequence");
  const url = eventURL(facts.eventId);
  const attendeeName = ctx.attendeeName ? collapseWhitespace(ctx.attendeeName).slice(0, 80) : "";
  const location = [facts.venueName, facts.venueAddress].filter((p): p is string => !!p).map(collapseWhitespace).join(", ");
  const cancel = method === "CANCEL";
  const locale = localeOrDefault(ctx.locale);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DIP//letsdip.work//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${inviteUid(facts.eventId, ctx.memberUid)}`,
    `SEQUENCE:${facts.sequence}`,
    `DTSTAMP:${utc(ctx.now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${escapeIcsText(collapseWhitespace(facts.eventTitle))}`,
  ];
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push(
    `DESCRIPTION:${escapeIcsText(tEmail(locale, "email.ics.description", { url }))}`,
    `URL:${url}`,
    `ORGANIZER;CN=${paramText(INVITE_ORGANIZER_NAME)}:mailto:${INVITE_ORGANIZER_EMAIL}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE${attendeeName ? `;CN=${paramText(attendeeName)}` : ""}:mailto:${ctx.attendeeEmail}`,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
  );
  if (!cancel) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(tEmail(locale, "email.ics.alarm", { title: collapseWhitespace(facts.eventTitle) }))}`,
      `TRIGGER:-PT${INVITE_ALARM_MINUTES}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Attachment content type: Gmail, Outlook and Apple Mail read `method=` from the part header to show the invite card. */
export function inviteContentType(method: InviteMethod): string {
  return `text/calendar; charset=UTF-8; method=${method}`;
}

/** The calendar attachment for a template: only the calendar invite and cancel emails carry one (`invite.ics`); every other template returns null. */
export function icsAttachmentFor(
  template: TemplateId,
  variables: TemplateVariables[TemplateId],
  _revision: number,
  _now: Date = new Date(),
  invite?: InviteContext,
): IcsAttachment | null {
  if (template === "calendar_invite" || template === "calendar_cancel") {
    if (!invite) return null;
    const v = variables as TemplateVariables["calendar_invite"];
    const method: InviteMethod = template === "calendar_cancel" ? "CANCEL" : "REQUEST";
    try {
      const { sequence, eventId, eventTitle, startTime, endTime, venueName, venueAddress } = v;
      const content = buildInviteIcs(method, {
        eventId, eventTitle, startTime, endTime, sequence,
        ...(venueName !== undefined ? { venueName } : {}), ...(venueAddress !== undefined ? { venueAddress } : {}),
      }, invite);
      return { filename: "invite.ics", contentType: inviteContentType(method), content };
    } catch {
      return null;
    }
  }
  // Reminder, change, cancel, invite-received and attendee-added emails carry no calendar file: the invite, update and
  // cancel emails own the member's calendar entry, and a second file with another UID would create a duplicate.
  return null;
}
