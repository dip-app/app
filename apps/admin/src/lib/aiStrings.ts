// The portal's AI features (Dipbot) read their copy through this module. The English source is
// src/lib/i18n/catalog/en/ai.ts and each locale has its own file; the i18n runtime serves them as `ai.<key>`.
// `{ai}` is the brand name (AI_NAME, one constant, never translated), other `{name}` slots are filled by `t()`.
// Plurals use `.one` / `.other` keys through `tn()`, picked with the current language's plural rules. US English, no em dashes.

import { ai } from "./i18n/catalog/en/ai";
import { getLocale, intlLocale, translate } from "./i18n";

export const AI_NAME = "Dipbot";

/** The English source strings (tests and copy checks read these). */
export const AI_STRINGS = ai;

export type AiStringKey = keyof typeof AI_STRINGS;
type Vars = Readonly<Record<string, string | number>>;

/** The string for `key` with `{ai}` and any `{name}` slots filled. Unknown slots are left as written. */
export function t(key: AiStringKey, vars: Vars = {}): string {
  return translate(getLocale(), `ai.${key}`, { ai: AI_NAME, ...vars });
}

const rules = new Map<string, Intl.PluralRules>();

/** Plural form: `${base}.one` for the language's "one" category (n = 1 in English and Spanish), else `${base}.other`, with `{n}` filled. */
export function tn(base: "suggest.count" | "consider.selected" | "consider.rail" | "suggest.when.minutes" | "suggest.when.hours" | "suggest.when.days" | "suggest.matched" | "suggest.appliedToast" | "generating.status" | "quick.waiting" | "credits.unit" | "where.results" | "venues.found", n: number, vars: Vars = {}): string {
  const tag = intlLocale();
  let rule = rules.get(tag);
  if (!rule) { rule = new Intl.PluralRules(tag); rules.set(tag, rule); }
  return t(`${base}.${rule.select(n) === "one" ? "one" : "other"}` as AiStringKey, { n, ...vars });
}

/** For keys built from data (option values, error reasons): the string, or null when the key does not exist. */
export function tMaybe(key: string, vars: Vars = {}): string | null {
  return Object.prototype.hasOwnProperty.call(AI_STRINGS, key) ? t(key as AiStringKey, vars) : null;
}
