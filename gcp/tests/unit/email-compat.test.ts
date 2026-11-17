import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkEmail, groupFindings, MAX_HTML_BYTES, type EmailUnderTest } from "../../functions/tools/emailCompat/checks";
import { renderAll, runAll } from "../../functions/tools/emailCompat/cli";

// Email client compatibility gate (docs/ops/email-compatibility.md). Offline: no network, no sends.

describe("email compatibility checker on the real templates", () => {
  it("renders every template variant with no errors", async () => {
    const { emails, findings } = await runAll();
    assert.ok(emails.length >= 20, "all preview cases are checked");
    const errors = groupFindings(findings).filter((g) => g.level === "error");
    assert.deepEqual(
      errors.map((e) => `${e.source}:${e.property} ${e.clients.join(",")} ${e.message} [${e.templates.join(",")}]`),
      [],
    );
  });

  it("covers event-updated with and without strikethrough, and the open pixel", () => {
    const by = new Map(renderAll().map((e) => [e.name, e.html]));
    assert.match(by.get("event_changed_both")!, /<del /);
    assert.doesNotMatch(by.get("event_changed")!, /<del /);
    assert.match(by.get("invite_received_with_pixel")!, /width="1" height="1"/);
  });

  it("keeps every email under the Gmail clipping limit with room to spare", () => {
    for (const e of renderAll()) assert.ok(Buffer.byteLength(e.html) < MAX_HTML_BYTES, `${e.name} is ${Buffer.byteLength(e.html)} bytes`);
  });
});

describe("email compatibility checker catches regressions", () => {
  const good = renderAll().find((e) => e.name === "event_changed_both")!;
  const run = async (mutate: (html: string) => string, patch: Partial<EmailUnderTest> = {}) => {
    const findings = await checkEmail({ ...good, ...patch, html: mutate(good.html) });
    return findings.filter((f) => f.level === "error").map((f) => `${f.source}:${f.property}`);
  };

  it("passes the unmodified template", async () => {
    assert.deepEqual(await run((h) => h), []);
  });

  it("flags flexbox, float, CSS variables and position in inline styles", async () => {
    const errs = await run((h) => h.replace('<body class="bg-outer" style="', '<body class="bg-outer" style="display:flex;float:left;color:var(--x);position:fixed;'));
    for (const want of ["dip:float", "dip:css-variables", "dip:display", "dip:position"]) assert.ok(errs.includes(want), `${want} in ${errs.join(",")}`);
  });

  it("flags layout that lives only in <style>", async () => {
    assert.ok((await run((h) => h.replace("<style>", "<style>.x { width: 600px; }"))).includes("dip:style-layout"));
    assert.ok((await run((h) => h.replace("@media (max-width: 620px) {", "@media (max-width: 620px) {\n .y { width: 100%; }"))).includes("dip:style-important"));
  });

  it("flags images without alt or size, and non-https or foreign hosts", async () => {
    const errs = await run((h) => h.replace('width="600" height="100" alt="DIP"', "").replace("https://letsdip.work/img/email/footer.png", "http://example.com/x.png"));
    for (const want of ["dip:img-alt", "dip:img-size", "dip:img-src"]) assert.ok(errs.includes(want), `${want} in ${errs.join(",")}`);
  });

  it("flags broken and foreign links", async () => {
    const errs = await run((h) => h.replace('href="mailto:support@letsdip.work"', 'href="#"').replace(/href="https:\/\/letsdip\.work\/u\/[^"]*"/, 'href="https://evil.example/u"'));
    assert.ok(errs.includes("dip:link") && errs.includes("dip:link-host"), errs.join(","));
  });

  it("flags missing dark-mode meta and dark rules", async () => {
    const errs = await run((h) => h.replace(/<meta name="color-scheme"[^>]*>\n/, "").replace(/prefers-color-scheme: dark/g, "prefers-color-scheme: nope"));
    assert.ok(errs.includes("dip:dark-mode-meta") && errs.includes("dip:dark-mode-css"), errs.join(","));
  });

  it("flags oversize HTML, and a missing or HTML plain-text part", async () => {
    assert.ok((await run((h) => `${h}<!-- ${"x".repeat(MAX_HTML_BYTES)} -->`)).includes("dip:html-size"));
    assert.ok((await run((h) => h, { text: "" })).includes("dip:text-part"));
    assert.ok((await run((h) => h, { text: "<p>hi</p> Unsubscribe: https://letsdip.work/u/t" })).includes("dip:text-part"));
  });

  it("flags unsupported features with no reviewed fallback (caniemail) and invalid structure (html-validate)", async () => {
    const sticky = await run((h) => h.replace("<h1 ", '<h1 hidden-is-not-real="1" style="font-variant:small-caps;" '));
    assert.ok(sticky.some((e) => e.startsWith("html-validate:")) || sticky.some((e) => e.startsWith("caniemail:")), sticky.join(","));
    const structure = await run((h) => h.replace("</tr>\n</table>\n</body>", "</table>\n</body>"));
    assert.ok(structure.some((e) => e.startsWith("html-validate:")), structure.join(","));
  });
});
