/**
 * Member languages for server-written copy (email, push), issue #259 backend phase. See docs/design/backend-i18n.md.
 *
 * `users/{uid}.locale` is optional and server-owned (written only by `setMyLocaleV1`). A missing, unknown or malformed
 * value means English: nothing is derived from the browser, the device or the email domain on the server.
 */
export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** The stored value as a supported locale; anything else (absent, "fr", "ES", a number) falls back to English. */
export function localeOrDefault(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * BCP 47 tag for Intl. English stays en-US so every date, time and number is formatted exactly as before; Spanish is
 * neutral Latin American (es-419), matching the iOS app and the admin portal.
 */
const INTL_TAG: Readonly<Record<Locale, string>> = { en: "en-US", es: "es-419" };

export function intlTag(locale: Locale): string {
  return INTL_TAG[locale];
}
