"use client";
// @i18n-migrated

import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toast";
import { formatDate } from "@/components/Ui";
import { Button } from "@/components/kit";
import { ROLE_LABEL, type ResendResult, type RosterRow } from "@/lib/adminTypes";
import { t } from "@/lib/i18n";
import { INVITE_STATE_KEY, inviteHistory } from "./PeopleTables";

/**
 * Details of someone who was invited but has not joined (there is no member record to open yet). The main button is the
 * row's own next step: send the invite email (or get the message), or invite a revoked person again.
 */
export function InvitedPersonDialog({ row, inviteEmail, teamName, onClose, onEmail, onResend, onRevoke, onReinvite }: {
  row: RosterRow; inviteEmail: boolean; teamName: (id: string) => string; onClose: () => void;
  onEmail: (row: RosterRow) => Promise<void>; onResend: (row: RosterRow) => void; onRevoke: (row: RosterRow) => void; onReinvite: (row: RosterRow) => Promise<void>;
}) {
  const revoked = row.state === "revoked";
  const history = inviteHistory(row);
  const teams = row.teamIds.map(teamName).join(", ");
  const confirmLabel = revoked ? t("roster.action.inviteAgain") : inviteEmail ? t("roster.action.email") : t("roster.action.resend");
  // The other things to do with an invitation: in the dialog's action row (behind "More actions" on phones).
  const more = revoked ? undefined : (
    <>
      {inviteEmail && <Button onClick={() => { onClose(); onResend(row); }}>{t("roster.action.resend")}</Button>}
      <Button className="quiet-danger" onClick={() => { onClose(); onRevoke(row); }}>{t("roster.revoke.confirm")}</Button>
    </>
  );
  return (
    <Dialog title={row.displayName} confirmLabel={confirmLabel} cancelLabel={t("common.close")} more={more} busyLabel={revoked ? t("common.saving") : inviteEmail ? t("roster.email.busy") : t("roster.action.resending")} onClose={onClose}
      onConfirm={async () => {
        if (revoked) await onReinvite(row);
        else if (inviteEmail) await onEmail(row);
        else onResend(row);
      }}>
      <p>{revoked ? t("roster.detail.revokedNote") : t("roster.detail.invitedNote")}</p>
      <dl className="facts">
        <div><dt>{t("roster.detail.email")}</dt><dd>{row.email}</dd></div>
        <div><dt>{t("roster.table.status")}</dt><dd>{t(INVITE_STATE_KEY[row.state])}{history.map((line) => <span key={line} className="muted small-note"><br />{line}</span>)}</dd></div>
        <div><dt>{t("roster.table.role")}</dt><dd>{ROLE_LABEL[row.role]}</dd></div>
        <div><dt>{t("roster.table.teams")}</dt><dd>{teams || <span className="muted">{t("common.none")}</span>}</dd></div>
        <div><dt>{t("members.table.location")}</dt><dd>{row.workLocation || <span className="muted">{t("common.notSet")}</span>}</dd></div>
        {row.department && <div><dt>{t("roster.detail.department")}</dt><dd>{row.department}</dd></div>}
        {row.jobTitle && <div><dt>{t("roster.detail.jobTitle")}</dt><dd>{row.jobTitle}</dd></div>}
        <div><dt>{t("roster.table.added")}</dt><dd>{formatDate(row.invitedAt)}</dd></div>
      </dl>
    </Dialog>
  );
}

/** The resend is recorded and this is what the admin shares through their own channel (also when DIP can email the invite). */
export function ResendDialog({ row, result, inviteEmail, onClose }: { row: RosterRow; result: ResendResult; inviteEmail: boolean; onClose: () => void }) {
  return (
    <Dialog title={t("roster.message.title", { name: row.displayName })} confirmLabel={t("roster.message.copy")} busyLabel={t("roster.message.copying")} onClose={onClose}
      onConfirm={async () => {
        try {
          await navigator.clipboard.writeText(result.message);
        } catch {
          document.querySelector<HTMLTextAreaElement>("#invite-message")?.select(); // clipboard blocked: leave the text selected to copy by hand
          throw new Error(t("roster.message.copyFailed"));
        }
        toast(t("roster.toast.copied", { name: row.displayName }));
        onClose();
      }}>
      <p><strong>{t(inviteEmail ? "roster.message.introSelf" : "roster.message.intro", { email: row.email })}</strong> {t("roster.message.recorded", { count: result.resendCount })}</p>
      <div className="field">
        <label htmlFor="invite-message">{t("roster.message.label")}</label>
        <textarea id="invite-message" readOnly rows={5} value={result.message} />
        <span className="hint">{t("roster.message.link", { url: result.signInUrl })}</span>
      </div>
    </Dialog>
  );
}
