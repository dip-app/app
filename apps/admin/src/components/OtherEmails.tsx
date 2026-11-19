"use client";
// @i18n-migrated

import { t } from "@/lib/i18n";

/**
 * Your settings > Other emails: which emails DIP sends a person and where each is controlled
 * (docs/design/email-catalog.md). Read-only: event and invite emails are switched in the app; account emails have no
 * switch of their own.
 */
export function OtherEmails() {
  return (
    <ul className="settings-notes">
      <li>{t("account.otherEmails.app")}</li>
      <li>{t("account.otherEmails.account")}</li>
    </ul>
  );
}
