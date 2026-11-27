"use client";
// @i18n-migrated

import Link from "next/link";
import { TableRegion } from "@/components/TableRegion";
import { Avatar, Info, formatDate } from "@/components/Ui";
import { Button } from "@/components/kit";
import { ROLE_LABEL, type Member, type RosterRow } from "@/lib/adminTypes";
import { t, type MessageKey } from "@/lib/i18n";

/** Members tab table: people who joined (signed in). The name opens Member detail. */
export function MemberTable({ members, teamName, showPoints, busy }: {
  members: Member[]; teamName: (id: string) => string; /** Admins see balances; organizers read people without them. */ showPoints: boolean; busy: boolean;
}) {
  return (
    <TableRegion label={t("members.table.label")} busy={busy}>
      <table className="table responsive person-table">
        <caption className="sr-only">{t("members.table.label")}</caption>
        <thead><tr><th scope="col">{t("members.table.name")}</th><th scope="col" className="mid-hide">{t("members.table.role")}</th><th scope="col" className="mid-hide">{t("members.table.teams")}</th><th scope="col" className="mid-hide">{t("members.table.location")}</th><th scope="col">{t("members.table.status")}</th>{showPoints && <th scope="col" className="right mid-hide">{t("members.table.points")}</th>}</tr></thead>
        <tbody>
          {members.map((m) => {
            const teamsText = m.teamIds.map(teamName).join(", ");
            const statusLabel = t(m.status === "active" ? "members.chip.active" : m.status === "invited" ? "members.chip.invited" : "members.chip.deactivated");
            // Active is the norm: plain text. Invited and Deactivated are the exceptions and keep the chip.
            const status = m.status === "active" ? <span className="status-plain">{statusLabel}</span> : <Info tone="warn">{statusLabel}</Info>;
            return (
              <tr key={m.id}>
                <th scope="row"><Link className="person" href={`/members/detail/?id=${encodeURIComponent(m.id)}`}><Avatar name={m.displayName} userId={m.id} photoURL={m.photoURL} avatarId={m.avatarId} /><span><strong>{m.displayName}</strong><br /><span className="muted">{m.email}</span>
                  <span className="person-sub mid-show">{[ROLE_LABEL[m.role], teamsText, m.workLocation].filter(Boolean).join(" · ")}{showPoints && m.pointsBalance !== null && <> · {t("members.sub.points", { count: m.pointsBalance })}</>}{m.status !== "active" && <span className="phone-only">{status}</span>}</span></span></Link></th>
                <td className="phone-hide mid-hide" data-label={t("members.table.role")}>{ROLE_LABEL[m.role]}</td>
                <td className="phone-hide mid-hide" data-label={t("members.table.teams")}>{teamsText || <span className="muted">{t("common.none")}</span>}</td>
                <td className="phone-hide mid-hide" data-label={t("members.table.location")}>{m.workLocation || <span className="muted">{t("common.notSet")}</span>}</td>
                <td className="phone-hide" data-label={t("members.table.status")}>{status}</td>
                {showPoints && <td className="right phone-hide mid-hide" data-label={t("members.table.points")}>{m.pointsBalance}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableRegion>
  );
}

export const INVITE_STATE_KEY: Record<RosterRow["state"], MessageKey> = { invited: "roster.state.invited", active: "roster.state.active", deactivated: "roster.state.deactivated", revoked: "roster.state.revoked" };

/** What a row shows under its status: how often the invite went out, and when last. */
export function inviteHistory(row: RosterRow): string[] {
  if (row.state === "revoked") return row.revokedAt ? [t("roster.table.revokedOn", { date: formatDate(row.revokedAt) })] : [];
  if (row.state !== "invited") return [];
  const lines: string[] = [];
  if (row.inviteEmailCount) lines.push(row.lastInviteEmailAt ? t("roster.table.emailedLast", { count: row.inviteEmailCount, date: formatDate(row.lastInviteEmailAt) }) : t("roster.table.emailed", { count: row.inviteEmailCount }));
  if (row.resendCount) lines.push(row.lastResentAt ? t("roster.table.resentLast", { count: row.resendCount, date: formatDate(row.lastResentAt) }) : t("roster.table.resent", { count: row.resendCount }));
  return lines;
}

export interface InviteActions {
  /** DIP can email invitations for this company (otherwise the row offers the invite message). */
  inviteEmail: boolean;
  /** The entry whose request is running. */
  busy: string;
  onOpen: (row: RosterRow) => void;
  onEmail: (row: RosterRow) => void;
  onResend: (row: RosterRow) => void;
  onRevoke: (row: RosterRow) => void;
  onReinvite: (row: RosterRow) => void;
}

/** Invited and Revoked tabs (and the invited section of All): people added in advance who have not joined. The name opens their details. */
export function InviteTable({ rows, teamName, busy: tableBusy, label, actions }: {
  rows: RosterRow[]; teamName: (id: string) => string; busy: boolean; label: string; actions: InviteActions;
}) {
  const { inviteEmail, busy, onOpen, onEmail, onResend, onRevoke, onReinvite } = actions;
  return (
    <TableRegion label={label} busy={tableBusy}>
      <table className="table responsive person-table sticky-actions">
        <caption className="sr-only">{label}</caption>
        <thead><tr><th scope="col">{t("roster.table.name")}</th><th scope="col" className="mid-hide">{t("roster.table.role")}</th><th scope="col" className="mid-hide">{t("roster.table.teams")}</th><th scope="col">{t("roster.table.status")}</th><th scope="col" className="mid-hide">{t("roster.table.added")}</th><th scope="col"><span className="sr-only">{t("roster.table.actions")}</span></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const history = inviteHistory(r);
            const state = r.state === "active" ? <span className="status-plain">{t(INVITE_STATE_KEY[r.state])}</span> : <Info tone="warn">{t(INVITE_STATE_KEY[r.state])}</Info>;
            const sub = <span className="person-sub mid-show">{[ROLE_LABEL[r.role], r.teamIds.map(teamName).join(", "), t("roster.sub.added", { date: formatDate(r.invitedAt) })].filter(Boolean).join(" · ")}{r.state !== "active" && history.length === 0 && <span className="phone-only">{state}</span>}</span>;
            const text = <span><strong>{r.displayName}</strong><br /><span className="muted">{r.email}</span>{sub}</span>;
            return (
              <tr key={r.entryId}>
                <th scope="row">
                  {r.memberId
                    ? <Link className="person" href={`/members/detail/?id=${encodeURIComponent(r.memberId)}`}><Avatar name={r.displayName} userId={r.memberId} photoURL={r.photoURL} avatarId={r.avatarId} />{text}</Link>
                    : <button type="button" className="person" onClick={() => onOpen(r)} aria-haspopup="dialog"><Avatar name={r.displayName} userId={r.memberId} photoURL={r.photoURL} avatarId={r.avatarId} />{text}</button>}
                </th>
                <td className="phone-hide mid-hide" data-label={t("roster.table.role")}>{ROLE_LABEL[r.role]}</td>
                <td className="phone-hide mid-hide" data-label={t("roster.table.teams")}>{r.teamIds.map(teamName).join(", ") || <span className="muted">{t("roster.table.noTeams")}</span>}</td>
                <td data-label={t("roster.table.status")} className={history.length ? undefined : "phone-hide"}>
                  {state}
                  {history.map((line) => <span key={line}><br /><span className="muted small-note">{line}</span></span>)}
                </td>
                <td className="phone-hide mid-hide nowrap" data-label={t("roster.table.added")}>{formatDate(r.invitedAt)}</td>
                <td className="right">
                  <div className="row-actions">
                    {r.state === "invited" && inviteEmail && <Button size="sm" disabled={busy === r.entryId} onClick={() => onEmail(r)} aria-label={t("roster.action.emailAria", { name: r.displayName })}>{t("roster.action.email")}</Button>}
                    {r.state === "invited" && !inviteEmail && <Button size="sm" disabled={busy === r.entryId} onClick={() => onResend(r)} aria-label={t("roster.action.resendAria", { name: r.displayName })}>{busy === r.entryId ? t("roster.action.resending") : t("roster.action.resend")}</Button>}
                    {r.state === "invited" && <Button size="sm" className="quiet-danger" onClick={() => onRevoke(r)} aria-label={t("roster.action.revokeAria", { name: r.displayName })}>{t("roster.action.revoke")}</Button>}
                    {r.state === "revoked" && <Button size="sm" disabled={busy === r.entryId} onClick={() => onReinvite(r)} aria-label={t("roster.action.inviteAgainAria", { name: r.displayName })}>{t("roster.action.inviteAgain")}</Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableRegion>
  );
}
