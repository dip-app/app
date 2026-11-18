import { SHARE_ORIGIN, escapeHtml } from "../../../share/domain/sharePage";
import type { RenderContext } from "./types";

/**
 * Shared email shell (head, styles, preheader, full-bleed header band, white card, footer rows, footer band) and the
 * primary button, used by the event renderer (`render.ts`) and the admin weekly ideas renderer (`adminSuggestions.ts`).
 */

export const ACCENT = "#7B88FA";
export const INK = "#1E212B";
export const MUTED = "#5B6070";
export const STRIKE = "#8A8F9E";
export const SUPPORT_EMAIL = "support@letsdip.work";
export const HAIRLINE = "#E6E7EE";
export const ART_BG = "#F2F3FC";
export const FONT_URL = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700&family=Fjalla+One&display=swap";
export const FONT = "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const HEAD_FONT = "'Fjalla One', 'Arial Narrow', Arial, sans-serif";
export const EMAIL_ASSET_BASE = `${SHARE_ORIGIN}/img/email/`;

export const STYLE = `
  @import url('${FONT_URL}');
  body, table, td { margin: 0; padding: 0; }
  img { -ms-interpolation-mode: bicubic; }
  @media (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .btn-table { width: 100% !important; }
    .btn-a { display: block !important; text-align: center !important; }
    .lbl { width: 56px !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .bg-outer { background-color: #121318 !important; }
    .bg-card { background-color: #1B1D24 !important; border-color: #2C2F38 !important; }
    .text-main { color: #ECEDEF !important; }
    .text-muted { color: #A3A7B3 !important; }
    del { color: #A3A7B3 !important; }
    .border { border-color: #2C2F38 !important; }
    .pill { border-color: #2C2F38 !important; color: #ECEDEF !important; }
    .link { color: #ECEDEF !important; }
    .art-cell { background-color: #23252E !important; }
    .light-img { display: none !important; max-height: 0 !important; overflow: hidden !important; }
    .dark-img { display: block !important; max-height: none !important; overflow: visible !important; }
    .btn-a, .btn-t { color: #1E212B !important; }
  }
  [data-ogsc] .light-img, [data-ogsb] .light-img { display: none !important; max-height: 0 !important; overflow: hidden !important; }
  [data-ogsc] .dark-img, [data-ogsb] .dark-img { display: block !important; max-height: none !important; overflow: visible !important; }
  [data-ogsb] .art-cell { background-color: #23252E !important; }
  [data-ogsc] .text-main, [data-ogsc] .link { color: #ECEDEF !important; }
  [data-ogsc] .text-muted { color: #A3A7B3 !important; }
  [data-ogsc] .btn-a, [data-ogsc] .btn-t { color: #1E212B !important; }
  [data-ogsc] del { color: #A3A7B3 !important; }
  [data-ogsc] .pill { color: #ECEDEF !important; border-color: #2C2F38 !important; }
  [data-ogsb] .bg-outer, [data-ogsb] body { background-color: #121318 !important; }
  [data-ogsb] .bg-card { background-color: #1B1D24 !important; border-color: #2C2F38 !important; }
  [data-ogsb] .border { border-color: #2C2F38 !important; }
`;

export const MSO_STYLE = `<!--[if mso]>
<style type="text/css">body, table, td, a, p, div, span, h1 { font-family: Arial, sans-serif !important; }</style>
<![endif]-->`;


const e = escapeHtml;

/**
 * Bulletproof primary button (purple fill, 44px) with a VML roundrect fallback for classic Outlook. Label colour rule:
 * white (#FFFFFF) in light mode (inline base), ink (#1E212B) in dark mode (about 5.2:1 on #7B88FA; white is only about
 * 3.1:1). The dark override targets the link (`btn-a`) and an inner span (`btn-t`) because clients restyle the `<a>`.
 * The VML fallback stays white (classic Outlook has no dark CSS).
 */
export function primaryButton(href: string, labelText: string): string {
  const cta = e(href);
  const label = e(labelText);
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${cta}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="18%" stroke="f" fillcolor="${ACCENT}"><w:anchorlock/><center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<table role="presentation" class="btn-table" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr><td align="center" height="44" bgcolor="${ACCENT}" style="height:44px;background-color:${ACCENT};border-radius:8px;"><a class="btn-a" href="${cta}" style="display:inline-block;padding:0 28px;height:44px;font-family:${FONT};font-size:16px;line-height:44px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;"><span class="btn-t" style="color:#FFFFFF;">${label}</span></a></td></tr></table>
<!--<![endif]-->`;
}

/** Inline style of the small print lines in the footer. */
export const FINE = `font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};`;

export interface ShellInput {
  /** `<title>` text (unescaped). */
  title: string;
  /** Hidden inbox preview text (unescaped). */
  preheader: string;
  /** HTML inside the first padded cell of the white card (heading, copy, cards, button). */
  main: string;
  /** `<tr>` rows of the footer table (reason, links, sender line). */
  footerRows: string;
  /** Extra CSS appended to the shared style block (template-specific classes, light and dark). */
  extraStyle?: string;
  ctx: Pick<RenderContext, "openPixelURL">;
  /** Card table is `width:100%;max-width:600px` (keeps the width attribute) so it stays fluid when a client strips `<style>`. Default false. */
  fluid?: boolean;
}

/** Wraps template content in the shared document: header band, white card, footer rows, footer band (last visible image). */
export function layoutShell(input: ShellInput): string {
  const pixel = input.ctx.openPixelURL
    ? `<img src="${e(input.ctx.openPixelURL)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`
    : "";

  const IMG = "width:100%;max-width:100%;height:auto;border:0;";
  const HIDDEN = "display:none;mso-hide:all;max-height:0;overflow:hidden;";
  const pair = (file: "header" | "footer", alt: string, extraStyle: string): string =>
    `<img class="art light-img" src="${EMAIL_ASSET_BASE}${file}.png" width="600" height="100" alt="${alt}" style="display:block;${IMG}${extraStyle}" /><img class="art dark-img" src="${EMAIL_ASSET_BASE}${file}-dark.png" width="600" height="100" alt="${alt}" style="${HIDDEN}${IMG}${extraStyle}" />`;
  // Full-bleed band: a 100%-wide cell in the band color holding a centered 600px table with the art.
  const artCell = (inner: string): string =>
    `<tr><td class="art-cell" align="center" bgcolor="${ART_BG}" width="100%" style="padding:0;background-color:${ART_BG};font-size:0;line-height:0;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container" style="width:600px;max-width:100%;"><tr><td style="padding:0;font-size:0;line-height:0;">${inner}</td></tr></table></td></tr>`;
  const header = artCell(`<a href="${SHARE_ORIGIN}/" style="text-decoration:none;">${pair("header", "DIP", `font-family:${HEAD_FONT};font-size:20px;line-height:100px;color:${INK};`)}</a>`);
  const footerArt = artCell(`${pair("footer", "", "")}${pixel}`);

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(input.title)}</title>
<link rel="stylesheet" href="${FONT_URL}">
${MSO_STYLE}
<style>${STYLE}${input.extraStyle ?? ""}
</style>
</head>
<body class="bg-outer" style="margin:0;padding:0;background-color:#F2F3FC;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${e(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#F2F3FC;">
${header}
<tr><td align="center" class="bg-outer" style="padding:24px 12px;background-color:#F2F3FC;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container bg-card border" style="${input.fluid ? "width:100%;max-width:600px;" : "width:600px;max-width:600px;"}background-color:#FFFFFF;border:1px solid ${HAIRLINE};border-radius:8px;border-collapse:separate;overflow:hidden;">
<tr><td class="px" style="padding:28px 28px 20px 28px;">
${input.main}
</td></tr>
<tr><td class="px" style="padding:8px 28px 16px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${input.footerRows}
</table>
</td></tr>
</table></td></tr>
${footerArt}
</table>
</body>
</html>
`;
}
