// Guardrail helper for the backend phase of #259: the server's stable message keys (typed errors, audit summaries) and
// the admin portal's catalogs must stay in step. Returns human-readable problems; an empty list means it is consistent.
// Run with `node --import tsx` (it imports the TypeScript catalogs directly, like scripts/admin-i18n/check.ts).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "../../apps/admin/src/lib/i18n/catalog/en/index.ts";
import { es } from "../../apps/admin/src/lib/i18n/catalog/es/index.ts";
import { AUDIT_SUMMARY_KEYS } from "../../gcp/functions/src/modules/admin/domain/auditSummaries.ts";
import { ERROR_MESSAGES } from "../../gcp/functions/src/modules/i18n/domain/errorMessages.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FUNCTIONS_SRC = join(ROOT, "gcp", "functions", "src");
/** Modules whose typed errors reach the admin portal (the others, such as invites or photos, are member app errors). */
const PORTAL_MODULES = ["admin", "organizer", "challenges", "submissions", "ai", "covers", "places", "suggestions"];

const portalEn = en as Readonly<Record<string, string>>;
const portalEs = es as Readonly<Record<string, string>>;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== "generated" && name !== "node_modules") out.push(...sourceFiles(path)); }
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(ROOT, path);

/** Server error keys against the portal `errors` catalogs: present in en and es, identical English. */
function errorCatalogProblems(): string[] {
  const problems: string[] = [];
  for (const [key, text] of Object.entries(ERROR_MESSAGES)) {
    if (!(key in portalEn)) problems.push(`portal en catalog is missing ${key}`);
    else if (portalEn[key] !== text) problems.push(`portal en text for ${key} differs from the server: "${portalEn[key]}" vs "${text}"`);
    if (!(key in portalEs)) problems.push(`portal es catalog is missing ${key}`);
  }
  return problems;
}

/** Every audit summary key has `audit.summary.<key>` in the portal en and es catalogs. */
function summaryCatalogProblems(): string[] {
  const problems: string[] = [];
  for (const key of AUDIT_SUMMARY_KEYS) {
    const catalogKey = `audit.summary.${key}`;
    if (!(catalogKey in portalEn)) problems.push(`portal en catalog is missing ${catalogKey}`);
    if (!(catalogKey in portalEs)) problems.push(`portal es catalog is missing ${catalogKey}`);
  }
  return problems;
}

const DOTTED_KEY = /"([a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+)"/g;

/** `summaryKey:` literals written in the backend (also the branches of a conditional) must be in AUDIT_SUMMARY_KEYS. */
function summaryKeyUseProblems(): string[] {
  const problems: string[] = [];
  const known = new Set<string>(AUDIT_SUMMARY_KEYS);
  for (const file of sourceFiles(FUNCTIONS_SRC)) {
    const text = readFileSync(file, "utf8");
    for (const hit of text.matchAll(/\bsummaryKey:/g)) {
      const rest = text.slice(hit.index + hit[0].length);
      const end = Math.min(...[rest.indexOf("summaryParams"), rest.indexOf("\n")].filter((i) => i >= 0));
      for (const literal of rest.slice(0, end).matchAll(DOTTED_KEY)) {
        if (!known.has(literal[1])) problems.push(`${rel(file)}: summaryKey "${literal[1]}" is not in AUDIT_SUMMARY_KEYS`);
      }
    }
  }
  return problems;
}

const ERROR_LITERAL = /new\s+[A-Za-z]+Error\(\s*"[a-z-]+"\s*,\s*"([A-Z_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;

/** Literal messages of typed errors in the portal-facing modules must be in ERROR_MESSAGES (internal ones excepted). */
function errorLiteralProblems(): string[] {
  const problems: string[] = [];
  const known = new Set<string>(Object.values(ERROR_MESSAGES));
  for (const module of PORTAL_MODULES) {
    const dir = join(FUNCTIONS_SRC, "modules", module);
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(file, "utf8");
      for (const hit of text.matchAll(ERROR_LITERAL)) {
        const reason = hit[1];
        const message = JSON.parse(`"${hit[2]}"`) as string;
        if (reason.startsWith("INVALID_STORED_") || message === "Write attempted in a read-only transaction.") continue;
        if (!known.has(message)) problems.push(`${rel(file)}: error message "${message}" (${reason}) is not in ERROR_MESSAGES`);
      }
    }
  }
  return problems;
}

/** All problems; an empty list means the server keys and the portal catalogs agree. */
export function checkPortalKeys(): string[] {
  return [...errorCatalogProblems(), ...summaryCatalogProblems(), ...summaryKeyUseProblems(), ...errorLiteralProblems()];
}
