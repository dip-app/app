"use client";
// @i18n-migrated

import { useState } from "react";
import { type EmailSwitch, type EmailSwitches, can } from "@/lib/adminTypes";
import { t } from "@/lib/i18n";
import { userErrorMessage } from "@/lib/userError";
import { Button, InlineNotice } from "@/components/kit";
import { useApp } from "./AppProvider";
import { toast } from "./Toast";
import { Toggle } from "./Toggle";
import { useLoad } from "./useLoad";

/**
 * Your settings > Other emails (docs/design/email-catalog.md): the opt-in emails a person turns on here (both off until
 * they do), then where every other email is controlled. The weekly theme email is for everyone; the daily roster digest
 * only for admins (the server also checks the role when it sends). Each switch is the person's own preference document.
 */
export function OtherEmails() {
  const { api, session } = useApp();
  const state = useLoad((a) => a.emailSwitches(), `email-switches:${session?.uid ?? ""}`);
  const [busy, setBusy] = useState<EmailSwitch | null>(null);
  const isAdmin = can(session?.role, "roster.manage");

  async function change(name: EmailSwitch, on: boolean, current: EmailSwitches) {
    if (busy) return;
    setBusy(name);
    // Show the new position right away; a failure puts it back and says so.
    state.setData({ ...current, [name]: on });
    try {
      state.setData(await api.setEmailSwitch(name, on));
      toast(t(on ? "account.otherEmails.savedOn" : "account.otherEmails.savedOff"));
    } catch (error) {
      state.setData(current);
      toast(userErrorMessage(error, t("account.otherEmails.saveFailed")), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const switches = state.data;
  return (
    <div className="other-emails">
      {state.error ? (
        <InlineNotice tone="error" action={<Button variant="plain" onClick={state.reload}>{t("common.tryAgain")}</Button>}>{t("account.otherEmails.loadFailed")}</InlineNotice>
      ) : !switches ? (
        <p className="muted" role="status">{t("account.otherEmails.loading")}</p>
      ) : (
        <div className="settings-switches" aria-busy={busy !== null || undefined}>
          <Toggle
            checked={switches.weekly_themes}
            onChange={(on) => void change("weekly_themes", on, switches)}
            label={t("account.otherEmails.weeklyThemes.label")}
            hint={t("account.otherEmails.weeklyThemes.hint")}
          />
          {isAdmin && (
            <Toggle
              checked={switches.admin_digest}
              onChange={(on) => void change("admin_digest", on, switches)}
              label={t("account.otherEmails.digest.label")}
              hint={t("account.otherEmails.digest.hint")}
            />
          )}
        </div>
      )}
      <ul className="settings-notes">
        <li>{t("account.otherEmails.app")}</li>
        <li>{t("account.otherEmails.account")}</li>
      </ul>
    </div>
  );
}
