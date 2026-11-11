"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, Info, LoadError, Loading, Notice, SearchBox, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { ROLE_LABEL, type RosterRow } from "@/lib/adminTypes";

type Filter = RosterRow["state"] | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everyone" }, { id: "invited", label: "Invited" }, { id: "active", label: "Active" },
  { id: "deactivated", label: "Deactivated" }, { id: "revoked", label: "Revoked" },
];
const STATE_LABEL: Record<RosterRow["state"], string> = { invited: "Invited", active: "Active", deactivated: "Deactivated", revoked: "Revoked" };

export default function RosterPage() {
  const { api } = useApp();
  const roster = useLoad((a) => a.listRoster(), "roster");
  const company = useLoad((a) => a.companyInfo(), "company");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [revoking, setRevoking] = useState<RosterRow | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const teamName = (id: string) => company.data?.teams.find((t) => t.id === id)?.name ?? id;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { invited: 0, active: 0, deactivated: 0, revoked: 0, all: 0 };
    for (const row of roster.data ?? []) { c[row.state] += 1; c.all += 1; }
    return c;
  }, [roster.data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (roster.data ?? []).filter((r) => (filter === "all" || r.state === filter) && (!q || `${r.displayName} ${r.email}`.toLowerCase().includes(q)));
  }, [roster.data, filter, search]);

  async function reinvite(row: RosterRow) {
    setBusy(row.email);
    setError("");
    try {
      await api.reinvite(row);
      setMessage(`${row.displayName} is invited again. They get the role and teams set here when they sign up.`);
      roster.reload();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy("");
    }
  }

  return (
    <Shell title="Roster" subtitle="Everyone at your company. Invited people were added in advance and get their role and teams when they sign in; anyone with a company email can join." requires="roster.manage"
      action={<Link className="pill-btn purple" href="/import/">Import people</Link>}>
      {roster.error ? <LoadError error={roster.error} onRetry={roster.reload} />
        : !roster.data ? <Loading label="Loading roster" />
        : (
          <>
            <div className="tabs" role="group" aria-label="Filter roster">
              {FILTERS.map((item) => <button key={item.id} className="tab" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} ({counts[item.id]})</button>)}
            </div>
            <SearchBox value={search} onChange={setSearch} label="Search by name or email" />
            {message && <Notice>{message}</Notice>}
            {error && <div className="banner error" role="alert"><span>{error}</span></div>}
            {shown.length === 0 ? (
              <Empty
                title={filter === "invited" ? "No pending invites" : "Nothing here"}
                body={roster.data.length === 0 ? "Import a spreadsheet to add people before they sign in." : filter === "invited" ? "People you import who haven’t signed in yet show up here as Invited." : "No one matches this filter."}
                action={roster.data.length === 0 ? <Link className="pill-btn dark" href="/import/">Import people</Link> : undefined}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Roster</caption>
                  <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Teams</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.email}>
                        <td>
                          {r.memberId
                            ? <Link className="person" href={`/members/detail/?id=${encodeURIComponent(r.memberId)}`}><Avatar name={r.displayName} /><span><strong>{r.displayName}</strong><br /><span className="muted">{r.email}</span></span></Link>
                            : <span className="person"><Avatar name={r.displayName} /><span><strong>{r.displayName}</strong><br /><span className="muted">{r.email}</span></span></span>}
                        </td>
                        <td>{ROLE_LABEL[r.role]}</td>
                        <td>{r.teamIds.map(teamName).join(", ") || <span className="muted">None</span>}</td>
                        <td><Info tone={r.state === "active" || r.state === "invited" ? "ok" : "warn"}>{STATE_LABEL[r.state]}</Info></td>
                        <td>{formatDate(r.invitedAt)}</td>
                        <td className="right">
                          {r.state === "invited" && <button className="pill-btn gray small quiet-danger" onClick={() => setRevoking(r)} aria-label={`Revoke invite for ${r.displayName}`}>Revoke</button>}
                          {r.state === "revoked" && <button className="pill-btn dark small" disabled={busy === r.email} onClick={() => void reinvite(r)} aria-label={`Invite ${r.displayName} again`}>Invite again</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      {revoking && (
        <Dialog danger title={`Revoke ${revoking.displayName}’s invite?`} confirmLabel="Revoke invite" onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await api.revokeRosterEntry(revoking.entryId);
            setRevoking(null);
            setMessage(`Invite for ${revoking.email} revoked. They won’t get the role and teams set here when they sign up.`);
            roster.reload();
          }}>
          <p>{revoking.email} stays able to sign in with a work account, but won’t get the role, teams and location set here. You can import them again later.</p>
        </Dialog>
      )}
    </Shell>
  );
}
