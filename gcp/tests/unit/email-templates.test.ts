import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eventURL, formatEventTime, renderEmail, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { TEMPLATE_IDS, type TemplateId } from "../../functions/src/modules/email/domain/templates/types";
import { PREVIEW_CASES, SAMPLE_CTX } from "../../functions/src/modules/email/scripts/previewCases";

const SNAP_DIR = join(__dirname, "__snapshots__", "email");
const UPDATE = process.env.UPDATE_EMAIL_SNAPSHOTS === "1";

function render(c: (typeof PREVIEW_CASES)[number]) {
  return renderEmail(c.template, c.variables as never, c.ctx);
}

const EVIL = '<script>alert("x")</script> & "q"';

describe("email template snapshots", () => {
  for (const c of PREVIEW_CASES) {
    test(`golden output: ${c.name}`, () => {
      const out = render(c);
      for (const [ext, actual] of [["html", out.html], ["txt", out.text]] as const) {
        const file = join(SNAP_DIR, `${c.name}.${ext}`);
        if (UPDATE) {
          mkdirSync(SNAP_DIR, { recursive: true });
          writeFileSync(file, actual);
        } else {
          assert.ok(existsSync(file), `missing snapshot ${file}; run with UPDATE_EMAIL_SNAPSHOTS=1`);
          assert.equal(actual, readFileSync(file, "utf8"), `${c.name}.${ext} differs from snapshot`);
        }
      }
    });
  }
});

describe("email template invariants", () => {
  test("every template id is covered by a preview case", () => {
    const covered = new Set(PREVIEW_CASES.map((c) => c.template));
    for (const id of TEMPLATE_IDS) assert.ok(covered.has(id), id);
  });

  test("footer, unsubscribe, address and structure in every output", () => {
    for (const c of PREVIEW_CASES) {
      const out = render(c);
      for (const body of [out.html, out.text]) {
        assert.ok(body.includes(SAMPLE_CTX.unsubscribeURL), `${c.name} unsubscribe`);
        assert.ok(body.includes(SAMPLE_CTX.postalAddress), `${c.name} address`);
        assert.ok(body.includes("Unsubscribe"), c.name);
        assert.ok(body.includes("You are getting this because"), c.name);
        assert.ok(body.includes("emails are on."), c.name);
        assert.ok(body.includes("Manage in the DIP app (Profile"), c.name);
        assert.ok(body.includes("Hi Sam, "), c.name);
      }
      assert.ok(out.html.includes('href="https://letsdip.work/u/sample-token"'), c.name);
      assert.ok(out.html.includes("max-width:560px") && out.html.includes("#4F5BD5"), c.name);
      assert.ok(out.html.includes("v:roundrect"), c.name);
      assert.ok(out.html.includes("border-color: #343841"), c.name);
      assert.ok(!out.html.includes("<img"), c.name);
      assert.ok(out.preheader.length >= 20 && out.preheader.length <= 90 && !out.preheader.startsWith("Hi "), c.name);
      assert.ok(out.html.includes(`mso-hide:all;">`) && out.html.includes(out.preheader.replace(/&/g, "&amp;")), c.name);
      assert.ok(out.html.includes('name="color-scheme" content="light dark"'));
      assert.ok(out.html.includes("prefers-color-scheme: dark"));
      assert.ok(out.html.includes("letsdip.work"));
      assert.ok(out.text.includes(`DIP · ${SAMPLE_CTX.postalAddress}`));
    }
  });

  test("no em dash anywhere, subject within 78 characters, no emoji in chrome", () => {
    for (const c of PREVIEW_CASES) {
      const out = render(c);
      for (const s of [out.subject, out.preheader, out.html, out.text]) assert.ok(!s.includes("—"), c.name);
      assert.ok(out.subject.length <= 78, `${c.name}: ${out.subject.length}`);
      assert.ok(!out.subject.includes("\n"));
    }
    const long = PREVIEW_CASES.find((c) => c.name === "long_title")!;
    assert.ok(render(long).subject.endsWith("..."));
  });

  test("greeting falls back to Hi there", () => {
    const c = PREVIEW_CASES[0]!;
    const out = renderEmail(c.template, c.variables as never, { ...c.ctx, recipientFirstName: null });
    assert.ok(out.html.includes("Hi there, ") && out.text.startsWith("Hi there, "));
  });

  test("deep links are exactly the event URL", () => {
    assert.equal(eventURL("evt_1"), "https://letsdip.work/e/evt_1");
    for (const c of PREVIEW_CASES) {
      const out = render(c);
      assert.ok(out.html.includes(">Open in DIP<"), c.name);
      if (c.template === "challenge_reviewed") {
        assert.ok(out.html.includes('href="https://letsdip.work/"'));
        assert.ok(out.text.includes("Open in DIP: https://letsdip.work/"));
        continue;
      }
      const id = (c.variables as { eventId: string }).eventId;
      assert.ok(out.html.includes(`href="https://letsdip.work/e/${id}"`), c.name);
      assert.ok(out.text.includes(`Open in DIP: https://letsdip.work/e/${id}`), c.name);
    }
  });

  test("times show the zone abbreviation", () => {
    assert.equal(formatEventTime("2026-11-21T00:30:00Z", "2026-11-21T02:00:00Z", "America/New_York"), "Fri, Nov 20, 7:30 PM to 9:00 PM EST");
    assert.equal(formatEventTime("2026-07-01T22:30:00Z", "2026-07-02T00:00:00Z", "America/New_York"), "Wed, Jul 1, 6:30 PM to 8:00 PM EDT");
    assert.match(formatEventTime("2026-11-20T23:30:00Z", "2026-11-21T01:00:00Z", "America/Los_Angeles"), /PST$/);
    assert.equal(
      formatEventTime("2026-11-20T23:30:00Z", "2026-11-21T01:00:00Z", "Not/AZone"),
      formatEventTime("2026-11-20T23:30:00Z", "2026-11-21T01:00:00Z", "America/New_York"),
    );
    assert.match(formatEventTime("2026-11-21T03:00:00Z", "2026-11-21T08:00:00Z", "America/New_York"), /Fri, Nov 20, 10:00 PM to Sat, Nov 21, 3:00 AM EST/);
    for (const c of PREVIEW_CASES) {
      if (c.template === "challenge_reviewed") continue;
      assert.match(render(c).text, /\b(EST|EDT)\b/, c.name);
    }
  });

  test("all interpolated values are HTML escaped", () => {
    const base = {
      eventId: "evt_x",
      eventTitle: EVIL,
      startTime: "2026-11-20T23:30:00Z",
      endTime: "2026-11-21T01:00:00Z",
      venueName: EVIL,
      coverImageURL: "catalog://default/hiking",
    };
    const outs = [
      renderEmail("invite_received", { ...base, inviterFirstName: EVIL }, { ...SAMPLE_CTX, recipientFirstName: EVIL }),
      renderEmail("invite_answered", { ...base, inviteeFirstName: EVIL, answer: "accepted" }, SAMPLE_CTX),
      renderEmail("event_changed", { ...base, changedFields: ["time"] }, SAMPLE_CTX),
      renderEmail("challenge_reviewed", { challengeId: "c1", challengeTitle: EVIL, outcome: "approved", points: 3 }, SAMPLE_CTX),
      renderEmail("event_canceled", base, { ...SAMPLE_CTX, postalAddress: EVIL, unsubscribeURL: 'https://letsdip.work/u/a"b' }),
    ];
    for (const out of outs) {
      assert.ok(!out.html.includes("<script>"));
      assert.ok(!out.html.includes('alert("x")'));
      assert.ok(out.html.includes("&lt;script&gt;"));
      assert.ok(!out.html.includes('u/a"b'));
    }
  });

  test("cover images are never rendered, but the variable still validates", () => {
    const c = PREVIEW_CASES[0]!;
    assert.ok(!render(c).html.includes("<img"));
    assert.ok(validateVariables(c.template, c.variables));
    assert.equal(validateVariables(c.template, { ...(c.variables as object), coverImageURL: 5 }), null);
  });

  test("event_changed shows an Updated pill and names what changed", () => {
    const out = render(PREVIEW_CASES.find((c) => c.name === "event_changed")!);
    assert.ok(out.html.includes(">Updated<") && out.html.includes("#EEF0FF"));
    assert.ok(!out.text.includes("latest details are below"));
  });

  test("RTL and emoji titles are wrapped for bidi and kept intact", () => {
    const ar = PREVIEW_CASES.find((c) => c.name === "rtl_title_arabic")!;
    assert.ok(render(ar).html.includes('dir="auto"'));
    const emoji = PREVIEW_CASES.find((c) => c.name === "emoji_title")!;
    assert.ok(render(emoji).text.includes("\u{1F355}"));
  });

  test("copy matches the spec for key templates", () => {
    const byName = (n: string) => render(PREVIEW_CASES.find((c) => c.name === n)!);
    assert.equal(byName("invite_received").subject, "Priya invited you to Sunset hike at Frick Park");
    assert.equal(byName("attendee_added").subject.startsWith("You were added to "), true);
    assert.equal(byName("event_reminder_24h").subject, "Tomorrow: Sunset hike at Frick Park");
    assert.equal(byName("event_reminder_1h").subject, "Starting in about an hour: Sunset hike at Frick Park");
    assert.equal(byName("event_canceled").subject, "Canceled: Sunset hike at Frick Park");
    assert.ok(byName("event_changed").text.includes("Hi Sam, the time and location changed for this event."));
    assert.ok(byName("invite_received").text.includes("See who is going and respond."));
    assert.ok(byName("event_canceled").text.includes("Browse other events."));
    assert.ok(byName("challenge_approved").text.includes("+50 points"));
    assert.ok(byName("challenge_approved").html.includes("font-weight:700;color:#1F2937;\">+50 points"));
    assert.ok(byName("invite_answered_declined").subject.includes("declined"));
  });
});

describe("validateVariables", () => {
  const good = {
    eventId: "evt_1",
    eventTitle: "Hike",
    startTime: "2026-11-20T23:30:00Z",
    endTime: "2026-11-21T01:00:00Z",
  };

  test("accepts valid data and returns a new object with only allowed keys", () => {
    const input = { ...good, inviterFirstName: "Priya" };
    const out = validateVariables("invite_received", input);
    assert.deepEqual(out, input);
    assert.notEqual(out, input);
    assert.equal(validateVariables("event_canceled", good) !== null, true);
  });

  test("every preview case validates", () => {
    for (const c of PREVIEW_CASES) assert.ok(validateVariables(c.template, c.variables), c.name);
  });

  test("rejects unknown keys such as chatText", () => {
    for (const id of TEMPLATE_IDS) {
      const c = PREVIEW_CASES.find((x) => x.template === id)!;
      assert.equal(validateVariables(id as TemplateId, { ...(c.variables as object), chatText: "hello" }), null, id);
    }
  });

  test("rejects wrong types, overlong strings, bad enums and bad dates", () => {
    assert.equal(validateVariables("event_canceled", { ...good, eventTitle: 5 }), null);
    assert.equal(validateVariables("event_canceled", { ...good, eventTitle: "x".repeat(201) }), null);
    assert.equal(validateVariables("event_canceled", { ...good, eventTitle: "x".repeat(200) }) !== null, true);
    assert.equal(validateVariables("invite_received", { ...good, inviterFirstName: "x".repeat(81) }), null);
    assert.equal(validateVariables("invite_answered", { ...good, inviteeFirstName: "A", answer: "maybe" }), null);
    assert.equal(validateVariables("event_reminder", { ...good, window: "2h" }), null);
    assert.equal(validateVariables("event_changed", { ...good, changedFields: [] }), null);
    assert.equal(validateVariables("event_changed", { ...good, changedFields: ["time", "time"] }), null);
    assert.equal(validateVariables("event_changed", { ...good, changedFields: ["email"] }), null);
    assert.equal(validateVariables("event_canceled", { ...good, startTime: "next friday" }), null);
    assert.equal(validateVariables("event_canceled", { ...good, startTime: "2026-13-45T25:00:00Z" }), null);
    assert.equal(validateVariables("event_canceled", { ...good, eventId: "a/b" }), null);
    assert.equal(validateVariables("challenge_reviewed", { challengeId: "c", challengeTitle: "t", outcome: "approved", points: 1.5 }), null);
    assert.equal(validateVariables("challenge_reviewed", { challengeId: "c", challengeTitle: "t", outcome: "rejected" }), null);
    for (const bad of [null, undefined, "str", 5, [], true]) assert.equal(validateVariables("event_canceled", bad), null);
  });

  test("email-looking names are plain text and never become mailto links", () => {
    const vars = validateVariables("invite_received", { ...good, inviterFirstName: "bob@example.com" });
    assert.ok(vars);
    const out = renderEmail("invite_received", vars, SAMPLE_CTX);
    assert.ok(!out.html.includes("mailto:"));
    assert.ok(!out.text.includes("mailto:"));
  });
});
