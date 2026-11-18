"use client";
// @i18n-migrated

import { Shell } from "@/components/Shell";
import { UserSettings } from "@/components/UserSettings";
import { t } from "@/lib/i18n";

export default function AccountPage() {
  return (
    <Shell title={t("account.title")} subtitle={t("account.subtitle")}>
      <UserSettings />
    </Shell>
  );
}
