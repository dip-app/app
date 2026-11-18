"use client";
// @i18n-migrated

import { Shell } from "@/components/Shell";
import { ThemeForm } from "@/components/ThemeForm";
import { t } from "@/lib/i18n";

export default function NewThemePage() {
  return (
    <Shell title={t("themeForm.new.title")} subtitle={t("themeForm.new.subtitle")} requires="themes.manage">
      <ThemeForm />
    </Shell>
  );
}
