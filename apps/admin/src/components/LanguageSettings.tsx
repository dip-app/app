"use client";
// @i18n-migrated

import { useId, useState } from "react";
import {
  LOCALE_NAMES, type LocalePreference, SHIPPED_LOCALES, detectLocale, getLocale, readPreference, setLocalePreference, t,
} from "@/lib/i18n";
import { useApp } from "./AppProvider";
import { toast } from "./Toast";

/**
 * Language picker for Your settings. The choice is kept in this browser only (no profile field yet); "Same as this
 * browser" follows the browser languages. The pseudo-locale (accented, double length) is offered outside live mode
 * for layout testing.
 */
export function LanguageSettings() {
  const { api } = useApp();
  const id = useId();
  const [value, setValue] = useState<LocalePreference>(() => readPreference());
  const browser = detectLocale(typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
  const options = api.mode === "live" ? SHIPPED_LOCALES : [...SHIPPED_LOCALES, "pseudo" as const];

  function change(next: LocalePreference) {
    setValue(next);
    // Switching re-mounts the signed-in tree in the new language; the toast store outlives that.
    setLocalePreference(next);
    toast(t("account.language.saved"));
  }

  return (
    <div className="field">
      <label htmlFor={`${id}-lang`}>{t("account.language.label")}</label>
      <select id={`${id}-lang`} value={value} onChange={(event) => change(event.target.value as LocalePreference)}>
        <option value="auto">{t("account.language.auto", { language: LOCALE_NAMES[browser] })}</option>
        {options.map((locale) => <option key={locale} value={locale} lang={locale === "pseudo" ? undefined : locale}>{LOCALE_NAMES[locale]}</option>)}
      </select>
      {getLocale() === "es" && <span className="hint">{t("account.language.note")}</span>}
    </div>
  );
}
