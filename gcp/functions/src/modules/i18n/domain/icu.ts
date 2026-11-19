// A small ICU MessageFormat subset for server copy (email, push), the same syntax and semantics as the admin portal's
// runtime (apps/admin/src/lib/i18n/icu.ts) so both sides read one message format. Supported: `{name}` slots,
// `{n, plural, =0 {...} one {# item} other {# items}}` with `#` as the formatted number, and
// `{x, select, a {...} other {...}}`. Apostrophes are plain text (no ICU quoting). Dependency free.

export type MessageVars = Readonly<Record<string, string | number>>;

export type Node =
  | { kind: "text"; value: string }
  | { kind: "arg"; name: string }
  | { kind: "plural"; name: string; options: Record<string, Node[]> }
  | { kind: "select"; name: string; options: Record<string, Node[]> }
  | { kind: "pound" };

const cache = new Map<string, Node[]>();

/** Parses a message; throws on unbalanced braces or a plural/select without `other`. */
export function parse(message: string): Node[] {
  const hit = cache.get(message);
  if (hit) return hit;
  const [nodes, end] = parseNodes(message, 0, false);
  if (end !== message.length) throw new Error(`Unexpected "}" at ${end} in: ${message}`);
  cache.set(message, nodes);
  return nodes;
}

function parseNodes(src: string, start: number, inPlural: boolean): [Node[], number] {
  const nodes: Node[] = [];
  let text = "";
  let i = start;
  const flush = () => { if (text) { nodes.push({ kind: "text", value: text }); text = ""; } };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "}") break;
    if (ch === "#" && inPlural) { flush(); nodes.push({ kind: "pound" }); i++; continue; }
    if (ch !== "{") { text += ch; i++; continue; }
    flush();
    const close = readArg(src, i + 1);
    nodes.push(close.node);
    i = close.end;
  }
  flush();
  return [nodes, i];
}

function readArg(src: string, start: number): { node: Node; end: number } {
  const header = /^\s*(\w+)\s*(?:,\s*(plural|select)\s*,\s*)?/.exec(src.slice(start));
  if (!header) throw new Error(`Bad placeholder at ${start} in: ${src}`);
  const name = header[1]!;
  const type = header[2] as "plural" | "select" | undefined;
  let i = start + header[0].length;
  if (!type) {
    if (src[i] !== "}") throw new Error(`Expected "}" at ${i} in: ${src}`);
    return { node: { kind: "arg", name }, end: i + 1 };
  }
  const options: Record<string, Node[]> = {};
  while (i < src.length) {
    while (src[i] === " ") i++;
    if (src[i] === "}") break;
    const sel = /^(=\d+|\w+)\s*\{/.exec(src.slice(i));
    if (!sel) throw new Error(`Bad ${type} option at ${i} in: ${src}`);
    i += sel[0].length;
    const [body, end] = parseNodes(src, i, type === "plural");
    if (src[end] !== "}") throw new Error(`Unclosed ${type} option in: ${src}`);
    options[sel[1]!] = body;
    i = end + 1;
  }
  if (src[i] !== "}") throw new Error(`Unclosed ${type} in: ${src}`);
  if (!options.other) throw new Error(`${type} without "other" in: ${src}`);
  return { node: { kind: type, name, options }, end: i + 1 };
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function rules(locale: string): Intl.PluralRules {
  let r = pluralRules.get(locale);
  if (!r) { r = new Intl.PluralRules(locale); pluralRules.set(locale, r); }
  return r;
}

export function formatNumberIn(locale: string, n: number): string {
  let f = numberFormats.get(locale);
  if (!f) { f = new Intl.NumberFormat(locale); numberFormats.set(locale, f); }
  return f.format(n);
}

/** Fills a message. Unknown `{slots}` are left as written so a missing variable is visible, never silently blank. */
export function format(message: string, vars: MessageVars, locale: string): string {
  return render(parse(message), vars, locale, null);
}

function render(nodes: Node[], vars: MessageVars, locale: string, count: number | null): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") out += node.value;
    else if (node.kind === "pound") out += count === null ? "#" : formatNumberIn(locale, count);
    else if (node.kind === "arg") out += node.name in vars ? String(vars[node.name]) : `{${node.name}}`;
    else if (node.kind === "select") {
      const value = String(vars[node.name] ?? "other");
      out += render(node.options[value] ?? node.options.other!, vars, locale, count);
    } else {
      const n = Number(vars[node.name]);
      const exact = node.options[`=${n}`];
      // Categories a language does not list in the message (Spanish "many") fall back to "other".
      const branch = exact ?? node.options[rules(locale).select(n)] ?? node.options.other!;
      out += render(branch, vars, locale, n);
    }
  }
  return out;
}

/** Argument names a message uses, with the plural/select ones marked (for the placeholder check). */
export function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.kind === "arg") names.add(node.name);
      else if (node.kind === "plural" || node.kind === "select") {
        names.add(`${node.name}:${node.kind}`);
        Object.values(node.options).forEach(walk);
      }
    }
  };
  walk(parse(message));
  return [...names].sort();
}

/** Plural option keys per plural argument, for checking that a translation fills each category its language needs. */
export function pluralOptionsOf(message: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.kind === "plural") out[node.name] = [...new Set([...(out[node.name] ?? []), ...Object.keys(node.options)])];
      if (node.kind === "plural" || node.kind === "select") Object.values(node.options).forEach(walk);
    }
  };
  walk(parse(message));
  return out;
}
