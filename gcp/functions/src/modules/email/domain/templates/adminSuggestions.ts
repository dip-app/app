import { SHARE_ORIGIN, collapseWhitespace, escapeHtml } from "../../../share/domain/sharePage";
import { truncate, fitSubject } from "./copy";
import {
  EMAIL_ASSET_BASE, FINE, FONT, HAIRLINE, HEAD_FONT, INK, MUTED, SUPPORT_EMAIL, ACCENT, layoutShell, primaryButton,
} from "./layout";
import {
  SUGGESTION_THEMES, type RenderContext, type RenderedEmail, type SuggestionFitLabel, type SuggestionIdeaVariables,
  type SuggestionTheme, type TemplateVariables,
} from "./types";

/**
 * Admin weekly ideas email (docs/design/stretch/admin-suggestions-email.md): 1 to 5 idea cards, each with a theme tile,
 * an optional fit label, a pitch, facts, grounded "why" lines and a deep link, then one primary button. Shares the
 * header, footer and dark mode shell with the event emails (`layout.ts`).
 */

type Vars = TemplateVariables["admin_suggestions"];

export const IDEA_LINK_PREFIX = `${SHARE_ORIGIN}/admin/ideas/suggested/?t=`;
export const IDEAS_URL = `${SHARE_ORIGIN}/admin/ideas/`;
export const MANAGE_URL = `${SHARE_ORIGIN}/admin/suggestions/`;
export const IDEA_MAX = 5;

/** Opaque tile background (also the `bgcolor` fallback while images load), from apps/admin/public/img/themes/ACCENTS.md. */
const THEME_ACCENT: Readonly<Record<SuggestionTheme, string>> = {
  fitness: "#FB72E4", outdoors: "#6BE5D0", food: "#FF7C73", arts: "#7B88FA", games: "#FFCC3E",
  music: "#66D9FF", learning: "#6BFF9B", volunteering: "#1E212B", wellness: "#FF7C73",
};

export const FIT_TEXT: Readonly<Record<SuggestionFitLabel, string>> = { perfect: "Perfect fit", great: "Great choice", good: "Good match" };

// ---------------------------------------------------------------------------------------------
// Validation (strict allow-list)
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const WEEK_KEY = /^\d{4}-W\d{2}$/;
const IDEA_ID = /^[a-z0-9-]{1,64}$/;
const TOKEN_CHARS = /^[A-Za-z0-9_.-]+$/;
const IDEA_KEYS = ["ideaId", "title", "pitch", "theme", "fitLabel", "reasons", "facts", "whenHint", "linkURL"] as const;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (rec: Rec, allowed: readonly string[]): boolean => Object.keys(rec).every((k) => allowed.includes(k));

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = collapseWhitespace(v);
  return s.length >= 1 && s.length <= max ? s : null;
}

function idea(v: unknown): SuggestionIdeaVariables | null {
  if (!isRec(v) || !onlyKeys(v, IDEA_KEYS)) return null;
  const ideaId = typeof v.ideaId === "string" && IDEA_ID.test(v.ideaId) ? v.ideaId : null;
  const title = text(v.title, 80);
  const pitch = text(v.pitch, 160);
  const theme = SUGGESTION_THEMES.find((t) => t === v.theme) ?? null;
  const fitLabel = v.fitLabel === undefined || v.fitLabel === null ? null : (["perfect", "great", "good"] as const).find((f) => f === v.fitLabel) ?? false;
  const facts = text(v.facts, 120);
  const whenHint = v.whenHint === undefined || v.whenHint === null ? null : text(v.whenHint, 80) ?? false;
  const link = typeof v.linkURL === "string" ? v.linkURL : "";
  const linkOk = link.length <= 1024 && link.startsWith(IDEA_LINK_PREFIX) && TOKEN_CHARS.test(link.slice(IDEA_LINK_PREFIX.length));
  const rawReasons = v.reasons === undefined ? [] : v.reasons;
  if (!Array.isArray(rawReasons) || rawReasons.length > 2) return null;
  const reasons: string[] = [];
  for (const r of rawReasons) {
    const t = text(r, 120);
    if (t === null) return null;
    reasons.push(t);
  }
  if (!ideaId || !title || !pitch || !theme || fitLabel === false || !facts || whenHint === false || !linkOk) return null;
  return { ideaId, title, pitch, theme, fitLabel, reasons, facts, whenHint, linkURL: link };
}

/** Returns a new object with only allowed keys, or null for anything unknown, mistyped, overlong or out of enum. */
export function validateAdminSuggestions(value: unknown): Vars | null {
  if (!isRec(value) || !onlyKeys(value, ["weekKey", "weekLabel", "dataNote", "ideas"])) return null;
  const weekKey = typeof value.weekKey === "string" && WEEK_KEY.test(value.weekKey) ? value.weekKey : null;
  const weekLabel = text(value.weekLabel, 40);
  const dataNote = value.dataNote === undefined || value.dataNote === null ? null : text(value.dataNote, 200) ?? false;
  const raw = value.ideas;
  if (!weekKey || !weekLabel || dataNote === false || !Array.isArray(raw) || raw.length < 1 || raw.length > IDEA_MAX) return null;
  const ideas: SuggestionIdeaVariables[] = [];
  for (const r of raw) {
    const i = idea(r);
    if (i === null) return null;
    ideas.push(i);
  }
  return { weekKey, weekLabel, dataNote, ideas };
}

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

function greetingLine(v: Vars, ctx: RenderContext): string {
  const name = ctx.recipientFirstName ? collapseWhitespace(ctx.recipientFirstName).slice(0, 80) : "";
  const hi = name ? `Hi ${name},` : "Hi,";
  const n = v.ideas.length;
  const count = n === 1 ? "here is 1 idea" : `here are ${n} ideas`;
  return v.dataNote === null
    ? `${hi} ${count} for the coming weeks, picked from what your team likes and how past events went.`
    : `${hi} ${count} for the coming weeks.`;
}

function subjectFor(v: Vars): string {
  const label = v.weekLabel.charAt(0).toLowerCase() + v.weekLabel.slice(1);
  return fitSubject("Your event ideas for the ", label);
}

function preheaderFor(v: Vars): string {
  const top = v.ideas[0]!;
  const prefix = "Top pick: ";
  const title = truncate(top.title, 110 - prefix.length);
  const budget = 110 - prefix.length - title.length - 3;
  const second = top.fitLabel ? FIT_TEXT[top.fitLabel] : budget >= 12 ? truncate(top.pitch, budget) : "";
  return second && prefix.length + title.length + 3 + second.length <= 110 ? `${prefix}${title} · ${second}` : `${prefix}${title}`;
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const CARD_BG = "#FFFFFF";

/** Template-specific classes appended to the shared style block. Dark mode via prefers-color-scheme and [data-ogsc]/[data-ogsb]. */
const EXTRA_STYLE = `
  @media (max-width: 620px) {
    .stack { display: block !important; width: 100% !important; box-sizing: border-box !important; }
    .tile-col { padding: 16px 16px 0 16px !important; }
    .tile-td, .tile-box { width: 80px !important; height: 80px !important; }
    .tile-img { width: 80px !important; height: 80px !important; }
    .idea-text { padding: 14px 16px 16px 16px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .idea-card { background-color: #22242C !important; border-color: #2C2F38 !important; }
    .tint-box { background-color: #23252E !important; }
    .fit-pill { background-color: #2E313B !important; color: #ECEDEF !important; }
    .btn2-td { border-color: #7B88FA !important; }
    .btn2-a { color: #ECEDEF !important; }
  }
  [data-ogsb] .idea-card { background-color: #22242C !important; border-color: #2C2F38 !important; }
  [data-ogsb] .tint-box { background-color: #23252E !important; }
  [data-ogsb] .fit-pill { background-color: #2E313B !important; }
  [data-ogsc] .fit-pill, [data-ogsc] .btn2-a { color: #ECEDEF !important; }
`;

const e = escapeHtml;

function tileURL(theme: SuggestionTheme): string {
  return `${EMAIL_ASSET_BASE}ideas/${theme}.png`;
}

function ideaCard(i: SuggestionIdeaVariables, last: boolean): string {
  const accent = THEME_ACCENT[i.theme];
  const pill = i.fitLabel
    ? `<div style="margin:0 0 8px 0;"><span class="fit-pill" style="display:inline-block;padding:3px 10px;background-color:#E8EAF8;border-radius:999px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;color:${INK};">${e(FIT_TEXT[i.fitLabel])}</span></div>`
    : "";
  const why = i.reasons.length
    ? `<div class="text-muted" style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">Why this idea</div>
<ul style="margin:0 0 8px 0;padding:0 0 0 18px;">${i.reasons
        .map((r) => `<li dir="auto" class="text-main" style="margin:0 0 2px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${INK};">${e(r)}</li>`)
        .join("")}</ul>`
    : "";
  const when = i.whenHint
    ? `<p dir="auto" class="text-muted" style="margin:0 0 12px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};">${e(i.whenHint)}</p>`
    : "";
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr><td class="btn2-td" align="center" height="40" style="height:40px;border:2px solid ${ACCENT};border-radius:8px;"><a class="btn2-a" href="${e(i.linkURL)}" aria-label="Start this event: ${e(i.title)}" title="${e(i.title)}" style="display:inline-block;padding:0 18px;mso-padding-alt:0 18px;height:36px;font-family:${FONT};font-size:15px;line-height:36px;font-weight:700;color:${INK};text-decoration:none;"><!--[if mso]>&nbsp;&nbsp;<![endif]-->Start this event<!--[if mso]>&nbsp;&nbsp;<![endif]--></a></td></tr></table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="idea-card border" style="margin:0 0 ${last ? "20px" : "16px"} 0;background-color:${CARD_BG};border:1px solid ${HAIRLINE};border-radius:12px;border-collapse:separate;">
<tr>
<td class="stack tile-col" width="112" valign="top" style="width:112px;padding:16px 0 16px 16px;">
<table role="presentation" class="tile-box" width="112" cellpadding="0" cellspacing="0" border="0" style="width:112px;"><tr><td class="tile-td" width="112" height="112" bgcolor="${accent}" style="width:112px;height:112px;background-color:${accent};border-radius:8px;font-size:0;line-height:0;"><img src="${tileURL(i.theme)}" width="112" height="112" alt="" class="tile-img" style="display:block;width:112px;height:112px;border:0;border-radius:8px;" /></td></tr></table>
</td>
<td class="stack idea-text" valign="top" style="padding:16px;">
${pill}<h2 dir="auto" class="text-main" style="margin:0 0 6px 0;padding:0;font-family:${HEAD_FONT};font-size:20px;line-height:26px;font-weight:normal;letter-spacing:0.02em;color:${INK};">${e(i.title)}</h2>
<p dir="auto" class="text-main" style="margin:0 0 8px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(i.pitch)}</p>
<p dir="auto" class="text-muted" style="margin:0 0 12px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};">${e(i.facts)}</p>
${why}${when}${button}
</td>
</tr>
</table>`;
}

function plainText(v: Vars, lead: string, unsubscribeURL: string): string {
  const lines: string[] = ["YOUR WEEKLY EVENT IDEAS", "", lead, ""];
  if (v.dataNote) lines.push(v.dataNote, "");
  v.ideas.forEach((i, n) => {
    lines.push(`${n + 1}. ${i.title}${i.fitLabel ? ` [${FIT_TEXT[i.fitLabel]}]` : ""}`);
    lines.push(`   ${i.pitch}`, `   ${i.facts}`);
    if (i.reasons.length) {
      lines.push("   Why this idea:");
      for (const r of i.reasons) lines.push(`   - ${r}`);
    }
    if (i.whenHint) lines.push(`   When: ${i.whenHint}`);
    lines.push("   Start this event:", `   ${i.linkURL}`, "");
  });
  lines.push(`Open event ideas: ${IDEAS_URL}`, "", "--");
  lines.push("You get this because you turned on weekly event ideas for admins.");
  lines.push(`Unsubscribe: ${unsubscribeURL}`);
  lines.push(`Manage in the admin portal: ${MANAGE_URL}`);
  lines.push(`Sent by DIP · Questions? ${SUPPORT_EMAIL}`);
  return `${lines.join("\n")}\n`;
}

/** Renders the admin weekly ideas email to subject, preheader, table-based HTML and a plain-text alternative. */
export function renderAdminSuggestions(variables: Vars, ctx: RenderContext): RenderedEmail {
  const subject = subjectFor(variables);
  const preheader = preheaderFor(variables);
  const lead = greetingLine(variables, ctx);
  const note = variables.dataNote
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;"><tr><td dir="auto" class="tint-box text-main" bgcolor="#F2F3FC" style="padding:12px 16px;background-color:#F2F3FC;border-radius:8px;font-family:${FONT};font-size:15px;line-height:22px;color:${INK};">${e(variables.dataNote)}</td></tr></table>`
    : "";
  const cards = variables.ideas.map((i, n) => ideaCard(i, n === variables.ideas.length - 1)).join("\n");
  const html = layoutShell({
    title: subject,
    preheader,
    ctx,
    extraStyle: EXTRA_STYLE,
    fluid: true,
    main: `<h1 class="text-main" style="margin:0 0 12px 0;font-family:${HEAD_FONT};font-size:24px;line-height:30px;font-weight:normal;letter-spacing:0.02em;color:${INK};">Your weekly event ideas</h1>
<p class="text-main" style="margin:0 0 20px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${e(lead)}</p>
${note}${cards}
${primaryButton(IDEAS_URL, "Open event ideas")}`,
    footerRows: `<tr><td class="text-muted" style="padding:0;${FINE}">You get this because you turned on weekly event ideas for admins.</td></tr>
<tr><td class="text-muted" style="padding:12px 0;${FINE}"><a class="link" href="${e(ctx.unsubscribeURL)}" style="color:${INK};text-decoration:underline;">Unsubscribe</a> &middot; <a class="link" href="${MANAGE_URL}" style="color:${INK};text-decoration:underline;">Manage in the admin portal</a></td></tr>
<tr><td class="text-muted" style="padding:0;${FINE}">Sent by DIP &middot; Questions? <a class="link" href="mailto:${SUPPORT_EMAIL}" style="color:${INK};text-decoration:underline;">${SUPPORT_EMAIL}</a></td></tr>`,
  });
  return { subject, preheader, html, text: plainText(variables, lead, ctx.unsubscribeURL) };
}
