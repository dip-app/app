import { argumentsOf, format, parse, pluralOptionsOf, type MessageVars } from "./icu";
import { intlTag, type Locale } from "./locale";

/**
 * Typed per-locale message catalogs for server copy. English is the source: each module declares its English catalog
 * `as const` and types the Spanish one `Record<keyof typeof en, string>`, so tsc fails on a missing Spanish key and
 * `checkCatalogs` (unit tests and `npm run check:backend-i18n`) fails on empty, unparsable or mismatched messages.
 */
export type Catalog<K extends string> = Readonly<Record<K, string>>;
export type Catalogs<K extends string> = Readonly<Record<Locale, Catalog<K>>>;

export type Translate<K extends string> = (locale: Locale, key: K, vars?: MessageVars) => string;

/** `t(locale, key, vars)` over one catalog set. A message missing in a locale falls back to English. */
export function translator<K extends string>(catalogs: Catalogs<K>): Translate<K> {
  return (locale, key, vars = {}) => {
    const message = catalogs[locale]?.[key] ?? catalogs.en[key];
    if (message === undefined) throw new Error(`i18n: unknown message key ${key}`);
    return format(message, vars, intlTag(locale));
  };
}

/**
 * Splits a formatted message around one slot (for example `{title}` in a subject line), so callers can shorten the
 * server content while keeping our copy whole: "Canceled: {title}" -> ["Canceled: ", ""]. The slot must appear once.
 */
export function splitAround<K extends string>(t: Translate<K>, locale: Locale, key: K, slot: string, vars: MessageVars = {}): [string, string] {
  const marker = "\u0000";
  const parts = t(locale, key, { ...vars, [slot]: marker }).split(marker);
  if (parts.length !== 2) throw new Error(`i18n: ${key} must contain {${slot}} exactly once`);
  return [parts[0]!, parts[1]!];
}

/** Problems in a catalog pair: missing, extra or empty Spanish keys, parse errors, placeholder or plural mismatches. */
export function checkCatalogs(name: string, en: Readonly<Record<string, string>>, es: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(en)) {
    const source = en[key]!;
    try { parse(source); } catch (error) { problems.push(`${name}: en ${key} does not parse (${(error as Error).message})`); continue; }
    if (!Object.prototype.hasOwnProperty.call(es, key)) { problems.push(`${name}: es is missing ${key}`); continue; }
    const target = es[key]!;
    if (target.trim() === "") { problems.push(`${name}: es ${key} is empty`); continue; }
    try { parse(target); } catch (error) { problems.push(`${name}: es ${key} does not parse (${(error as Error).message})`); continue; }
    const a = argumentsOf(source).join(",");
    const b = argumentsOf(target).join(",");
    if (a !== b) problems.push(`${name}: es ${key} placeholders [${b}] differ from en [${a}]`);
    for (const [arg, options] of Object.entries(pluralOptionsOf(target))) {
      if (!options.includes("one") && !options.some((o) => o === "=1")) problems.push(`${name}: es ${key} plural {${arg}} has no "one" form`);
    }
  }
  for (const key of Object.keys(es)) {
    if (!Object.prototype.hasOwnProperty.call(en, key)) problems.push(`${name}: es has ${key}, which is not in en`);
  }
  return problems;
}
