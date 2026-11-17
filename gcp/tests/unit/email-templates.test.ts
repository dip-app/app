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
        assert.ok(body.includes("Manage in DIP: Profile"), c.name);
        assert.ok(body.includes("Hi Sam, "), c.name);
      }
      assert.ok(out.html.includes('href="https://letsdip.work/u/sample-token"'), c.name);
      assert.ok(out.html.includes("max-width:600px") && out.html.includes("#1E212B"), c.name);
      assert.ok(out.html.includes("v:roundrect"), c.name);
      assert.ok(out.html.includes("border-color: #2C2F38") && out.html.includes("[data-ogsc]"), c.name);
      assert.ok(out.preheader.length >= 20 && out.preheader.length <= 110 && !out.preheader.startsWith("Hi ") && out.preheader.endsWith(".") && !out.preheader.includes("..."), c.name);
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
    assert.ok(out.html.includes("Hi there, ") && out.text.includes("\nHi there, "));
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

  test("brand fonts are linked with fallback stacks and an Outlook override", () => {
    for (const c of PREVIEW_CASES) {
      const { html } = render(c);
      const url = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700&family=Fjalla+One&display=swap";
      assert.ok(html.includes(`<link rel="stylesheet" href="${url}">`), c.name);
      assert.ok(html.includes(`@import url('${url}')`), c.name);
      assert.ok(html.includes("font-family:'Fjalla One', 'Arial Narrow', Arial, sans-serif"), c.name);
      assert.ok(html.includes("font-family:Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"), c.name);
      assert.ok(/<!--\[if mso\]>\s*<style[^>]*>[^<]*Arial/.test(html), c.name);
    }
  });

  test("tables only: no flexbox or grid", () => {
    for (const c of PREVIEW_CASES) {
      assert.ok(!/display\s*:\s*(inline-)?(flex|grid)/i.test(render(c).html), c.name);
    }
  });

  test("brand images are absolute https, sized, and every img has alt", () => {
    for (const c of PREVIEW_CASES) {
      const { html } = render(c);
      const imgs = html.match(/<img\b[^>]*>/g) ?? [];
      assert.ok(imgs.length >= 2, c.name);
      assert.ok(!html.includes("logo.png"), c.name);
      for (const img of imgs) assert.ok(/\salt="[^"]*"/.test(img), `${c.name}: ${img}`);
      assert.ok(html.includes('<a href="https://letsdip.work/" style="text-decoration:none;"><img class="art light-img" src="https://letsdip.work/img/email/header.png" width="600" height="100" alt="DIP"'), c.name);
      assert.ok(html.indexOf("header.png") < html.indexOf("<h1"), c.name);
      assert.ok(html.includes('src="https://letsdip.work/img/email/footer.png" width="600" height="100" alt=""'), c.name);
      assert.ok(html.includes('class="art dark-img" src="https://letsdip.work/img/email/header-dark.png" width="600" height="100" alt="DIP" style="display:none;mso-hide:all;max-height:0;overflow:hidden;'), c.name);
      assert.ok(html.includes('class="art dark-img" src="https://letsdip.work/img/email/footer-dark.png" width="600" height="100" alt="" style="display:none;mso-hide:all;max-height:0;overflow:hidden;'), c.name);
      assert.ok(html.includes(".dark-img { display: block !important") && html.includes(".light-img { display: none !important") && html.includes("[data-ogsc] .dark-img"), c.name);
      assert.ok(html.includes(".art-cell { background-color: #23252E !important; }"), c.name);
      assert.ok(html.includes('bgcolor="#F2F3FC"'), c.name);
      for (const m of html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)) assert.ok(m[1]!.startsWith("https://"), `${c.name}: ${m[1]}`);
    }
  });

  test("open pixel renders only when openPixelURL is set, last in the body, never in text", () => {
    for (const c of PREVIEW_CASES) {
      const out = render(c);
      const pixel = /<img src="[^"]*\/o\/[^"]*" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" \/>/;
      if (c.ctx.openPixelURL) {
        assert.ok(pixel.test(out.html), c.name);
        assert.ok(out.html.includes(`src="${c.ctx.openPixelURL}"`), c.name);
        const imgs = out.html.match(/<img\b[^>]*>/g)!;
        assert.ok(imgs[imgs.length - 2]!.includes("footer-dark.png") && imgs[imgs.length - 1]!.includes(c.ctx.openPixelURL), c.name);
      } else {
        assert.ok(!pixel.test(out.html), c.name);
      }
      assert.ok(!out.text.includes("/o/") && !out.text.includes(".gif"), c.name);
    }
    const base = PREVIEW_CASES[0]!;
    for (const empty of [null, "", undefined]) {
      const out = renderEmail(base.template, base.variables as never, { ...base.ctx, openPixelURL: empty });
      assert.ok(!out.html.includes('width="1" height="1"'));
    }
    const evil = renderEmail(base.template, base.variables as never, { ...base.ctx, openPixelURL: 'https://letsdip.work/o/a"b.gif' });
    assert.ok(!evil.html.includes('a"b'));
  });

  test("primary button has a VML fallback and a tap height of at least 44px; purple only on the button", () => {
    for (const c of PREVIEW_CASES) {
      const { html } = render(c);
      assert.ok(html.includes("<v:roundrect") && html.includes("height:44px"), c.name);
      assert.ok(/padding:0 28px;height:44px;[^"]*line-height:44px/.test(html) && !html.includes("min-height") && html.includes('height="44"'), c.name);
      assert.ok(html.includes("@media (max-width: 620px)") && html.includes(".btn-table { width: 100% !important; }"), c.name);
      assert.ok(!/#4F5BD5|#AEB7FF/i.test(html), c.name);
      const purple = html.split("\n").filter((l) => l.includes("#7B88FA"));
      assert.ok(purple.every((l) => /v:roundrect|btn-table/.test(l)), c.name);
      assert.ok(/<td class="text-muted" style="padding:12px 0;[^"]*"><a class="link" href="[^"]*" style="color:#1E212B;text-decoration:underline;">Unsubscribe/.test(html), c.name);
    }
  });

  test("footer banner is the last image (before only the pixel), after the unsubscribe link", () => {
    for (const c of PREVIEW_CASES) {
      const { html } = render(c);
      const imgs = html.match(/<img\b[^>]*>/g)!;
      const footerIdx = imgs.findIndex((i) => i.includes("footer-dark.png"));
      assert.ok(footerIdx === imgs.length - 1 || (footerIdx === imgs.length - 2 && imgs[imgs.length - 1]!.includes('width="1"')), c.name);
      assert.ok(html.indexOf("footer.png") > html.indexOf(">Unsubscribe<"), c.name);
      assert.ok(html.indexOf(">Unsubscribe<") > html.indexOf("Open in DIP"), c.name);
    }
  });

  test("never a one-sided border on a rounded element", () => {
    for (const c of PREVIEW_CASES) {
      for (const m of render(c).html.matchAll(/<[a-z0-9]+\b[^>]*\sstyle="([^"]*)"/g)) {
        const style = m[1]!;
        if (/border-radius/.test(style)) assert.ok(!/border-(left|right|top|bottom)\s*:/.test(style), `${c.name}: ${style}`);
      }
    }
  });

  test("challenge titles use curly quotes in html and text", () => {
    for (const n of ["challenge_approved", "challenge_changes_requested"]) {
      const out = render(PREVIEW_CASES.find((c) => c.name === n)!);
      for (const body of [out.html, out.text]) assert.ok(body.includes("\u201C10,000 steps for a week\u201D"), n);
    }
  });

  test("times use non-breaking spaces in html; reminder body names the event", () => {
    const inv = render(PREVIEW_CASES[0]!);
    assert.ok(/6:30&nbsp;PM to 8:00&nbsp;PM&nbsp;EST/.test(inv.html));
    assert.ok(inv.text.includes("6:30 PM to 8:00 PM EST"));
    assert.ok(inv.html.includes(".lbl { width: 56px !important; }"));
    const r = render(PREVIEW_CASES.find((c) => c.name === "event_reminder_24h")!);
    const h = render(PREVIEW_CASES.find((c) => c.name === "event_reminder_1h")!);
    assert.ok(r.text.includes("Hi Sam, Sunset hike at Frick Park starts tomorrow."));
    assert.ok(h.text.includes("Hi Sam, Sunset hike at Frick Park starts in about an hour."));
    assert.ok(r.html.includes(">Starts tomorrow<"));
  });

  test("details block lists When and Where as a key/value table", () => {
    const out = render(PREVIEW_CASES[0]!);
    assert.ok(out.html.includes(">When</td>") && out.html.includes(">Where</td>"));
    assert.ok(out.text.includes("When: Fri, Nov 20, 6:30 PM to 8:00 PM EST") && out.text.includes("Where: Frick Park"));
    assert.ok(out.text.startsWith("NEW INVITATION\n"));
  });

  test("cover images are never rendered, but the variable still validates", () => {
    const c = PREVIEW_CASES[0]!;
    assert.ok(!render(c).html.includes("catalog://") && !/hiking/.test(render(c).html));
    assert.ok(validateVariables(c.template, c.variables));
    assert.equal(validateVariables(c.template, { ...(c.variables as object), coverImageURL: 5 }), null);
  });

  test("event_changed shows an Updated pill and names what changed", () => {
    const out = render(PREVIEW_CASES.find((c) => c.name === "event_changed")!);
    assert.ok(out.html.includes(">Updated<") && out.html.includes('class="pill border"') && !out.html.includes("#EEF0FF"));
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
    assert.ok(byName("challenge_approved").html.includes("font-weight:700;color:#1E212B;\">+50 points"));
    assert.ok(byName("invite_received").html.includes(">New invitation<"));
    assert.ok(byName("event_reminder_1h").html.includes(">Starts in about an hour<"));
    assert.ok(byName("challenge_changes_requested").html.includes(">Changes requested<"));
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
