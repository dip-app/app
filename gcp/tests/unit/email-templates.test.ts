import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eventURL, formatEventTime, hasVisibleChange, renderEmail, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { TEMPLATE_IDS, type TemplateId } from "../../functions/src/modules/email/domain/templates/types";
import { PREVIEW_CASES, PREVIEW_CASES_ES, SAMPLE_CTX } from "../../functions/src/modules/email/scripts/previewCases";

const SNAP_DIR = join(__dirname, "__snapshots__", "email");
const UPDATE = process.env.UPDATE_EMAIL_SNAPSHOTS === "1";

function render(c: (typeof PREVIEW_CASES)[number]) {
  return renderEmail(c.template, c.variables as never, c.ctx);
}

/**
 * Cases of the event and challenge emails; the admin weekly ideas email has its own footer and layout
 * (email-admin-suggestions.test.ts), the account emails their own footer and button (email-account.test.ts), and the
 * opt-in weekly theme and admin digest emails have no event card (email-optin.test.ts).
 */
const ACCOUNT_TEMPLATES = new Set(["admin_suggestions", "roster_invite", "welcome", "bug_report_resolved", "weekly_theme", "admin_digest"]);
const LEGACY_CASES = PREVIEW_CASES.filter((c) => !ACCOUNT_TEMPLATES.has(c.template));

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

// Spanish (issue #259): separate golden files so the English ones above stay the untouched proof that English is
// byte-identical. Regenerate both with UPDATE_EMAIL_SNAPSHOTS=1 and review the diff.
describe("email template snapshots (es)", () => {
  const dir = join(SNAP_DIR, "es");
  for (const c of PREVIEW_CASES_ES) {
    test(`golden output (es): ${c.name}`, () => {
      const out = render(c);
      for (const [ext, actual] of [["html", out.html], ["txt", out.text]] as const) {
        const file = join(dir, `${c.name}.${ext}`);
        if (UPDATE) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, actual);
        } else {
          assert.ok(existsSync(file), `missing snapshot ${file}; run with UPDATE_EMAIL_SNAPSHOTS=1`);
          assert.equal(actual, readFileSync(file, "utf8"), `es/${c.name}.${ext} differs from snapshot`);
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

  test("footer, unsubscribe, support contact and structure in every output", () => {
    for (const c of LEGACY_CASES) {
      const out = render(c);
      for (const body of [out.html, out.text]) {
        assert.ok(body.includes(SAMPLE_CTX.unsubscribeURL), `${c.name} unsubscribe`);
        assert.ok(body.includes("Unsubscribe"), c.name);
        assert.ok(body.includes("You are getting this because"), c.name);
        assert.ok(body.includes("emails are on."), c.name);
        assert.ok(body.includes("Manage in DIP: Profile"), c.name);
        assert.ok(body.includes("Hi Sam, "), c.name);
      }
      assert.ok(out.html.includes('href="https://letsdip.work/u/sample-token"'), c.name);
      assert.ok(out.html.includes('Sent by DIP &middot; Questions? <a class="link" href="mailto:support@letsdip.work"'), c.name);
      assert.ok(out.text.includes("Sent by DIP · Questions? support@letsdip.work"), c.name);
      for (const body of [out.html, out.text]) {
        const footer = body.slice(body.indexOf("You are getting this because"));
        assert.ok(!/\d+\s+[A-Z][a-z]+\s+(Street|St|Ave|Avenue|Road|Rd|Blvd)\b/.test(footer) && !footer.includes("placeholder"), `${c.name} footer address`);
      }
      assert.ok(out.html.includes("max-width:600px") && out.html.includes("#1E212B"), c.name);
      assert.ok(out.html.includes("v:roundrect"), c.name);
      assert.ok(out.html.includes("border-color: #2C2F38") && out.html.includes("[data-ogsc]"), c.name);
      assert.ok(out.preheader.length >= 20 && out.preheader.length <= 110 && !out.preheader.startsWith("Hi ") && (out.preheader.endsWith(".") || out.preheader.endsWith("…")) && !out.preheader.includes("...") && !out.preheader.includes("…."), c.name);
      assert.ok(out.html.includes(`mso-hide:all;">`) && out.html.includes(out.preheader.replace(/&/g, "&amp;")), c.name);
      assert.ok(out.html.includes('name="color-scheme" content="light dark"'));
      assert.ok(out.html.includes("prefers-color-scheme: dark"));
      assert.ok(out.html.includes("letsdip.work"));
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
    for (const c of LEGACY_CASES) {
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
    for (const c of LEGACY_CASES) {
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
      venueAddress: EVIL,
      coverImageURL: "catalog://default/hiking",
    };
    const outs = [
      renderEmail("invite_received", { ...base, inviterFirstName: EVIL }, { ...SAMPLE_CTX, recipientFirstName: EVIL }),
      renderEmail("invite_answered", { ...base, inviteeFirstName: EVIL, answer: "accepted" }, SAMPLE_CTX),
      renderEmail("event_changed", { ...base, changedFields: ["time", "venue", "title"], previous: { eventTitle: EVIL, venueName: EVIL, venueAddress: EVIL, startTime: "2026-11-19T23:30:00Z" } }, SAMPLE_CTX),
      renderEmail("challenge_reviewed", { challengeId: "c1", challengeTitle: EVIL, outcome: "approved", points: 3 }, SAMPLE_CTX),
      renderEmail("event_canceled", base, { ...SAMPLE_CTX, unsubscribeURL: 'https://letsdip.work/u/a"b' }),
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
    for (const c of LEGACY_CASES) {
      const { html } = render(c);
      const imgs = html.match(/<img\b[^>]*>/g) ?? [];
      assert.ok(imgs.length >= 2, c.name);
      assert.ok(!html.includes("logo.png"), c.name);
      for (const img of imgs) assert.ok(/\salt="[^"]*"/.test(img), `${c.name}: ${img}`);
      assert.ok(html.includes('<a href="https://letsdip.work/" style="text-decoration:none;"><img class="art" src="https://letsdip.work/img/email/header.png" width="600" height="100" alt="DIP"'), c.name);
      assert.ok(html.indexOf("header.png") < html.indexOf("<h1"), c.name);
      assert.ok(html.includes('src="https://letsdip.work/img/email/footer.png" width="600" height="100" alt=""'), c.name);
      // One transparent image per band (no light/dark swap); the dark band is the dark page colour.
      assert.ok(!html.includes("-dark.png") && !html.includes("dark-img") && !html.includes("light-img"), c.name);
      assert.ok(html.includes(".art-cell { background-color: #121318 !important; }"), c.name);
      assert.ok(html.includes('bgcolor="#F2F3FC"'), c.name);
      for (const m of html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)) assert.ok(m[1]!.startsWith("https://"), `${c.name}: ${m[1]}`);
    }
  });

  test("open pixel renders only when openPixelURL is set, last in the body, never in text", () => {
    for (const c of LEGACY_CASES) {
      const out = render(c);
      const pixel = /<img src="[^"]*\/o\/[^"]*" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" \/>/;
      if (c.ctx.openPixelURL) {
        assert.ok(pixel.test(out.html), c.name);
        assert.ok(out.html.includes(`src="${c.ctx.openPixelURL}"`), c.name);
        const imgs = out.html.match(/<img\b[^>]*>/g)!;
        assert.ok(imgs[imgs.length - 2]!.includes("footer.png") && imgs[imgs.length - 1]!.includes(c.ctx.openPixelURL), c.name);
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
    for (const c of LEGACY_CASES) {
      const { html } = render(c);
      assert.ok(html.includes("<v:roundrect") && html.includes("height:44px"), c.name);
      assert.ok(/padding:0 28px;height:44px;[^"]*line-height:44px/.test(html) && !html.includes("min-height") && html.includes('height="44"'), c.name);
      assert.ok(html.includes("@media (max-width: 620px)") && html.includes(".btn-table { width: 100% !important; }"), c.name);
      assert.ok(!/#4F5BD5|#AEB7FF/i.test(html), c.name);
      const purple = html.split("\n").filter((l) => l.includes("#7B88FA"));
      assert.ok(purple.every((l) => /v:roundrect|btn-table/.test(l)), c.name);
      assert.ok(/<td class="text-muted" style="padding:8px 0;[^"]*"><a class="link" href="[^"]*" style="color:#1E212B;text-decoration:underline;">Unsubscribe/.test(html), c.name);
    }
  });

  test("primary button label is white in light mode and ink in dark mode (link and inner span, Outlook.com parity)", () => {
    for (const c of PREVIEW_CASES) {
      const { html } = render(c);
      // Every purple-filled element that carries text must be the primary button.
      const filled = (html.match(/bgcolor="#7B88FA"[^>]*>(?:(?!<\/td>).)*/g) ?? []).filter((f) => !f.includes("<img")); // art tiles carry no text
      for (const f of filled) assert.ok(f.includes('class="btn-a"') && f.includes('class="btn-t"'), c.name);
      if (filled.length === 0) continue;
      assert.ok(/class="btn-a" href="[^"]*" style="[^"]*color:#FFFFFF;/.test(html), c.name);
      assert.ok(/<span class="btn-t" style="color:#FFFFFF;">/.test(html), c.name);
      assert.ok(/@media \(prefers-color-scheme: dark\) \{[^@]*\.btn-a, \.btn-t \{ color: #1E212B !important; \}/.test(html), c.name);
      assert.ok(html.includes("[data-ogsc] .btn-a, [data-ogsc] .btn-t { color: #1E212B !important; }"), c.name);
    }
  });

  test("header and footer bands are full-bleed rows with the band color and a centered 600px inner table", () => {
    for (const c of LEGACY_CASES) {
      const { html } = render(c);
      const bands = html.match(/<tr><td class="art-cell" align="center" bgcolor="#F2F3FC" width="100%"[^>]*><table [^>]*width="600"[^>]*max-width:100%/g) ?? [];
      assert.equal(bands.length, 2, c.name);
      assert.ok(html.indexOf("header.png") < html.indexOf("<h1") && html.indexOf("<h1") < html.indexOf("footer.png"), c.name);
      // the footer band is the last row of the outer table
      assert.ok(/footer\.png"[^>]*\/>(<img [^>]*width="1"[^>]*\/>)?<\/td><\/tr><\/table><\/td><\/tr>\n<\/table>\n<\/body>/.test(html), c.name);
      assert.ok(html.includes("body, .bg-outer { background-color: #121318 !important; }") && html.includes("[data-ogsb] .art-cell { background-color: #121318 !important; }"), c.name);
      assert.ok(!html.slice(html.indexOf('class="container bg-card')).includes("header.png"), c.name);
    }
  });

  test("footer banner is the last image (before only the pixel), after the unsubscribe link", () => {
    for (const c of LEGACY_CASES) {
      const { html } = render(c);
      const imgs = html.match(/<img\b[^>]*>/g)!;
      const footerIdx = imgs.findIndex((i) => i.includes("footer.png"));
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

  test("event_changed shows struck old values only for what changed", () => {
    const by = (n: string) => render(PREVIEW_CASES.find((c) => c.name === n)!);
    const dels = (html: string) => [...html.matchAll(/<del style="text-decoration:line-through;color:#6B7080;">(.*?)<\/del>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    // time only, same day: strike the old range only
    const t = by("event_changed_time");
    assert.deepEqual(dels(t.html), ["was 5:30\u00A0PM to 7:00\u00A0PM\u00A0EST".replace(/\u00A0/g, "&nbsp;")]);
    assert.ok(t.text.includes("When: Fri, Nov 20, 6:30 PM to 8:00 PM EST  (was: 5:30 PM to 7:00 PM EST)"));
    assert.ok(t.subject === "Updated: Sunset hike at Frick Park (time changed)");
    assert.ok(t.html.includes("Frick Park, Hot Metal Street entrance") && t.html.includes("Hot Metal St, Pittsburgh, PA"));
    // date change: strike the full old string
    const d = by("event_changed_date");
    assert.deepEqual(dels(d.html), ["was Thu, Nov 19, 6:30&nbsp;PM to 8:00&nbsp;PM&nbsp;EST"]);
    assert.ok(d.text.includes("(was: Thu, Nov 19, 6:30 PM to 8:00 PM EST)"));
    assert.ok(d.text.includes("Hi Sam, the date and time changed for this event."));
    assert.equal(d.subject, "Updated: Sunset hike at Frick Park (date changed)");
    assert.ok(t.text.includes("Hi Sam, the time changed for this event."));
    // venue name only
    const v = by("event_changed_venue");
    assert.deepEqual(dels(v.html), ["was Schenley Park, Bartlett Street entrance"]);
    assert.equal(v.subject, "Updated: Sunset hike at Frick Park (location changed)");
    assert.ok(!v.text.includes("When: Fri, Nov 20, 6:30 PM to 8:00 PM EST  (was"));
    // address only
    const a = by("event_changed_address");
    assert.deepEqual(dels(a.html), ["was Beechwood Blvd, Pittsburgh, PA"]);
    assert.ok(a.text.includes("Hot Metal St, Pittsburgh, PA  (was: Beechwood Blvd, Pittsburgh, PA)"));
    // time + venue
    const b = by("event_changed_both");
    assert.equal(dels(b.html).length, 3);
    // old name and old address are grouped above the new name and address
    const w = b.html.slice(b.html.indexOf(">Where<"));
    const pos = ["Schenley Park", "Bartlett St, Pittsburgh", "Frick Park, Hot Metal", "Hot Metal St, Pittsburgh"].map((x) => w.indexOf(x));
    assert.ok(pos.every((x, i) => x > 0 && (i === 0 || x > pos[i - 1]!)), pos.join());
    for (const n of ["event_changed_time", "event_changed_date", "event_changed_venue", "event_changed_address", "event_changed_both", "event_changed_title"]) {
      for (const m of by(n).html.matchAll(/<del\b[^>]*>/g)) assert.ok(m[0].includes("text-decoration:line-through"), n);
    }
    assert.equal(b.subject, "Updated: Sunset hike at Frick Park (time and location changed)");
    assert.ok(b.text.includes("Hi Sam, the time and location changed for this event."));
    // title
    const ti = by("event_changed_title");
    assert.deepEqual(dels(ti.html), ["was Evening walk at Frick Park"]);
    assert.equal(ti.subject, "Updated: Sunset hike at Frick Park (title changed)");
    assert.ok(ti.html.includes(">Event updated<"));
    // unchanged fields get no strike; dark-mode color override exists without a class
    assert.ok(!by("event_changed").html.includes("<del"));
    assert.ok(t.html.includes("del { color: #A3A7B3 !important; }") && t.html.includes("[data-ogsc] del"));
    assert.ok(!/<del[^>]*class=/.test(t.html));
    for (const n of ["event_changed_time", "event_changed_both", "event_changed_title"]) assert.ok(by(n).subject.length <= 78, n);
  });

  test("long titles are truncated so the changed suffix still fits in the subject", () => {
    const out = renderEmail(
      "event_changed",
      { eventId: "e", eventTitle: "Quarterly cross-functional offsite planning session with lunch and games", startTime: "2026-11-20T23:30:00Z", endTime: "2026-11-21T01:00:00Z", changedFields: ["time", "venue"], previous: { startTime: "2026-11-20T20:30:00Z", venueName: "Old" } },
      SAMPLE_CTX,
    );
    assert.ok(out.subject.length <= 78 && out.subject.endsWith("(time and location changed)") && out.subject.includes("..."), out.subject);
  });

  test("hasVisibleChange", () => {
    const base = { eventId: "e", eventTitle: "T", startTime: "2026-11-20T23:30:00Z", endTime: "2026-11-21T01:00:00Z", venueName: "V", venueAddress: "A" };
    assert.equal(hasVisibleChange({ ...base, changedFields: ["details"] }), false);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["time"], previous: { startTime: "2026-11-20T23:30:00Z", endTime: "2026-11-21T01:00:00Z" } }), false);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["time"], previous: { startTime: "2026-11-20T22:30:00Z" } }), true);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["venue"], previous: { venueName: "V", venueAddress: "A" } }), false);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["venue"], previous: { venueAddress: "B" } }), true);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["title"], previous: { eventTitle: " T " } }), false);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["title"], previous: { eventTitle: "Old" } }), true);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["time", "details"] }), true);
    assert.equal(hasVisibleChange({ ...base, changedFields: ["venue", "details"], previous: { venueName: "V" } }), false);
  });

  test("validateVariables handles venueAddress and previous", () => {
    const ok = { eventId: "e", eventTitle: "T", startTime: "2026-11-20T23:30:00Z", endTime: "2026-11-21T01:00:00Z", venueAddress: "x".repeat(200), changedFields: ["time"], previous: { startTime: "2026-11-20T22:30:00Z", venueName: "Old", venueAddress: "Old addr", eventTitle: "Old T" } };
    assert.deepEqual(validateVariables("event_changed", ok), ok);
    assert.equal(validateVariables("event_changed", { ...ok, venueAddress: "x".repeat(201) }), null);
    assert.equal(validateVariables("event_changed", { ...ok, previous: { startTime: "soon" } }), null);
    assert.equal(validateVariables("event_changed", { ...ok, previous: { chatText: "hi" } }), null);
    assert.equal(validateVariables("event_changed", { ...ok, previous: { venueName: "x".repeat(121) } }), null);
    assert.equal(validateVariables("event_changed", { ...ok, previous: "x" }), null);
    assert.equal(validateVariables("event_canceled", ok), null);
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

  test("event_changed leads with an Event updated kicker, the title as the heading, and names what changed", () => {
    const out = render(PREVIEW_CASES.find((c) => c.name === "event_changed")!);
    assert.ok(out.html.includes(">Event updated</p>") && /<h1 dir="auto"[^>]*><span dir="auto">[^<]+<\/span><\/h1>/.test(out.html) && !out.html.includes('class="pill border"') && !out.html.includes("#EEF0FF"));
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
    assert.ok(byName("event_canceled").text.includes("Open it in DIP to see the details, then find another event to join."));
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
    assert.ok(!out.html.replace("mailto:support@letsdip.work", "").includes("mailto:"));
    assert.ok(!out.text.includes("mailto:"));
  });
});
