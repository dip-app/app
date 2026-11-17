import { collapseWhitespace } from "../../share/domain/sharePage";
import { eventURL } from "./templates/copy";
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

/** RFC 5545 VCALENDAR with one VEVENT. METHOD:PUBLISH because DIP has no organizer mailbox to receive iTIP replies. */
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

const ICS_TEMPLATES: ReadonlySet<TemplateId> = new Set<TemplateId>([
  "invite_received",
  "event_reminder",
  "event_changed",
  "attendee_added",
  "event_canceled",
]);

/** The calendar attachment for a template, or null when the template carries none. The caller passes 0 when the revision is unknown. */
export function icsAttachmentFor(
  template: TemplateId,
  variables: TemplateVariables[TemplateId],
  revision: number,
  now: Date = new Date(),
): IcsAttachment | null {
  if (!ICS_TEMPLATES.has(template)) return null;
  const v = variables as EventFacts;
  try {
    const content = buildEventIcs(
      {
        eventId: v.eventId,
        eventTitle: v.eventTitle,
        startTime: v.startTime,
        endTime: v.endTime,
        ...(v.venueName !== undefined ? { venueName: v.venueName } : {}),
        revision,
        ...(template === "event_canceled" ? { canceled: true } : {}),
      },
      now,
    );
    return { filename: "event.ics", contentType: "text/calendar; charset=utf-8; method=PUBLISH", content };
  } catch {
    return null;
  }
}
