import { translator, type Catalogs, type Locale } from "../../../../i18n";
import { en, type EmailMessageKey } from "./en";
import { es, ES_STORED_TEXT } from "./es";

export type { EmailMessageKey } from "./en";

/** Email copy per locale (issue #259 backend phase). English is the source; see docs/design/backend-i18n.md. */
export const emailCatalogs: Catalogs<EmailMessageKey> = { en, es };

/** `tEmail(locale, key, vars)`: one email message, formatted for the locale. */
export const tEmail = translator(emailCatalogs);

/** A stored server sentence (for example the ideas email's data note) in the recipient's language when we know it. */
export function storedText(locale: Locale, text: string): string {
  return locale === "es" ? ES_STORED_TEXT[text] ?? text : text;
}
