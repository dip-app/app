import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { buildEventIcs, escapeIcsText, foldLine, icsAttachmentFor } from "../../functions/src/modules/email/domain/ics";
import { renderEmail } from "../../functions/src/modules/email/domain/templates/render";
import { PREVIEW_CASES } from "../../functions/src/modules/email/scripts/previewCases";

const NOW = new Date("2026-11-17T12:00:00Z");
const FACTS = {
  eventId: "evt_1",
  eventTitle: "Sunset hike",
  startTime: "2026-11-20T23:30:00Z",
  endTime: "2026-11-21T01:00:00Z",
  venueName: "Frick Park",
  revision: 2,
};

/** Unfolds RFC 5545 content lines. */
const unfold = (ics: string): string[] => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);

describe("ics builder", () => {
  test("structure, CRLF endings, UTC times and fixed properties", () => {
    const ics = buildEventIcs(FACTS, NOW);
    assert.ok(ics.endsWith("\r\n"));
    assert.ok(!/[^\r]\n/.test(ics), "bare LF found");
    const lines = unfold(ics);
    assert.equal(lines[0], "BEGIN:VCALENDAR");
    assert.equal(lines.at(-1), "END:VCALENDAR");
    for (const expected of [
      "VERSION:2.0",
      "PRODID:-//DIP//letsdip.work//EN",
      "METHOD:PUBLISH",
      "UID:evt_1@letsdip.work",
      "SEQUENCE:2",
      "DTSTAMP:20261117T120000Z",
      "DTSTART:20261120T233000Z",
      "DTEND:20261121T010000Z",
      "SUMMARY:Sunset hike",
      "LOCATION:Frick Park",
      "URL:https://letsdip.work/e/evt_1",
      "DESCRIPTION:Open in DIP: https://letsdip.work/e/evt_1",
      "STATUS:CONFIRMED",
    ]) {
      assert.ok(lines.includes(expected), expected);
    }
  });

  test("UID is stable across revisions and SEQUENCE equals the revision", () => {
    const a = unfold(buildEventIcs({ ...FACTS, revision: 0 }, NOW));
    const b = unfold(buildEventIcs({ ...FACTS, revision: 7 }, NOW));
    assert.ok(a.includes("UID:evt_1@letsdip.work") && b.includes("UID:evt_1@letsdip.work"));
    assert.ok(a.includes("SEQUENCE:0") && b.includes("SEQUENCE:7"));
  });

  test("canceled events carry STATUS:CANCELLED", () => {
    const lines = unfold(buildEventIcs({ ...FACTS, canceled: true }, NOW));
    assert.ok(lines.includes("STATUS:CANCELLED"));
    assert.ok(!lines.includes("STATUS:CONFIRMED"));
  });

  test("escapes backslash, semicolon, comma and newline", () => {
    assert.equal(escapeIcsText("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
    const lines = unfold(buildEventIcs({ ...FACTS, eventTitle: "Lunch, drinks; fun\\games", venueName: "Room 1, Floor 2" }, NOW));
    assert.ok(lines.includes("SUMMARY:Lunch\\, drinks\\; fun\\\\games"));
    assert.ok(lines.includes("LOCATION:Room 1\\, Floor 2"));
  });

  test("omits LOCATION without a venue and rejects invalid times", () => {
    const { venueName: _v, ...noVenue } = FACTS;
    assert.ok(!buildEventIcs(noVenue, NOW).includes("LOCATION"));
    assert.throws(() => buildEventIcs({ ...FACTS, startTime: "bad" }, NOW));
  });

  test("folds at 75 octets without splitting multibyte characters", () => {
    const title = "Team \u{1F355} éè 会议 ".repeat(12);
    const ics = buildEventIcs({ ...FACTS, eventTitle: title }, NOW);
    for (const physical of ics.split("\r\n")) {
      assert.ok(Buffer.byteLength(physical, "utf8") <= 75, `too long: ${Buffer.byteLength(physical, "utf8")}`);
      assert.ok(!physical.includes("�"));
    }
    const summary = unfold(ics).find((l) => l.startsWith("SUMMARY:"))!;
    assert.equal(summary, `SUMMARY:${title.replace(/\s+/g, " ").trim()}`);
    assert.ok(ics.includes("\r\n "), "expected at least one fold");
  });

  test("foldLine leaves short lines alone and keeps continuation lines within 75 octets", () => {
    assert.equal(foldLine("SHORT:line"), "SHORT:line");
    const folded = foldLine(`X:${"a".repeat(200)}`).split("\r\n");
    assert.ok(folded.length >= 3);
    assert.equal(Buffer.byteLength(folded[0]!, "utf8"), 75);
    for (const l of folded.slice(1)) assert.ok(l.startsWith(" ") && Buffer.byteLength(l, "utf8") <= 75);
  });
});

describe("icsAttachmentFor", () => {
  const pick = (name: string) => PREVIEW_CASES.find((c) => c.name === name)!;

  test("only calendar invite and cancel emails carry a calendar file; no informational event.ics anywhere", () => {
    for (const c of PREVIEW_CASES) {
      const att = icsAttachmentFor(c.template, c.variables, 3, NOW);
      assert.equal(att, null, `${c.name} must not attach a calendar file without an invite context`);
    }
    for (const name of ["invite_received", "event_reminder_24h", "event_changed", "attendee_added", "event_canceled"]) {
      const c = pick(name);
      const withCtx = icsAttachmentFor(c.template, c.variables, 3, NOW, { attendeeEmail: "a@b.co", attendeeName: null, memberUid: "u", now: NOW });
      assert.equal(withCtx, null, name);
    }
  });

  test("reminder and changed emails point to the event page for Add to calendar", () => {
    const text = renderEmail("event_reminder", pick("event_reminder_24h").variables as never, pick("event_reminder_24h").ctx).text;
    assert.ok(text.includes("add it to your calendar, open the event in DIP"));
    assert.ok(text.includes("https://letsdip.work/e/"));
  });
});
