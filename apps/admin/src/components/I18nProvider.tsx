"use client";

import { Fragment, useSyncExternalStore } from "react";
import { type Locale, getLocale, subscribeLocale } from "@/lib/i18n";

/** The current locale; components re-render when it changes. The static HTML is always English. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => "en");
}

/**
 * Re-mounts the signed-in tree when the language changes, so every `t()` call (including ones in helpers and memoized
 * values) runs again in the new language. Changing language is rare and happens on Your settings, so losing local
 * component state there is acceptable.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  return <Fragment key={locale}>{children}</Fragment>;
}
