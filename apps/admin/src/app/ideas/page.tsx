"use client";
// @i18n-migrated

import { Ideas } from "@/components/Ideas";
import { Shell } from "@/components/Shell";
import { t } from "@/lib/aiStrings";

export default function IdeasPage() {
  return (
    <Shell title={t("page.title")} subtitle={t("page.subtitle")} brief={t("page.brief")} requires="ai.generate">
      <Ideas />
    </Shell>
  );
}
