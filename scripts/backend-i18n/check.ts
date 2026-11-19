// Backend i18n guardrail (issue #259 backend phase, docs/design/backend-i18n.md), part of `npm run check`:
//   npm run check:backend-i18n
// Fails when a server catalog (email, push) has a Spanish key that is missing, empty, unparsable or has different
// placeholders or plural forms than English; when a catalog key is never used in the functions source (or code uses a
// key the catalog lacks); and when the server's typed error / audit summary keys and the admin portal catalogs drift
// (scripts/backend-i18n/portalKeys.ts).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { emailCatalogs } from "../../gcp/functions/src/modules/email/domain/templates/i18n/index.ts";
import { pushCatalogs } from "../../gcp/functions/src/modules/notifications/domain/i18n/index.ts";
import { checkCatalogs } from "../../gcp/functions/src/modules/i18n/domain/catalog.ts";
import { checkPortalKeys } from "./portalKeys.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ServerCatalog {
  name: string;
  /** Prefix every key of this catalog starts with ("email.", "push."). */
  prefix: string;
  en: Readonly<Record<string, string>>;
  es: Readonly<Record<string, string>>;
  /** Source directory whose `.ts` files use the keys (the catalog folder itself is skipped). */
  sourceDir: string;
  /** Key prefixes built from data in code (template literals such as `email.reason.${category}`). */
  dynamicPrefixes: readonly string[];
}

export const SERVER_CATALOGS: readonly ServerCatalog[] = [
  {
    name: "email", prefix: "email.", en: emailCatalogs.en, es: emailCatalogs.es,
    sourceDir: "gcp/functions/src/modules/email", dynamicPrefixes: ["email.reason.", "email.ideas.fit."],
  },
  {
    name: "push", prefix: "push.", en: pushCatalogs.en, es: pushCatalogs.es,
    sourceDir: "gcp/functions/src/modules/notifications", dynamicPrefixes: ["push.change.label."],
  },
];

function sourceFiles(dir: string, skip: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (path !== skip) out.push(...sourceFiles(path, skip)); }
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** Keys of `catalog` that no source file mentions, and quoted `prefix...` keys in source that the catalog lacks. */
export function usageProblems(catalog: ServerCatalog, sources: ReadonlyArray<{ file: string; text: string }>): string[] {
  const problems: string[] = [];
  const keys = new Set(Object.keys(catalog.en));
  // Log event names share the prefix ("email.result"), so only strings in a namespace the catalog uses count as keys.
  const namespaces = new Set([...keys].map((key) => key.split(".")[1]));
  const used = new Set<string>();
  const literal = new RegExp(`["'\`](${catalog.prefix.replace(/\./g, "\\.")}[A-Za-z0-9_.]+)["'\`]`, "g");
  for (const { file, text } of sources) {
    for (const match of text.matchAll(literal)) {
      const key = match[1]!;
      used.add(key);
      if (!keys.has(key) && namespaces.has(key.split(".")[1]) && !catalog.dynamicPrefixes.some((p) => key.startsWith(p) && key.length === p.length)) {
        problems.push(`${catalog.name}: ${relative(ROOT, file)} uses ${key}, which is not in the catalog`);
      }
    }
  }
  for (const key of keys) {
    if (used.has(key) || catalog.dynamicPrefixes.some((p) => key.startsWith(p))) continue;
    problems.push(`${catalog.name}: ${key} is never used`);
  }
  return problems;
}

export function runChecks(): string[] {
  const problems: string[] = [];
  for (const catalog of SERVER_CATALOGS) {
    for (const key of Object.keys(catalog.en)) if (!key.startsWith(catalog.prefix)) problems.push(`${catalog.name}: ${key} must start with ${catalog.prefix}`);
    problems.push(...checkCatalogs(catalog.name, catalog.en, catalog.es));
    const dir = join(ROOT, catalog.sourceDir);
    const catalogDir = join(dir, catalog.name === "email" ? "domain/templates/i18n" : "domain/i18n");
    const sources = sourceFiles(dir, catalogDir).map((file) => ({ file, text: readFileSync(file, "utf8") }));
    problems.push(...usageProblems(catalog, sources));
  }
  problems.push(...checkPortalKeys());
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = runChecks();
  const total = SERVER_CATALOGS.reduce((n, c) => n + Object.keys(c.en).length, 0);
  if (problems.length) {
    console.error(`Backend i18n check failed (${problems.length}):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`Backend i18n OK: ${SERVER_CATALOGS.map((c) => `${c.name} ${Object.keys(c.en).length}`).join(", ")} keys (${total}) in en and es; server error and audit keys match the admin portal.`);
  }
}
