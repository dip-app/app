/**
 * Renders every email template with sample data for visual review.
 * Usage: npm run email:preview -- [outputDir] [--asset-base <url>]   (default dir: <tmp>/dip-email-preview)
 * --asset-base rewrites https://letsdip.work/img/email/ to <url>/ in the written preview files only (for a local
 * server of apps/admin/public/img/email); production rendering always uses the absolute https URLs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escapeHtml } from "../../share/domain/sharePage";
import { EMAIL_ASSET_BASE, renderEmail } from "../domain/templates/render";
import { PREVIEW_CASES } from "./previewCases";

const args = process.argv.slice(2);
let assetBase: string | null = null;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--asset-base") assetBase = (args[++i] ?? "").replace(/\/+$/, "");
  else positional.push(args[i]!);
}
const outDir = positional[0] ?? join(tmpdir(), "dip-email-preview");
const localize = (html: string): string => (assetBase ? html.split(EMAIL_ASSET_BASE).join(`${assetBase}/`) : html);
mkdirSync(outDir, { recursive: true });

const items: string[] = [];
for (const c of PREVIEW_CASES) {
  const rendered = renderEmail(c.template, c.variables as never, c.ctx);
  writeFileSync(join(outDir, `${c.name}.html`), localize(rendered.html));
  writeFileSync(join(outDir, `${c.name}.txt`), rendered.text);
  items.push(`<section style="margin:0 0 32px 0;">
<h2 style="font:600 15px system-ui;margin:0 0 4px 0;">${escapeHtml(c.name)}</h2>
<p style="font:13px system-ui;color:#555;margin:0 0 8px 0;">Subject: ${escapeHtml(rendered.subject)} (<a href="${escapeHtml(c.name)}.txt">text</a>)</p>
<iframe src="${escapeHtml(c.name)}.html" style="width:100%;max-width:680px;height:640px;border:1px solid #ccc;" title="${escapeHtml(c.name)}"></iframe>
</section>`);
}

writeFileSync(
  join(outDir, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DIP email previews</title></head><body style="margin:24px;font-family:system-ui;">
<h1 style="font:600 20px system-ui;">DIP email previews</h1>
${items.join("\n")}
</body></html>
`,
);

console.log(`Wrote ${PREVIEW_CASES.length} previews to ${outDir}`);
