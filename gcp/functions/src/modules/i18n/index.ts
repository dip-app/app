// Shared server-copy localization (issue #259 backend phase, docs/design/backend-i18n.md). Domain only: no callables.
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, intlTag, isLocale, localeOrDefault, type Locale } from "./domain/locale";
export { checkCatalogs, splitAround, translator, type Catalog, type Catalogs, type Translate } from "./domain/catalog";
export { format, type MessageVars } from "./domain/icu";
export { ERROR_MESSAGES, errorMessageDetails, type ErrorMessageDetails, type ErrorMessageKey } from "./domain/errorMessages";
