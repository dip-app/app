"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, Info, LoadError, Loading, Notice, SearchBox, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { useDebounced, usePaged } from "@/components/usePaged";
import { LIST_PAGE_SIZE, ROLE_LABEL, type ResendResult, type RosterCounts, type RosterRow, type RosterState } from "@/lib/adminTypes";

type Filter = RosterState | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everyone" }, { id: "invited", label: "Invited" }, { id: "active", label: "Active" },
  { id: "deactivated", label: "Deactivated" }, { id: "revoked", label: "Revoked" },
];
const STATE_LABEL: Record<RosterRow["state"], string> = { invited: "Invited", active: "Active", deactivated: "Deactivated", revoked: "Revoked" };
const number = (n: number) => n.toLocaleString("en-US");
const NO_FILTER = { query: "", status: "all", role: "all", teamId: "all", workLocation: "all" } as const;

type Backfill =
  | { phase: "checking"; scanned: number }
  | { phase: "ready"; created: number; existing: number; skipped: number }
  | null;

export default function RosterPage() {
  const { api } = useApp();
  const company = useLoad((a) => a.companyInfo(), "company");
  // How many people have signed in (a count only): compared with the roster's joined entries to spot members the roster doesn't list yet.
  const members = useLoad((a) => a.listMembersPage(NO_FILTER, null, 1), "member-total");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [revoking, setRevoking] = useState<RosterRow | null>(null);
  const [resent, setResent] = useState<{ row: RosterRow; result: ResendResult } | null>(null);
  const [backfill, setBackfill] = useState<Backfill>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const query = useDebounced(search.trim());

  const list = usePaged<RosterRow, RosterCounts>(
    async (a, cursor) => {
      const page = await a.listRosterPage({ query, state: filter }, cursor, LIST_PAGE_SIZE);
      return { items: [...page.rows].sort((x, y) => x.displayName.localeCompare(y.displayName)), nextCursor: page.nextCursor, extra: page.counts };
    },
    `${filter}|${query}`,
    LIST_PAGE_SIZE,
  );
  const counts = list.extra;
  const teamName = (id: string) => company.data?.teams.find((t) => t.id === id)?.name ?? id;
  const unlisted = useMemo(() => (members.data?.total != null && counts ? Math.max(0, members.data.total - counts.active - counts.deactivated) : 0), [members.data, counts]);
  const searching = query !== "";

  async function resend(row: RosterRow) {
    setBusy(row.entryId);
    setError("");
    try {
      const result = await api.resendInvite(row);
      list.mutate((rows) => rows.map((r) => (r.entryId === row.entryId ? { ...r, resendCount: result.resendCount, lastResentAt: result.lastResentAt } : r)));
      setResent({ row, result });
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy("");
    }
  }

  async function reinvite(row: RosterRow) {
    setBusy(row.entryId);
    setError("");
    try {
      await api.reinvite(row);
      setMessage(`${row.displayName} is invited again. They get the role and teams set here when they sign up.`);
      list.reload();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy("");
    }
  }

  /** Walks every chunk of the backfill (100 members per call); `dryRun` only counts. */
  async function walkBackfill(dryRun: boolean, onStep?: (scanned: number) => void) {
    const total = { created: 0, existing: 0, skipped: 0, scanned: 0 };
    let cursor: string | null = null;
    for (;;) {
      const step = await api.backfillRoster(dryRun, crypto.randomUUID(), cursor);
      total.created += step.created; total.existing += step.existing; total.skipped += step.skipped; total.scanned += step.scanned;
      onStep?.(total.scanned);
      if (step.done || !step.nextCursor) return total;
      cursor = step.nextCursor;
    }
  }
  async function previewBackfill() {
    setError(""); setMessage("");
    setBackfill({ phase: "checking", scanned: 0 });
    try {
      const total = await walkBackfill(true, (scanned) => setBackfill({ phase: "checking", scanned }));
      if (total.created === 0) { setBackfill(null); setMessage("Everyone who has signed in is already on the roster. Nothing to add."); return; }
      setBackfill({ phase: "ready", created: total.created, existing: total.existing, skipped: total.skipped });
    } catch (failure) {
      setBackfill(null);
      setError(describe(failure));
    }
  }

  const empty = list.items.length === 0;
  return (
    <Shell title="Roster" subtitle="Everyone at your company. Invited people were added in advance and get their role and teams when they sign in; anyone with a company email can join." requires="roster.manage"
      action={<Link className="pill-btn purple" href="/import/">Import people</Link>}>
      {unlisted > 0 && (
        <div className="review-banner ok" role="status">
          <span><strong>{number(unlisted)} {unlisted === 1 ? "person has" : "people have"} signed in but {unlisted === 1 ? "isn’t" : "aren’t"} on the roster.</strong> They joined before the roster listed everyone. Adding them keeps them Active with the same role and teams.</span>
          <button className="pill-btn dark small" disabled={backfill?.phase === "checking"} onClick={() => void previewBackfill()}>{backfill?.phase === "checking" ? `Checking ${number(backfill.scanned)}…` : "Add existing members to the roster"}</button>
        </div>
      )}
      <div className="tabs" role="group" aria-label="Filter roster">
        {FILTERS.map((item) => <button key={item.id} className="tab" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}{counts ? ` (${number(counts[item.id])})` : ""}</button>)}
      </div>
      <SearchBox value={search} onChange={setSearch} label="Search by name or email" />
      {message && <Notice>{message}</Notice>}
      {error && <div className="banner error" role="alert"><span>{error}</span></div>}
      {list.error && empty ? <LoadError error={list.error} onRetry={list.reload} />
        : list.loading ? <Loading label="Loading roster" />
        : empty ? (
          <Empty
            title={filter === "invited" && !searching ? "No pending invites" : "Nothing here"}
            body={counts?.all === 0 ? "Import a spreadsheet to add people before they sign in." : filter === "invited" && !searching ? "People you import who haven’t signed in yet show up here as Invited." : "No one matches this filter."}
            action={counts?.all === 0 ? <Link className="pill-btn dark" href="/import/">Import people</Link> : undefined}
          />
        ) : (
          <>
            <p className="muted result-count" role="status">
              {!searching && counts
                ? `Showing ${number(list.items.length)} of ${number(counts[filter])} ${counts[filter] === 1 ? "person" : "people"}`
                : `${number(list.items.length)}${list.hasMore ? " matches so far" : list.items.length === 1 ? " person matches" : " people match"}`}
            </p>
            <div className="table-wrap">
              <table className="table responsive">
                <caption className="sr-only">Roster</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Teams</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {list.items.map((r) => (
                    <tr key={r.entryId}>
                      <td>
                        {r.memberId
                          ? <Link className="person" href={`/members/detail/?id=${encodeURIComponent(r.memberId)}`}><Avatar name={r.displayName} /><span><strong>{r.displayName}</strong><br /><span className="muted">{r.email}</span></span></Link>
                          : <span className="person"><Avatar name={r.displayName} /><span><strong>{r.displayName}</strong><br /><span className="muted">{r.email}</span></span></span>}
                      </td>
                      <td>{ROLE_LABEL[r.role]}</td>
                      <td>{r.teamIds.map(teamName).join(", ") || <span className="muted">None</span>}</td>
                      <td>
                        <Info tone={r.state === "active" || r.state === "invited" ? "ok" : "warn"}>{STATE_LABEL[r.state]}</Info>
                        {r.state === "invited" && r.resendCount ? <><br /><span className="muted small-note">Resent {r.resendCount}×{r.lastResentAt ? `, last ${formatDate(r.lastResentAt)}` : ""}</span></> : null}
                      </td>
                      <td>{formatDate(r.invitedAt)}</td>
                      <td className="right">
                        <div className="row-actions">
                          {r.state === "invited" && <button className="pill-btn dark small" disabled={busy === r.entryId} onClick={() => void resend(r)} aria-label={`Resend invite to ${r.displayName}`}>{busy === r.entryId ? "Working…" : "Resend invite"}</button>}
                          {r.state === "invited" && <button className="pill-btn gray small quiet-danger" onClick={() => setRevoking(r)} aria-label={`Revoke invite for ${r.displayName}`}>Revoke</button>}
                          {r.state === "revoked" && <button className="pill-btn dark small" disabled={busy === r.entryId} onClick={() => void reinvite(r)} aria-label={`Invite ${r.displayName} again`}>Invite again</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.error && <div className="banner error" role="alert"><span>{list.error.message}</span></div>}
            {list.hasMore && (
              <div className="actions">
                <button className="pill-btn gray" disabled={list.loadingMore} onClick={list.loadMore}>{list.loadingMore ? "Loading…" : "Load more"}</button>
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
            list.reload();
          }}>
          <p>{revoking.email} stays able to sign in with a work account, but won’t get the role, teams and location set here. You can import them again later.</p>
        </Dialog>
      )}
      {resent && <ResendDialog row={resent.row} result={resent.result} onClose={() => setResent(null)} />}
      {backfill?.phase === "ready" && (
        <Dialog title="Add existing members to the roster?" confirmLabel={`Add ${number(backfill.created)} ${backfill.created === 1 ? "person" : "people"}`} onClose={() => setBackfill(null)}
          onConfirm={async () => {
            const total = await walkBackfill(false);
            setBackfill(null);
            setMessage(`Added ${number(total.created)} ${total.created === 1 ? "person" : "people"} to the roster.`);
            list.reload();
            members.reload();
          }}>
          <p>{number(backfill.created)} {backfill.created === 1 ? "person has" : "people have"} signed in but {backfill.created === 1 ? "isn’t" : "aren’t"} on the roster. They are added as Active with their current role and teams.</p>
          <p>{number(backfill.existing)} already listed stay as they are{backfill.skipped ? `, ${number(backfill.skipped)} without an email are skipped` : ""}. Nobody is emailed, and it is safe to run again.</p>
        </Dialog>
      )}
    </Shell>
  );
}

/** DIP sends no email: the resend is recorded and this is what the admin shares through their own channel. */
function ResendDialog({ row, result, onClose }: { row: RosterRow; result: ResendResult; onClose: () => void }) {
  return (
    <Dialog title={`Invite message for ${row.displayName}`} confirmLabel="Copy message" onClose={onClose}
      onConfirm={async () => {
        try {
          await navigator.clipboard.writeText(result.message);
        } catch {
          document.querySelector<HTMLTextAreaElement>("#invite-message")?.select(); // clipboard blocked: leave the text selected to copy by hand
          throw new Error("Couldn’t copy automatically. The message is selected: copy it with Ctrl+C or Cmd+C.");
        }
        onClose();
      }}>
      <p><strong>DIP doesn’t send email, so share this message with {row.email} yourself.</strong> The resend is recorded ({result.resendCount}×).</p>
      <div className="field">
        <label htmlFor="invite-message">Message</label>
        <textarea id="invite-message" readOnly rows={5} value={result.message} />
        <span className="hint">Link: {result.signInUrl}</span>
      </div>
    </Dialog>
  );
}
