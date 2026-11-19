// Guardrail for the admin portal's message catalogs (apps/admin/src/lib/i18n). Run with `npm run check:admin-i18n`.
//
// Fails on:
//   - Spanish keys that are missing, empty or not in English; messages that do not parse;
//   - placeholder mismatches between English and a translation, and Spanish plurals without a "one" form;
//   - keys used in code but missing from the catalog, and catalog keys nothing uses;
//   - in migrated files (marked `// @i18n-migrated`): likely hard-coded UI strings, `"en-US"` formatting and `t()`
//     called at module scope (a module constant would keep the language it was built in).
// Reviewed exceptions live in scripts/admin-i18n-allowlist.txt (file<TAB>text). `--update-allowlist` rewrites it
// from the current findings; review the diff before committing it. See docs/design/admin-i18n.md.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { en } from "../../apps/admin/src/lib/i18n/catalog/en/index.ts";
import { es } from "../../apps/admin/src/lib/i18n/catalog/es/index.ts";
import { argumentsOf, pluralOptionsOf } from "../../apps/admin/src/lib/i18n/icu.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SRC = "apps/admin/src";
export const ALLOWLIST = "scripts/admin-i18n-allowlist.txt";
export const MARKER = "@i18n-migrated";
const CATALOG_DIR = `${SRC}/lib/i18n/catalog/`;
/** Keys under these prefixes are built from data (an option id, an error code), so a literal never names them. */
export const DYNAMIC_PREFIXES = [
  "ai.goal.", "ai.size.", "ai.setting.", "ai.budget.", "ai.timing.", "ai.bucket.", "ai.limit.", "ai.level.",
  "ai.consider.group.", "ai.venue.kind.", "ai.venue.reason.", "ai.venue.setting.", "ai.suggest.by.", "ai.suggest.spoken.",
  "ai.ideasForYou.day.", "ai.ideasForYou.daypart.", "ai.step.",
  "common.role.", "shell.ask.",
  // Server message keys (typed errors, audit summaries): the key arrives from the backend with the response.
  "errors.", "audit.summary.",
];

type Catalog = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------------------------------------------
// Catalog checks

export function checkCatalogs(source: Catalog, target: Catalog, lang: string): string[] {
  const problems: string[] = [];
  for (const [key, message] of Object.entries(source)) {
    try { argumentsOf(message); } catch (error) { problems.push(`en: ${key} does not parse: ${(error as Error).message}`); }
    if (!(key in target)) { problems.push(`${lang}: missing key ${key}`); continue; }
    const translated = target[key];
    if (!translated.trim()) { problems.push(`${lang}: empty translation for ${key}`); continue; }
    let sourceArgs: string[];
    let targetArgs: string[];
    try { sourceArgs = argumentsOf(message); targetArgs = argumentsOf(translated); } catch (error) {
      problems.push(`${lang}: ${key} does not parse: ${(error as Error).message}`);
      continue;
    }
    if (sourceArgs.join(",") !== targetArgs.join(",")) {
      problems.push(`${lang}: placeholder mismatch in ${key}: en {${sourceArgs.join(", ")}} vs ${lang} {${targetArgs.join(", ")}}`);
    }
    for (const [arg, options] of Object.entries(pluralOptionsOf(translated))) {
      for (const needed of requiredPluralForms(lang)) {
        if (!options.includes(needed) && !(needed === "one" && options.includes("=1"))) {
          problems.push(`${lang}: plural {${arg}} in ${key} has no "${needed}" form`);
        }
      }
    }
  }
  for (const key of Object.keys(target)) if (!(key in source)) problems.push(`${lang}: extra key ${key} (not in English)`);
  return problems;
}

/** CLDR categories a translation must spell out. "many" (large round numbers in Spanish) falls back to "other". */
export function requiredPluralForms(lang: string): string[] {
  return new Intl.PluralRules(lang).resolvedOptions().pluralCategories.filter((c) => c !== "many");
}

// ---------------------------------------------------------------------------------------------------------------
// Key usage

export interface SourceFile { path: string; text: string }

/** String literals and template-literal heads in a file (the heads mark dynamic key prefixes). */
export function literalsOf(text: string): { literals: Set<string>; heads: Set<string> } {
  const literals = new Set<string>();
  const heads = new Set<string>();
  for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) literals.add(m[1] ?? m[2]);
  for (const m of text.matchAll(/`([^`$\\]*)(\$\{|`)/g)) (m[2] === "`" ? literals : heads).add(m[1]);
  return { literals, heads };
}

/** Whether the file calls the AI copy helpers (`t` from aiStrings), whose keys are served as `ai.<key>`. */
export function usesAiStrings(text: string): boolean {
  return /from\s+["'](?:@\/lib|\.\.?(?:\/\.\.)*(?:\/lib)?)\/aiStrings["']/.test(text);
}

/** Local names of the translate helpers a file imports: `t` from the i18n runtime, `t`/`tn` from aiStrings (maybe aliased). */
export function translateHelpers(text: string): Map<string, { ai: boolean; plural: boolean }> {
  const out = new Map<string, { ai: boolean; plural: boolean }>();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const from = m[2];
    const ai = /\/aiStrings$/.test(from);
    if (!ai && !/(?:@\/lib|\.\.?)\/i18n$|^\.\.?$/.test(from)) continue;
    for (const spec of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      const [imported, local = imported] = spec.replace(/^type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
      if (imported === "t") out.set(local, { ai, plural: false });
      if (ai && imported === "tn") out.set(local, { ai, plural: true });
    }
  }
  return out;
}

export function checkUsage(catalog: Catalog, files: readonly SourceFile[]): { unused: string[]; missing: string[] } {
  const literals = new Set<string>();
  const heads = new Set<string>();
  const missing: string[] = [];
  for (const file of files) {
    const found = literalsOf(file.text);
    const ai = usesAiStrings(file.text);
    for (const literal of found.literals) {
      literals.add(literal);
      if (ai) literals.add(`ai.${literal}`);
    }
    for (const head of found.heads) {
      heads.add(head);
      if (ai) heads.add(`ai.${head}`);
    }
    // Keys passed straight to a translate call must exist.
    const helpers = translateHelpers(file.text);
    for (const m of file.text.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*"([A-Za-z][\w.+-]*)"/g)) {
      const helper = helpers.get(m[1]);
      if (!helper) continue;
      const full = helper.ai ? `ai.${m[2]}` : m[2];
      const exists = helper.plural ? `${full}.one` in catalog && `${full}.other` in catalog : full in catalog;
      if (!exists) missing.push(`${file.path}: ${helper.plural ? `${full}.one/.other` : full} is not in the English catalog`);
    }
  }
  const unused = Object.keys(catalog).filter((key) => {
    if (literals.has(key)) return false;
    if (DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
    for (const head of heads) if (head.length > 2 && /[.]$/.test(head) && key.startsWith(head)) return false;
    // `tn("credits.unit", n)` uses credits.unit.one and credits.unit.other.
    const base = key.replace(/\.(one|other)$/, "");
    return !(base !== key && literals.has(base));
  });
  return { unused, missing: [...new Set(missing)] };
}

// ---------------------------------------------------------------------------------------------------------------
// Hard-coded strings in migrated files

/** JSX attributes whose string value is shown to people (or read by screen readers). */
const UI_ATTRIBUTES = new Set([
  "aria-label", "aria-description", "aria-valuetext", "aria-roledescription", "title", "placeholder", "alt", "label",
  "description", "subtitle", "body", "heading", "hint", "confirmLabel", "busyLabel", "reasonLabel", "reasonHint",
  "backLabel", "text", "caption", "legend", "emptyLabel", "page",
]);
/** Object keys whose string value is shown to people. */
const UI_PROPERTIES = new Set(["label", "title", "body", "description", "text", "hint", "heading", "message", "subtitle", "placeholder", "short", "full"]);
/** Calls whose message argument is shown to people. */
const UI_CALLS: Record<string, number> = { toast: 0, setError: 0, setNotice: 0, setMessage: 0, setStatus: 0, ApiError: 1 };
const TRANSLATE_CALLS = new Set(["t", "tn", "tMaybe", "translate"]);

const looksLikeText = (value: string) => /[A-Za-z]{2,}/.test(value);
const looksLikeLabel = (value: string) => /^[A-Z][a-z]/.test(value.trim()) || /[A-Za-z]{2,}[ ,.!?…:’][^]*[A-Za-z]/.test(value);

export interface Finding { file: string; line: number; text: string; why: string }

function staticText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("…");
  return null;
}

function calleeName(call: ts.CallExpression | ts.NewExpression): string {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function insideTranslateCall(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && TRANSLATE_CALLS.has(calleeName(p))) return true;
    if (ts.isJsxAttribute(p) || ts.isPropertyAssignment(p) || ts.isFunctionLike(p)) return false;
  }
  return false;
}

/** The JSX attribute a node sits in, if any (through conditionals and template literals). */
function enclosingAttribute(node: ts.Node): string | null {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return p.name.getText();
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isFunctionLike(p) || ts.isCallExpression(p)) return null;
  }
  return null;
}

function inJsxChildExpression(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p) || ts.isCallExpression(p) || ts.isFunctionLike(p)) return false;
    if (ts.isJsxExpression(p)) return p.parent !== undefined && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent));
  }
  return false;
}

/** A string compared with `===`/`!==` or used as a `case` label is a state id, not copy. */
function isComparison(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isCaseClause(parent)) return true;
  if (!ts.isBinaryExpression(parent)) return false;
  const op = parent.operatorToken.kind;
  return op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken
    || op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
}

/** `keys` are the catalog keys: a string that names one is a reference to copy, not copy. */
export function findHardCoded(path: string, text: string, keys: ReadonlySet<string> = new Set()): Finding[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Finding[] = [];
  const add = (node: ts.Node, value: string, why: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    out.push({ file: path, line, text: value.replace(/\s+/g, " ").trim(), why });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const value = node.text.trim();
      if (value && looksLikeText(value)) add(node, value, "JSX text");
    } else if (ts.isCallExpression(node) && TRANSLATE_CALLS.has(calleeName(node))) {
      let scoped = false;
      for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p) || ts.isClassLike(p)) { scoped = true; break; }
      if (!scoped) add(node, node.getText(sf), "t() at module scope");
    } else {
      const value = staticText(node);
      if (value !== null && !insideTranslateCall(node) && !isComparison(node) && !keys.has(value)) {
        if (value === "en-US") add(node, value, "fixed en-US formatting (use intlLocale())");
        else if (looksLikeText(value)) {
          const parent = node.parent;
          const attribute = enclosingAttribute(node);
          if (attribute && UI_ATTRIBUTES.has(attribute)) add(node, value, `attribute ${attribute}`);
          else if (!attribute && inJsxChildExpression(node)) add(node, value, "JSX expression");
          else if (ts.isPropertyAssignment(parent) && parent.initializer === node && UI_PROPERTIES.has(parent.name.getText(sf).replace(/["']/g, "")) && looksLikeLabel(value)) add(node, value, `property ${parent.name.getText(sf)}`);
          else if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && calleeName(parent) in UI_CALLS && parent.arguments?.[UI_CALLS[calleeName(parent)]] === node && looksLikeLabel(value)) add(node, value, `${calleeName(parent)}() message`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Files and allowlist

export function sourceFiles(root = ROOT): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (name === "__tests__" || name === "node_modules") continue;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !rel.startsWith(CATALOG_DIR)) out.push({ path: rel, text: readFileSync(join(root, rel), "utf8") });
    }
  };
  walk(SRC);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// Files that hold server or mock content (or endonyms), not portal chrome. They stay English until the backend phase of #259
// (message keys for audit summaries and errors); the mock stands in for the backend. --remaining skips them.
export const SERVER_CONTENT_FILES: ReadonlySet<string> = new Set([
  "apps/admin/src/lib/adminMock.ts",
  "apps/admin/src/lib/api.ts",
  "apps/admin/src/lib/firebaseAdapter.ts",
  "apps/admin/src/lib/ideasMock.ts",
  "apps/admin/src/lib/ideasForYouMock.ts",
  "apps/admin/src/lib/themeSuggestMock.ts",
  "apps/admin/src/lib/considerations.ts",
  // Language names are shown in their own language on purpose (LOCALE_NAMES).
  "apps/admin/src/lib/i18n/index.ts",
]);

export const isMigrated = (text: string) => text.includes(MARKER);

export function readAllowlist(text: string): Set<string> {
  return new Set(text.split("\n").filter((line) => line.trim() && !line.startsWith("#")).map((line) => line.trimEnd()));
}

export const allowlistLine = (f: Finding) => `${f.file}\t${f.text}`;

export function run(argv: readonly string[]): number {
  const files = sourceFiles();
  const problems: string[] = [...checkCatalogs(en, es, "es")];
  const usage = checkUsage(en, files);
  problems.push(...usage.missing.map((m) => `missing key: ${m}`));
  problems.push(...usage.unused.map((key) => `unused key: ${key}`));

  const migrated = files.filter((f) => isMigrated(f.text));
  const keys = new Set(Object.keys(en));
  const findings = migrated.flatMap((f) => findHardCoded(f.path, f.text, keys));
  if (argv.includes("--update-allowlist")) {
    const lines = [...new Set(findings.filter((f) => f.why !== "t() at module scope").map(allowlistLine))].sort();
    writeFileSync(join(ROOT, ALLOWLIST), `# Reviewed exceptions for scripts/admin-i18n/check.ts (file<TAB>text). Not user-facing, or intentionally verbatim.\n${lines.join("\n")}\n`);
    console.log(`Wrote ${lines.length} entries to ${ALLOWLIST}`);
  }
  let allow: Set<string>;
  try { allow = readAllowlist(readFileSync(join(ROOT, ALLOWLIST), "utf8")); } catch { allow = new Set(); }
  for (const f of findings) {
    if (!allow.has(allowlistLine(f)) || f.why === "t() at module scope") problems.push(`hard-coded (${f.why}): ${f.file}:${f.line}: ${f.text}`);
  }

  if (argv.includes("--remaining")) {
    // Follow-up inventory: likely UI strings in files not migrated yet.
    const rest = files.filter((f) => !isMigrated(f.text) && !SERVER_CONTENT_FILES.has(f.path)).map((f) => ({ path: f.path, count: findHardCoded(f.path, f.text, keys).length })).filter((r) => r.count > 0);
    for (const r of rest) console.log(`${String(r.count).padStart(4)}  ${r.path}`);
    console.log(`${rest.reduce((n, r) => n + r.count, 0)} likely UI strings in ${rest.length} files not yet migrated.`);
  }

  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\nadmin i18n check failed with ${problems.length} problem(s). See docs/design/admin-i18n.md.`);
    return 1;
  }
  console.log(`Admin i18n OK: ${Object.keys(en).length} keys in en and es; ${migrated.length} migrated files checked for hard-coded strings (${relative(ROOT, join(ROOT, SRC))}).`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = run(process.argv.slice(2));
