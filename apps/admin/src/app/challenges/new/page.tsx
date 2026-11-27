"use client";
// @i18n-migrated

import { Shell } from "@/components/Shell";
import { ThemeForm } from "@/components/ThemeForm";
import { SuggestThemeAction, ThemeSuggestProvider } from "@/components/ThemeSuggest";
import { t } from "@/lib/i18n";

export default function NewThemePage() {
  return (
    <ThemeSuggestProvider>
      <Shell title={t("themeForm.new.title")} subtitle={t("themeForm.new.subtitle")} requires="themes.manage" back={{ href: "/challenges/", label: t("shell.nav.challenges") }} action={<SuggestThemeAction />}>
        <ThemeForm />
      </Shell>
    </ThemeSuggestProvider>
  );
}
