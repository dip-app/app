/**
 * npm run check:email [-- --online] [-- --verbose]
 * Renders every preview case through renderEmail and runs the compatibility checks. Exit code 1 on any error.
 */
import { renderEmail } from "../../src/modules/email/domain/templates/render";
import { PREVIEW_CASES, PREVIEW_CASES_ES } from "../../src/modules/email/scripts/previewCases";
import { checkEmail, checkOnline, groupFindings, type EmailUnderTest, type Finding } from "./checks";

/** Every preview case in English, then every Spanish twin (named `es_<case>`). */
export function renderAll(): EmailUnderTest[] {
  const cases = [...PREVIEW_CASES.map((c) => ({ c, name: c.name })), ...PREVIEW_CASES_ES.map((c) => ({ c, name: `es_${c.name}` }))];
  return cases.map(({ c, name }) => {
    const r = renderEmail(c.template, c.variables as never, c.ctx);
    return { name, subject: r.subject, html: r.html, text: r.text };
  });
}

export async function runAll(online = false): Promise<{ emails: EmailUnderTest[]; findings: Finding[] }> {
  const emails = renderAll();
  const findings: Finding[] = [];
  for (const e of emails) findings.push(...(await checkEmail(e)));
  if (online) findings.push(...(await checkOnline(emails)));
  return { emails, findings };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const { emails, findings } = await runAll(args.has("--online"));
  const groups = groupFindings(findings);
  const errors = groups.filter((g) => g.level === "error");
  const warnings = groups.filter((g) => g.level === "warning");
  const fmt = (g: (typeof groups)[number]): string => {
    const where = g.clients.length === 1 && g.clients[0] === "*" ? "" : ` [${g.clients.join(", ")}]`;
    const n = g.templates.length === emails.length ? "all templates" : `${g.templates.length} template(s)`;
    return `  ${g.source}:${g.property}${where}: ${g.message} (${n}${g.templates.length <= 3 ? `: ${g.templates.join(", ")}` : ""})${args.has("--verbose") && g.note ? `\n      note: ${g.note}` : ""}`;
  };
  console.log(`Checked ${emails.length} rendered emails against Gmail, Outlook and Apple Mail (caniemail data, html-validate, DIP rules).`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning group(s):`);
    for (const w of warnings) console.log(fmt(w));
  }
  if (errors.length) {
    console.log(`\n${errors.length} ERROR group(s):`);
    for (const e of errors) console.log(fmt(e));
    process.exitCode = 1;
  } else console.log("\nNo errors.");
}

if (require.main === module) void main();
