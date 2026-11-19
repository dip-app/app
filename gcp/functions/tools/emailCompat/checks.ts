/**
 * Email client compatibility checks for the rendered HTML templates. Free, local, no network by default.
 *
 * Layers:
 *  1. caniemail (caniemail.com data) for Gmail, Outlook and Apple Mail, classified into errors and warnings.
 *  2. html-validate for document structure (relaxed for email: tables, presentational attributes, inline styles).
 *  3. Our own checks for rules the generic tools cannot know (Gmail clipping size, inline-only layout, asset hosts, ...).
 * See docs/ops/email-compatibility.md.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "htmlparser2";
import { emailCatalogs } from "../../src/modules/email/domain/templates/i18n";

export type Level = "error" | "warning";
export interface Finding {
  level: Level;
  source: "caniemail" | "html-validate" | "dip";
  template: string;
  /** Property, element or rule name, e.g. "border-radius" or "image-alt". */
  property: string;
  /** Client id (caniemail naming, e.g. "gmail.ios") or "*" when not client specific. */
  client: string;
  message: string;
  note?: string;
}
export interface EmailUnderTest {
  name: string;
  subject: string;
  html: string;
  text: string;
}

/** Gmail clips messages larger than about 102 KB. We keep a margin and fail at 100 KB. */
export const GMAIL_CLIP_BYTES = 102 * 1024;
export const MAX_HTML_BYTES = 100_000;
export const WARN_HTML_BYTES = 80_000;
export const CLIENT_GLOBS = ["gmail.*", "outlook.*", "apple-mail.*"] as const;
const ALLOWED_HOSTS = new Set(["letsdip.work"]);
/** Hosts allowed only for the optional web font stylesheet (progressive enhancement, falls back to system fonts). */
const FONT_HOSTS = new Set(["fonts.googleapis.com"]);
export const ASSET_DIR = join(__dirname, "..", "..", "..", "..", "apps", "admin", "public", "img", "email");

// ---------------------------------------------------------------------------------------------
// Tiny HTML and CSS helpers
// ---------------------------------------------------------------------------------------------

interface Node {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: Node[];
  data?: string;
  startIndex?: number;
}

function walk(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}

function elements(html: string): Node[] {
  const out: Node[] = [];
  walk(parseDocument(html, { withStartIndices: true }) as unknown as Node, (n) => {
    if (n.type === "tag" || n.type === "style" || n.type === "script") out.push(n);
  });
  return out;
}

function textOf(node: Node): string {
  let s = "";
  walk(node, (n) => {
    if (n.type === "text") s += n.data ?? "";
  });
  return s;
}

function lineOf(html: string, index: number | undefined): number | undefined {
  return index === undefined ? undefined : html.slice(0, index).split("\n").length;
}

/** Splits "a:b;c:url(x;y)" on top-level semicolons. */
function splitDecls(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  const flush = (): void => {
    const i = cur.indexOf(":");
    if (i > 0) out.push([cur.slice(0, i).trim().toLowerCase(), cur.slice(i + 1).trim()]);
    cur = "";
  };
  for (const ch of style) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

interface CssRule {
  selector: string;
  decls: Array<[string, string]>;
  /** The at-rule prelude the rule sits in, e.g. "@media (prefers-color-scheme: dark)"; "" at top level. */
  context: string;
}

/** Minimal CSS parser (rules, @media nesting, @import). Enough for the hand-written template style block. */
export function parseCss(css: string): { rules: CssRule[]; imports: string[] } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const imports: string[] = [];
  const block = (text: string, context: string): void => {
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (i >= text.length) break;
      if (text.startsWith("@import", i)) {
        const end = text.indexOf(";", i);
        imports.push(text.slice(i, end < 0 ? text.length : end).trim());
        i = end < 0 ? text.length : end + 1;
        continue;
      }
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith("@")) block(body, prelude);
      else rules.push({ selector: prelude, decls: splitDecls(body), context });
      i = j;
    }
  };
  block(src, "");
  return { rules, imports };
}

function classesIn(selector: string): string[] {
  return [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Own checks
// ---------------------------------------------------------------------------------------------

/** Properties that must not be used for layout in email (stripped or broken in Gmail, Outlook Word engine, or both). */
const FORBIDDEN_PROPS: Array<[RegExp, string]> = [
  [/^(float|clear)$/, "float/clear is unreliable (Outlook ignores it); use tables"],
  [/^(grid|grid-.*|gap|row-gap|column-gap)$/, "CSS grid is not supported by Gmail or Outlook; use tables"],
  [/^(flex|flex-.*|justify-content|align-items|align-content|order)$/, "flexbox is not supported by Outlook Windows; use tables"],
  [/^(transform|transition|animation|filter|clip-path|mask)$/, "not supported by Gmail or Outlook; do not rely on it"],
  [/^z-index$/, "z-index is stripped by Gmail"],
];

function checkOwn(email: EmailUnderTest): Finding[] {
  const f: Finding[] = [];
  const add = (level: Level, property: string, message: string, client = "*"): void => {
    f.push({ level, source: "dip", template: email.name, property, client, message });
  };
  const { html } = email;
  const bytes = Buffer.byteLength(html, "utf8");

  // Size: Gmail clips the message body at ~102 KB and hides the rest behind "View entire message".
  if (bytes > MAX_HTML_BYTES) add("error", "html-size", `HTML is ${bytes} bytes; Gmail clips at about ${GMAIL_CLIP_BYTES} bytes. Keep under ${MAX_HTML_BYTES}.`, "gmail.*");
  else if (bytes > WARN_HTML_BYTES) add("warning", "html-size", `HTML is ${bytes} bytes; getting close to the Gmail clipping limit (${GMAIL_CLIP_BYTES}).`, "gmail.*");

  // Document essentials.
  if (!/^<!doctype html>/i.test(html.trimStart())) add("error", "doctype", "Missing <!doctype html>.");
  if (!/<html[^>]*\slang="[a-z-]+"/i.test(html)) add("warning", "html-lang", "Missing lang attribute on <html> (screen readers, hyphenation).");
  if (!/<meta charset="utf-8">/i.test(html)) add("error", "charset", "Missing <meta charset=utf-8>.");
  if (!/<meta name="viewport"/i.test(html)) add("error", "viewport", "Missing viewport meta (mobile clients render at desktop width).");
  if (!/<title>[^<]+<\/title>/i.test(html)) add("warning", "title", "Missing or empty <title>.");
  if (!email.subject.trim() || /[\r\n]/.test(email.subject)) add("error", "subject", "Subject is empty or contains a line break.");

  // Dark mode support: meta plus a prefers-color-scheme rule plus the Outlook.com data-ogsc rules.
  if (!/<meta name="color-scheme" content="[^"]*dark/i.test(html)) add("error", "dark-mode-meta", 'Missing <meta name="color-scheme" content="light dark">.');
  if (!/<meta name="supported-color-schemes" content="[^"]*dark/i.test(html)) add("error", "dark-mode-meta", 'Missing <meta name="supported-color-schemes" content="light dark">.');

  const els = elements(html);
  const styleEls = els.filter((e) => e.name === "style");
  const css = styleEls.map((e) => textOf(e)).join("\n");
  const parsed = parseCss(css);
  const darkMedia = parsed.rules.filter((r) => /prefers-color-scheme:\s*dark/.test(r.context));
  if (darkMedia.length === 0) add("error", "dark-mode-css", "No @media (prefers-color-scheme: dark) rules (Apple Mail, Gmail app on some platforms).");
  const ogs = parsed.rules.filter((r) => /\[data-og(sc|sb)\]/.test(r.selector));
  if (ogs.length === 0) add("warning", "dark-mode-css", "No [data-ogsc]/[data-ogsb] rules (Outlook.com and Outlook apps dark mode).", "outlook.*");

  // Dark-mode parity: every class the prefers-color-scheme block restyles must exist in the markup and have an Outlook.com counterpart.
  const usedClasses = new Set<string>();
  for (const e of els) for (const c of (e.attribs?.class ?? "").split(/\s+/).filter(Boolean)) usedClasses.add(c);
  const darkClasses = new Set(darkMedia.flatMap((r) => classesIn(r.selector)));
  const ogsClasses = new Set(ogs.flatMap((r) => classesIn(r.selector)));
  for (const c of darkClasses) {
    // Classes such as .pill only exist when the template has that element, so unused classes are not an error.
    if (usedClasses.has(c) && !ogsClasses.has(c) && ogs.length > 0 && !["container"].includes(c)) add("warning", "dark-mode-parity", `Class .${c} has a prefers-color-scheme rule but no [data-ogsc]/[data-ogsb] rule.`, "outlook.*");
  }

  // Essential layout must not depend on <style>: non-@media rules may only be harmless resets.
  const RESET_PROPS = new Set(["margin", "padding", "-ms-interpolation-mode"]);
  for (const r of parsed.rules) {
    if (r.context || /\[data-og(sc|sb)\]/.test(r.selector)) {
      // Responsive and dark rules must override inline styles, so every declaration needs !important.
      for (const [p, v] of r.decls) if (!/!important/i.test(v)) add("error", "style-important", `"${r.selector} { ${p} }" in ${r.context || "an Outlook.com override"} lacks !important; inline styles would win and the rule would never apply.`);
    } else {
      for (const [p] of r.decls) if (!RESET_PROPS.has(p)) add("error", "style-layout", `"${r.selector} { ${p} }" in <style> outside @media: essential styling must be inline (Gmail drops <style> in some apps).`, "gmail.*");
    }
  }
  for (const e of els) if (e.name === "style" && /<style/i.test(textOf(e))) add("error", "style-nested", "Nested <style>.");

  // Per-element checks (inline styles).
  let firstTable: Node | null = null;
  for (const e of els) {
    if (e.name === "table" && !firstTable) firstTable = e;
    const style = e.attribs?.style;
    const decls = style ? splitDecls(style) : [];
    for (const [p, v] of decls) {
      for (const [re, why] of FORBIDDEN_PROPS) if (re.test(p)) add("error", p, `<${e.name}> style uses ${p}: ${why}.`);
      if (/var\(\s*--/.test(v)) add("error", "css-variables", `<${e.name}> uses a CSS variable in ${p}; Gmail and Outlook do not support them.`);
      if (/calc\(|clamp\(|min\(|max\(/.test(v)) add("error", "css-function", `<${e.name}> uses a CSS function in ${p}; not supported by Outlook/Gmail.`);
      if (/\d(vw|vh|rem)\b/.test(v)) add("error", "css-units", `<${e.name}> uses vw/vh/rem units in ${p}; not reliable in email clients.`);
      if (p === "position") {
        // Only the visually hidden "was " text may use absolute positioning; it must also carry clip so a client that
        // strips position still hides it as well as possible.
        if (v !== "absolute" || !/clip:/.test(style ?? "")) add("error", "position", `<${e.name}> uses position:${v}; only the visually hidden helper span may use position:absolute.`);
      }
      if (p === "display" && /^(flex|inline-flex|grid|inline-grid|contents)$/.test(v)) add("error", "display", `<${e.name}> uses display:${v}; use tables.`);
      if ((p === "background-image" || (p === "background" && /url\(/.test(v))) && !(e.attribs?.bgcolor && /background-color/.test(style ?? ""))) {
        add("error", "background-image", `<${e.name}> uses a background image without both a bgcolor attribute and a background-color fallback (Outlook, Gmail with images off).`);
      }
      if (p === "font-size") {
        const px = /^([\d.]+)px$/.exec(v);
        if (px && Number(px[1]) < 12 && Number(px[1]) > 1 && !/display:none/.test(style ?? "")) add("warning", "font-size", `<${e.name}> font-size ${v} is below 12px (iOS/Gmail may enlarge or be unreadable).`);
      }
      if (p === "font-family" && !/(sans-serif|serif|monospace)\s*$/i.test(v)) add("warning", "font-family", `<${e.name}> font-family has no generic fallback at the end.`);
    }
    if (e.name === "img") {
      const a = e.attribs ?? {};
      const src = a.src ?? "";
      if (a.alt === undefined) add("error", "img-alt", `<img src=${src}> has no alt attribute.`);
      if (!/^\d+$/.test(a.width ?? "") || !/^\d+$/.test(a.height ?? "")) add("error", "img-size", `<img src=${src}> needs numeric width and height attributes (Outlook ignores CSS sizes).`);
      if (!src.startsWith("https://")) add("error", "img-src", `<img src=${src}> must be an absolute https URL.`);
      else if (!ALLOWED_HOSTS.has(hostOf(src) ?? "")) add("error", "img-host", `<img src=${src}> is not on letsdip.work.`);
      if (!/(^|;)\s*border:\s*0/.test(a.style ?? "") ) add("warning", "img-border", `<img src=${src}> has no border:0 (old Outlook adds a link border).`);
      if (!/display:\s*(block|none)/.test(a.style ?? "")) add("warning", "img-display", `<img src=${src}> is not display:block (Gmail adds a gap under inline images).`);
    }
    if (e.name === "a") {
      const href = e.attribs?.href ?? "";
      if (!href || href === "#" || /^javascript:/i.test(href) || /undefined|null|\{\{/.test(href)) add("error", "link", `Broken link href="${href}".`);
      else if (href.startsWith("mailto:")) {
        if (!/^mailto:[^\s@]+@letsdip\.work$/.test(href)) add("warning", "link", `Unexpected mailto target ${href}.`);
      } else if (!href.startsWith("https://")) add("error", "link", `Link ${href} must be an absolute https URL.`);
      else if (!ALLOWED_HOSTS.has(hostOf(href) ?? "")) add("error", "link-host", `Link ${href} is not on letsdip.work.`);
      if (!textOf(e).trim() && !e.children?.some((c) => c.name === "img" && c.attribs?.alt)) add("warning", "link-text", `Link ${href} has no text or image alt.`);
    }
    if (e.name === "link") {
      const href = e.attribs?.href ?? "";
      if (!FONT_HOSTS.has(hostOf(href) ?? "")) add("error", "link-host", `<link href=${href}> is not an allowed font host.`);
    }
    if (e.name === "script" || e.name === "iframe" || e.name === "form" || e.name === "video" || e.name === "object" || e.name === "embed") add("error", "element", `<${e.name}> is stripped or blocked by Gmail and Outlook.`);
  }

  // Outlook for Mac strips <body>; the outer table must carry the page background too.
  if (firstTable && !(firstTable.attribs?.style ?? "").includes("background-color")) add("warning", "outer-background", "Outer table has no background-color (Outlook for Mac strips <body>).", "outlook.macos");

  // @import only for fonts, and web fonts must have a generic fallback (checked on inline font-family above).
  for (const i of parsed.imports) {
    const m = /url\(['"]?([^'")]+)/.exec(i);
    if (!m || !FONT_HOSTS.has(hostOf(m[1]!) ?? "")) add("error", "css-import", `@import of ${i} is not an allowed font host.`);
  }

  // Light/dark image pairs: each light image has a dark twin that is hidden inline by default.
  const imgs = els.filter((e) => e.name === "img");
  const light = imgs.filter((e) => (e.attribs?.class ?? "").includes("light-img"));
  const dark = imgs.filter((e) => (e.attribs?.class ?? "").includes("dark-img"));
  if (light.length !== dark.length) add("error", "dark-images", `${light.length} light-img but ${dark.length} dark-img images.`);
  for (const d of dark) {
    const s = d.attribs?.style ?? "";
    if (!/display:\s*none/.test(s) || !/max-height:\s*0/.test(s) || !/mso-hide:\s*all/.test(s)) add("error", "dark-images", "dark-img must be hidden inline with display:none, max-height:0 and mso-hide:all so clients without dark-mode CSS show only the light image.");
    if (!/-dark\.png$/.test(d.attribs?.src ?? "")) add("error", "dark-images", `dark-img src ${d.attribs?.src} is not a -dark.png asset.`);
  }
  for (const l of light) if (/display:\s*none/.test(l.attribs?.style ?? "")) add("error", "dark-images", "light-img must be visible by default.");

  // Referenced brand assets exist in the repo (the admin site deploys them to letsdip.work/img/email/).
  for (const i of imgs) {
    const src = i.attribs?.src ?? "";
    const m = /^https:\/\/letsdip\.work\/img\/email\/([\w.-]+)$/.exec(src);
    if (m && !existsSync(join(ASSET_DIR, m[1]!))) add("error", "asset-missing", `${src} has no file in apps/admin/public/img/email/.`);
  }

  // Plain-text part.
  const text = email.text;
  if (!text.trim()) add("error", "text-part", "Plain-text alternative is empty.");
  else {
    if (/<\/?[a-z][^>]*>/i.test(text)) add("error", "text-part", "Plain-text alternative contains HTML tags.");
    // "Unsubscribe: https://letsdip.work/..." in any shipped language ("Cancelar suscripción: ..." in Spanish); roster
    // invitations say "Stop invitation emails: ..." (the person has no account to manage).
    const unsubscribeWords = Object.values(emailCatalogs).flatMap((c) => [c["email.footer.unsubscribe"], c["email.footer.unsubscribeInvites"]]);
    if (!unsubscribeWords.some((w) => text.includes(`${w}: https://letsdip.work/`))) add("error", "text-part", "Plain-text alternative lacks the unsubscribe link.");
    const htmlLinks = new Set(els.filter((e) => e.name === "a" && e.attribs?.href?.startsWith("https://")).map((e) => e.attribs!.href!));
    const missing = [...htmlLinks].filter((h) => !text.includes(h.replace(/&amp;/g, "&")));
    for (const m of missing) add("warning", "text-part", `Link ${m} is in the HTML but not in the plain-text part.`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// caniemail
// ---------------------------------------------------------------------------------------------

/** Features that only appear in the progressive-enhancement layer (head, <style>, media queries). Unsupported means fallback. */
const ENHANCEMENT_TITLES = new Set([
  "<style> element",
  "<link> element",
  "@import",
  "@media",
  "color-scheme meta tag",
  "Type selector",
  "Class selector",
  "Attribute selector",
  "Descendant combinator",
  "Child combinator",
  "!important keyword",
]);

/**
 * Known, reviewed degradations of essential markup. Each entry says why the template still works. Matching is by
 * caniemail feature title and a client prefix list; an unsupported feature that is not listed here is an error.
 */
export const REVIEWED_DEGRADATIONS: Array<{ title: string; clients: string[]; reason: string }> = [
  { title: "position", clients: ["gmail.", "outlook.", "apple-mail."], reason: 'only the visually hidden "was " helper before struck-through old values; where position is stripped the word "was" shows, which reads fine' },
  { title: "display:none", clients: ["gmail.mobile-webmail"], reason: "preheader and dark-mode image swap; both also have max-height:0, overflow:hidden and zero-size fallbacks" },
  { title: "opacity", clients: ["gmail.mobile-webmail", "outlook.windows", "outlook.windows-mail"], reason: "preheader only; it also uses color:transparent, max-height:0 and mso-hide:all" },
  { title: "border-radius", clients: ["outlook.windows", "outlook.windows-mail"], reason: "square corners in Word engine; the button is a VML roundrect for classic Outlook" },
  { title: "max-height property", clients: ["outlook.windows", "outlook.windows-mail"], reason: "used only on hidden helpers, which also have mso-hide:all" },
  { title: "overflow", clients: ["outlook.windows", "outlook.windows-mail"], reason: "used only on hidden helpers and the rounded card; Word engine shows a square card" },
  { title: "white-space", clients: ["outlook.windows", "outlook.windows-mail"], reason: "only on the visually hidden helper" },
  { title: "role attribute", clients: ["outlook.windows-mail"], reason: 'role="presentation" is an accessibility hint only' },
  { title: "aria-label attribute", clients: ["outlook.windows-mail"], reason: "accessible names on repeated link buttons only; the same name is in the title attribute and the visible text still reads" },
  { title: "<body> element", clients: ["outlook.macos"], reason: "background is also set on the outer table" },
];

interface IssueLike {
  title: string;
  support: string;
  notes: string[];
  position?: { start: { line: number } };
}

export async function checkCanIEmail(email: EmailUnderTest): Promise<Finding[]> {
  const { caniemail } = await import("caniemail");
  const result = caniemail({ clients: [...CLIENT_GLOBS], html: email.html });
  const lines = email.html.split("\n");
  const styleStart = lines.findIndex((l) => l.startsWith("<style>")) + 1;
  const styleEnd = lines.findIndex((l, i) => i >= styleStart - 1 && l.startsWith("</style>")) + 1;
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const kind of ["errors", "warnings"] as const) {
    for (const [client, list] of result.issues[kind]) {
      for (const issue of list as IssueLike[]) {
        const line = issue.position?.start.line;
        const inStyleBlock = line !== undefined && line >= styleStart && line <= styleEnd;
        const enhancement = inStyleBlock || ENHANCEMENT_TITLES.has(issue.title);
        const key = `${kind}|${client}|${issue.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const note = issue.notes[0];
        const base = { source: "caniemail" as const, template: email.name, property: issue.title, client, ...(note ? { note } : {}) };
        if (kind === "warnings") {
          out.push({ ...base, level: "warning", message: `partial support${enhancement ? " (enhancement layer)" : ""}` });
        } else if (enhancement) {
          out.push({ ...base, level: "warning", message: "unsupported (enhancement layer; inline styles are the fallback)" });
        } else {
          const ok = REVIEWED_DEGRADATIONS.find((d) => d.title === issue.title && d.clients.some((c) => client.startsWith(c)));
          if (ok) out.push({ ...base, level: "warning", message: `unsupported, reviewed: ${ok.reason}` });
          else out.push({ ...base, level: "error", message: "unsupported with no reviewed fallback" });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// html-validate
// ---------------------------------------------------------------------------------------------

/**
 * Email HTML legitimately uses presentational attributes, inline styles, tables for layout and role=presentation, so
 * those rules are off. Everything else in the recommended preset stays on (unclosed tags, duplicate ids, bad nesting,
 * missing alt, invalid attributes).
 */
const HTML_VALIDATE_RULES: Record<string, "off" | "error" | "warn"> = {
  "no-inline-style": "off",
  "no-deprecated-attr": "off",
  "prefer-native-element": "off",
  "no-redundant-role": "off",
  "attr-quotes": "off",
  "void-style": "off",
  "doctype-style": "off",
  "no-trailing-whitespace": "off",
  "require-sri": "off",
  "wcag/h63": "off",
  "wcag/h30": "off",
  "valid-id": "off",
  "no-implicit-button-type": "off",
  "heading-level": "off",
  "long-title": "off",
  "element-case": "off",
  "attribute-empty-style": "off",
  "attribute-boolean-style": "off",
  "no-conditional-comment": "off", // MSO conditional comments are the only way to target classic Outlook (VML button)
  "presentation-role-style": "off",
  "prefer-tbody": "off",
};

export async function checkHtmlValidate(email: EmailUnderTest): Promise<Finding[]> {
  const { HtmlValidate } = await import("html-validate");
  const validator = new HtmlValidate({ extends: ["html-validate:recommended"], rules: HTML_VALIDATE_RULES });
  const report = await validator.validateString(email.html);
  const out: Finding[] = [];
  for (const r of report.results) {
    for (const m of r.messages) {
      out.push({
        level: m.severity === 2 ? "error" : "warning",
        source: "html-validate",
        template: email.name,
        property: m.ruleId ?? "html",
        client: "*",
        message: `${m.message} (line ${m.line})`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export async function checkEmail(email: EmailUnderTest): Promise<Finding[]> {
  return [...checkOwn(email), ...(await checkCanIEmail(email)), ...(await checkHtmlValidate(email))];
}

/** Optional network check (default off): HEAD each brand asset and the site root so a missing deploy is caught. */
export async function checkOnline(emails: EmailUnderTest[]): Promise<Finding[]> {
  const urls = new Set<string>(["https://letsdip.work/"]);
  for (const e of emails) for (const m of e.html.matchAll(/https:\/\/letsdip\.work\/img\/email\/[\w.-]+/g)) urls.add(m[0]);
  const out: Finding[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) out.push({ level: "error", source: "dip", template: "*", property: "online-link", client: "*", message: `${url} returned ${res.status}` });
    } catch (err) {
      out.push({ level: "error", source: "dip", template: "*", property: "online-link", client: "*", message: `${url} unreachable: ${String(err)}` });
    }
  }
  return out;
}

/** Groups findings by source, property and message across templates, for compact reporting. */
export function groupFindings(findings: Finding[]): Array<{ level: Level; source: string; property: string; message: string; clients: string[]; templates: string[]; note?: string }> {
  const map = new Map<string, { level: Level; source: string; property: string; message: string; clients: Set<string>; templates: Set<string>; note?: string }>();
  for (const f of findings) {
    const baseMessage = f.message;
    const key = `${f.level}|${f.source}|${f.property}|${baseMessage}`;
    let g = map.get(key);
    if (!g) {
      g = { level: f.level, source: f.source, property: f.property, message: baseMessage, clients: new Set(), templates: new Set(), ...(f.note ? { note: f.note } : {}) };
      map.set(key, g);
    }
    g.clients.add(f.client);
    g.templates.add(f.template);
  }
  return [...map.values()].map((g) => ({ ...g, clients: [...g.clients].sort(), templates: [...g.templates].sort() }));
}
