import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { icsAttachmentFor } from "../../functions/src/modules/email/domain/ics";
import { renderEmail, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { TEMPLATE_CATEGORY, templateKind, type TemplateVariables } from "../../functions/src/modules/email/domain/templates/types";
import { PREVIEW_CASES, SAMPLE_CTX } from "../../functions/src/modules/email/scripts/previewCases";
import { resolvePreferences } from "../../functions/src/modules/notifications/domain/preferences";
import { channelOffers, NOTIFICATION_KINDS } from "../../functions/src/modules/notifications/domain/categories";

const CASES = PREVIEW_CASES.filter((c) => c.template === "admin_suggestions");
const by = (name: string) => CASES.find((c) => c.name === name)!;
const vars = (name: string) => by(name).variables as TemplateVariables["admin_suggestions"];
const render = (name: string) => renderEmail("admin_suggestions", vars(name), by(name).ctx);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const EVIL = '<script>alert("x")</script> & "q"';

describe("admin_suggestions registry", () => {
  test("category is email only, default off, never offered to push", () => {
    assert.equal(TEMPLATE_CATEGORY.admin_suggestions, "admin_suggestions");
    assert.equal(templateKind("admin_suggestions"), "admin_suggestions");
    assert.equal(NOTIFICATION_KINDS.admin_suggestions.category, "admin_suggestions");
    assert.equal(channelOffers("email", "admin_suggestions"), true);
    assert.equal(channelOffers("push", "admin_suggestions"), false);
    assert.equal(resolvePreferences(undefined).email.admin_suggestions, false);
    assert.equal(resolvePreferences({ email: { admin_suggestions: true } }).email.admin_suggestions, true);
    assert.equal(resolvePreferences({ push: { admin_suggestions: true } }).push.admin_suggestions, false);
  });

  test("no calendar attachment", () => {
    assert.equal(icsAttachmentFor("admin_suggestions", vars("admin_suggestions"), 0), null);
  });
});

describe("admin_suggestions validation", () => {
  const good = () => clone(vars("admin_suggestions"));

  test("every preview case validates and returns a new object", () => {
    for (const c of CASES) {
      const out = validateVariables("admin_suggestions", c.variables);
      assert.deepEqual(out, c.variables, c.name);
      assert.notEqual(out, c.variables);
    }
  });

  test("optional fields default to null", () => {
    const v = good() as unknown as Record<string, unknown>;
    delete v.dataNote;
    const idea = (v.ideas as Array<Record<string, unknown>>)[0]!;
    delete idea.fitLabel; delete idea.whenHint; delete idea.reasons;
    const out = validateVariables("admin_suggestions", v)!;
    assert.equal(out.dataNote, null);
    assert.deepEqual([out.ideas[0]!.fitLabel, out.ideas[0]!.whenHint, out.ideas[0]!.reasons], [null, null, []]);
  });

  test("rejects extra keys, bad enums, bad links and overlong values", () => {
    const bad = (mutate: (v: any) => void): void => {
      const v = good();
      mutate(v);
      assert.equal(validateVariables("admin_suggestions", v), null);
    };
    bad((v) => { v.name = "Sam"; });
    bad((v) => { v.ideas[0].email = "a@b.c"; });
    bad((v) => { v.weekKey = "2026-49"; });
    bad((v) => { v.weekLabel = "x".repeat(41); });
    bad((v) => { v.dataNote = "x".repeat(201); });
    bad((v) => { v.ideas = []; });
    bad((v) => { v.ideas = Array.from({ length: 6 }, () => v.ideas[0]); });
    bad((v) => { v.ideas[0].theme = "sports"; });
    bad((v) => { v.ideas[0].fitLabel = "excellent"; });
    bad((v) => { v.ideas[0].fitLabel = 92; });
    bad((v) => { v.ideas[0].ideaId = "Has_Caps"; });
    bad((v) => { v.ideas[0].title = "x".repeat(81); });
    bad((v) => { v.ideas[0].pitch = "x".repeat(161); });
    bad((v) => { v.ideas[0].facts = "x".repeat(121); });
    bad((v) => { v.ideas[0].whenHint = "x".repeat(81); });
    bad((v) => { v.ideas[0].reasons = ["a", "b", "c"]; });
    bad((v) => { v.ideas[0].reasons = ["x".repeat(121)]; });
    bad((v) => { v.ideas[0].linkURL = "https://evil.example/admin/ideas/suggested/?t=abc"; });
    bad((v) => { v.ideas[0].linkURL = "http://letsdip.work/admin/ideas/suggested/?t=abc"; });
    bad((v) => { v.ideas[0].linkURL = "https://letsdip.work/admin/ideas/suggested/?t=abc&x=1"; });
    bad((v) => { v.ideas[0].linkURL = "https://letsdip.work/admin/ideas/suggested/?t="; });
    bad((v) => { v.ideas[0].linkURL = `https://letsdip.work/admin/ideas/suggested/?t=${"a".repeat(1010)}`; });
    for (const nonObject of [null, undefined, "x", 5, [], true]) assert.equal(validateVariables("admin_suggestions", nonObject), null);
  });

  test("accepts values at the limits", () => {
    const out = validateVariables("admin_suggestions", by("admin_suggestions_long").variables);
    assert.ok(out && out.ideas.length === 5 && out.ideas[0]!.title.length <= 80 && out.dataNote!.length <= 200);
  });
});

describe("admin_suggestions rendering", () => {
  test("subject, preheader and greeting", () => {
    const rich = render("admin_suggestions");
    assert.equal(rich.subject, "Your event ideas for the week of Nov 30");
    assert.equal(rich.preheader, "Top pick: Winter trail walk and cocoa · Perfect fit");
    assert.ok(rich.text.includes("Hi Sam, here are 4 ideas for the coming weeks, picked from what your team likes and how past events went."));
    assert.ok(rich.html.includes(">Your weekly event ideas<"));
    const noLabels = render("admin_suggestions_no_data");
    assert.ok(noLabels.preheader.startsWith("Top pick: Winter trail walk and cocoa · A relaxed loop"));
    const long = render("admin_suggestions_long");
    assert.ok(long.subject.length <= 78 && long.preheader.length <= 110, `${long.subject.length} ${long.preheader.length}`);
    assert.ok(long.text.includes("\nHi, here are 5 ideas"));
    for (const n of ["admin_suggestions", "admin_suggestions_no_data", "admin_suggestions_long"]) {
      const out = render(n);
      for (const s of [out.subject, out.preheader, out.html, out.text]) assert.ok(!s.includes("—"), n);
      const visible = out.html.slice(out.html.indexOf("<body")).replace(/<[^>]*>/g, " ");
      assert.ok(!/%/.test(visible) && !/%|percent/i.test(out.text), n);
    }
  });

  test("single idea reads naturally", () => {
    const v = { ...clone(vars("admin_suggestions")), ideas: [clone(vars("admin_suggestions").ideas[0]!)] };
    assert.ok(renderEmail("admin_suggestions", v, SAMPLE_CTX).text.includes("Hi Sam, here is 1 idea for the coming weeks"));
  });

  test("fit labels render as friendly text, only when present", () => {
    const out = render("admin_suggestions");
    assert.ok(out.html.includes(">Perfect fit<") && out.html.includes(">Great choice<") && out.html.includes(">Good match<"));
    assert.equal((out.html.match(/class="fit-pill"/g) ?? []).length, 3);
    assert.ok(out.text.includes("[Perfect fit]") && out.text.includes("[Great choice]") && out.text.includes("[Good match]"));
    const none = render("admin_suggestions_no_data");
    assert.ok(!none.html.includes('class="fit-pill"') && !none.text.includes("["));
    assert.ok(none.html.includes("We don&#39;t have much activity") || none.html.includes("We don't have much activity"));
    assert.ok(none.html.includes('class="tint-box text-main"') && !none.text.includes("picked from what your team likes"));
  });

  test("every variable is HTML escaped", () => {
    const v = clone(vars("admin_suggestions"));
    v.dataNote = EVIL;
    v.ideas[0]!.title = EVIL.slice(0, 80);
    v.ideas[0]!.pitch = EVIL;
    v.ideas[0]!.facts = EVIL;
    v.ideas[0]!.whenHint = EVIL;
    v.ideas[0]!.reasons = [EVIL, EVIL];
    const out = renderEmail("admin_suggestions", v, { ...SAMPLE_CTX, recipientFirstName: EVIL, unsubscribeURL: 'https://letsdip.work/u/a"b' });
    assert.ok(!out.html.includes("<script>") && !out.html.includes('alert("x")') && out.html.includes("&lt;script&gt;"));
    assert.ok(!out.html.includes('u/a"b'));
  });

  test("links: idea links, primary button, unsubscribe, manage and support", () => {
    const out = render("admin_suggestions");
    for (const i of vars("admin_suggestions").ideas) {
      assert.ok(out.html.includes(`href="${i.linkURL}"`), i.ideaId);
      assert.ok(out.text.includes(`\n   ${i.linkURL}\n`), i.ideaId);
    }
    assert.equal((out.html.match(/>Start this event&nbsp;&rarr;</g) ?? []).length, 4);
    assert.ok(out.html.includes('href="https://letsdip.work/admin/ideas/"') && out.html.includes(">Open event ideas<") && out.html.includes("v:roundrect"));
    assert.ok(out.text.includes("Open event ideas: https://letsdip.work/admin/ideas/"));
    for (const body of [out.html, out.text]) {
      assert.ok(body.includes("You are getting this because you turned on weekly event ideas for admins."));
      assert.ok(body.includes("https://letsdip.work/u/sample-token") && body.includes("Unsubscribe"));
      assert.ok(body.includes("https://letsdip.work/admin/suggestions/") && body.includes("Manage in the admin portal"));
    }
    assert.ok(out.html.includes('Sent by DIP &middot; Questions? <a class="link" href="mailto:support@letsdip.work"'));
    assert.ok(out.text.includes("Sent by DIP · Questions? support@letsdip.work"));
    assert.ok(!/\d+\s+[A-Z][a-z]+\s+(Street|St|Ave|Avenue|Road|Rd|Blvd)\b/.test(out.html.slice(out.html.indexOf("You are getting this because"))));
  });

  test("theme tiles are opaque, sized, decorative and built from the asset base", () => {
    const out = render("admin_suggestions");
    for (const theme of ["outdoors", "music", "games", "food"]) {
      assert.ok(out.html.includes(`<img src="https://letsdip.work/img/email/ideas/${theme}.png" width="112" height="112" alt=""`), theme);
    }
    assert.ok(out.html.includes('bgcolor="#6BE5D0"') && out.html.includes('bgcolor="#66D9FF"'));
    const imgs = out.html.match(/<img\b[^>]*>/g)!;
    for (const img of imgs) assert.ok(/\salt="[^"]*"/.test(img) && /src="https:\/\//.test(img), img);
  });

  test("footer banner is the last image, after the unsubscribe link and the idea cards", () => {
    for (const c of CASES) {
      const { html } = renderEmail("admin_suggestions", c.variables as never, c.ctx);
      const imgs = html.match(/<img\b[^>]*>/g)!;
      assert.ok(imgs[imgs.length - 1]!.includes("footer.png"), c.name);
      assert.ok(html.indexOf("footer.png") > html.indexOf(">Unsubscribe<") && html.indexOf(">Unsubscribe<") > html.lastIndexOf("ideas/"), c.name);
      assert.ok(html.indexOf("header.png") < html.indexOf("<h1"), c.name);
      assert.ok(/footer\.png"[^>]*\/><\/td><\/tr><\/table><\/td><\/tr>\n<\/table>\n<\/body>/.test(html), c.name);
    }
  });

  test("cards use uniform hairlines and a 12px radius; no one-sided borders on rounded elements", () => {
    const { html } = render("admin_suggestions");
    assert.ok(html.includes("border:1px solid #E6E7EE;border-radius:12px"));
    assert.ok(html.includes('class="btn2-a"') && html.includes("height:44px;font-family") && html.includes("color:#4A56D6;text-decoration:underline;"));
    for (const c of CASES) {
      for (const m of renderEmail("admin_suggestions", c.variables as never, c.ctx).html.matchAll(/<[a-z0-9]+\b[^>]*\sstyle="([^"]*)"/g)) {
        const style = m[1]!;
        if (/border-radius/.test(style)) assert.ok(!/border-(left|right|top|bottom)\s*:/.test(style), `${c.name}: ${style}`);
      }
    }
  });

  test("mobile stacking and dark mode hooks", () => {
    const { html } = render("admin_suggestions");
    assert.ok(html.includes(".stack { display: block !important; width: 100% !important;") && html.includes('class="stack tile-col"') && html.includes('class="stack idea-text"'));
    assert.ok(html.includes("@media (prefers-color-scheme: dark)") && html.includes(".idea-card { background-color: #22242C !important;") && html.includes("[data-ogsb] .idea-card"));
    assert.ok(!/display\s*:\s*(inline-)?(flex|grid)/i.test(html));
  });

  test("plain text mirrors the html content", () => {
    const out = render("admin_suggestions");
    assert.ok(out.text.startsWith("YOUR WEEKLY EVENT IDEAS\n"));
    for (const i of vars("admin_suggestions").ideas) {
      for (const s of [i.title, i.pitch, i.facts, ...i.reasons, ...(i.whenHint ? [i.whenHint] : [])]) assert.ok(out.text.includes(s), s);
    }
    assert.ok(out.text.includes("1. Winter trail walk and cocoa") && out.text.includes("4. Holiday cookie swap"));
    assert.ok(out.text.includes("Why this idea:") && out.text.includes("When: Works well on a Thursday afternoon"));
  });

  test("open pixel stays after the footer banner", () => {
    const c = by("admin_suggestions");
    const out = renderEmail("admin_suggestions", c.variables as never, { ...c.ctx, openPixelURL: "https://letsdip.work/o/t.gif" });
    const imgs = out.html.match(/<img\b[^>]*>/g)!;
    assert.ok(imgs[imgs.length - 2]!.includes("footer.png") && imgs[imgs.length - 1]!.includes("/o/t.gif"));
    assert.ok(!out.text.includes("/o/"));
  });
});
