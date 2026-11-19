// The portal's i18n runtime: typed catalogs per locale, `t()` with ICU-style plurals, the current locale and
// locale-aware formatting. No framework: the portal is a static export of client components, so the locale is a
// browser setting (Your settings), read once at start and changed in place. See docs/design/admin-i18n.md.
//
// Rules: call `t()` while rendering or handling an event, never at module scope (a module constant would keep the
// language it was built in). Server content (event titles, names, user text) is never passed through `t()`.

import { en, type MessageKey } from "./catalog/en";
import { es } from "./catalog/es";
import { format, pseudoize, type MessageVars } from "./icu";

export type { MessageKey } from "./catalog/en";
export type { MessageVars } from "./icu";

export type Locale = "en" | "es" | "pseudo";
/** What the person picked in Your settings; "auto" follows the browser. */
export type LocalePreference = Locale | "auto";

export const LOCALES: readonly Locale[] = ["en", "es", "pseudo"];
/** Languages people can pick. The pseudo-locale is a layout test and only offered outside live mode. */
export const SHIPPED_LOCALES: readonly Locale[] = ["en", "es"];
/** Names shown in the picker, each in its own language (never translated). */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español", pseudo: "Pseudo (layout test)" };

/** BCP 47 tags for Intl. English stays en-US so dates and numbers look exactly as before. */
const INTL_TAG: Record<Locale, string> = { en: "en-US", es: "es-419", pseudo: "en-US" };
const HTML_LANG: Record<Locale, string> = { en: "en", es: "es", pseudo: "en-XA" };

export const STORAGE_KEY = "dip.admin.locale";
/** The product name is never translated (not even in the pseudo-locale). */
export const BRAND = "DIP Admin";

type Catalog = Readonly<Record<string, string>>;
let pseudoCatalog: Catalog | null = null;

function catalog(locale: Locale): Catalog {
  if (locale === "es") return es;
  if (locale === "pseudo") {
    pseudoCatalog ??= Object.fromEntries(Object.entries(en).map(([key, value]) => [key, pseudoize(value)]));
    return pseudoCatalog;
  }
  return en;
}

let current: Locale = "en";
const listeners = new Set<() => void>();
const warned = new Set<string>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The first browser language the portal ships ("es-MX" and "es" both pick Spanish), else English. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    const hit = SHIPPED_LOCALES.find((locale) => locale === base);
    if (hit) return hit;
  }
  return "en";
}

export function resolveLocale(preference: LocalePreference, languages: readonly string[]): Locale {
  return preference === "auto" ? detectLocale(languages) : preference;
}

/** The stored choice, or "auto". Storage can be missing or blocked (private windows), so failures mean "auto". */
export function readPreference(): LocalePreference {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

function apply(locale: Locale) {
  const changed = locale !== current;
  current = locale;
  if (typeof document !== "undefined") document.documentElement.lang = HTML_LANG[locale];
  if (changed) listeners.forEach((listener) => listener());
}

/** Reads the stored choice and the browser languages; called once when the app starts. */
export function initLocale(): Locale {
  apply(resolveLocale(readPreference(), browserLanguages()));
  return current;
}

/** Saves the choice in this browser (no server field) and switches the portal to it. */
export function setLocalePreference(preference: LocalePreference) {
  try {
    if (preference === "auto") globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, preference);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
  apply(resolveLocale(preference, browserLanguages()));
}

/**
 * Applies the signed-in member's saved language (`users/{uid}.locale`) so it wins over the browser default. The browser's
 * stored choice stays the fallback when the member has none; a pseudo-locale layout test is left alone.
 */
export function applyMemberLocale(locale: unknown) {
  if (locale !== "en" && locale !== "es") return;
  if (readPreference() === "pseudo") return;
  setLocalePreference(locale);
}

/** Switches without saving (tests and previews). */
export function setLocale(locale: Locale) {
  apply(locale);
}

export function getLocale(): Locale {
  return current;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The tag to pass to Intl and toLocale*String. */
export function intlLocale(locale: Locale = current): string {
  return INTL_TAG[locale];
}

/** The message for `key` in the current locale with `{slots}` and plurals filled. Missing translations fall back to English. */
export function t(key: MessageKey, vars: MessageVars = {}): string {
  return translate(current, key, vars);
}

export function translate(locale: Locale, key: string, vars: MessageVars = {}): string {
  const message = catalog(locale)[key] ?? (en as Catalog)[key];
  if (message === undefined) {
    if (!warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
    return key;
  }
  return format(message, vars, INTL_TAG[locale]);
}

/** True when `key` exists (for keys built from data, such as an error code). */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

// Formatting. Each takes the same options as Intl and uses the current locale.

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(intlLocale(), options);
}

export function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString(intlLocale(), options);
}

export function formatTime(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleTimeString(intlLocale(), options);
}

export function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(), options);
}

/** "A, B and C" in the current language. */
export function formatList(items: readonly string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(intlLocale(), { style: "long", type }).format(items);
}
