"use client";
// @i18n-migrated

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { AddPersonDialog } from "@/components/AddPersonDialog";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { TableRegion } from "@/components/TableRegion";
import { toast } from "@/components/Toast";
import { Avatar, Empty, Info, LoadError, LoadMore, Loading, ResultCount, SearchBox, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { useDebounced, usePaged } from "@/components/usePaged";
import { LIST_PAGE_SIZE, ROLE_LABEL, type ResendResult, type RosterCounts, type RosterRow, type RosterState } from "@/lib/adminTypes";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, ErrorNotice, InlineNotice } from "@/components/kit";
import { formatNumber, t, type MessageKey } from "@/lib/i18n";

type Filter = RosterState | "all";
const FILTERS: { id: Filter; labelKey: MessageKey }[] = [
  { id: "all", labelKey: "roster.filter.all" }, { id: "invited", labelKey: "roster.state.invited" }, { id: "active", labelKey: "roster.state.active" },
  { id: "deactivated", labelKey: "roster.state.deactivated" }, { id: "revoked", labelKey: "roster.state.revoked" },
];
const STATE_LABEL_KEY: Record<RosterRow["state"], MessageKey> = { invited: "roster.state.invited", active: "roster.state.active", deactivated: "roster.state.deactivated", revoked: "roster.state.revoked" };
const EMPTY_FILTER_KEY: Record<Filter, MessageKey> = { all: "roster.empty.noPeople", invited: "roster.empty.noInvites", active: "roster.empty.noActive", deactivated: "roster.empty.noDeactivated", revoked: "roster.empty.noRevoked" };
const number = (n: number) => formatNumber(n);
const FILTER_IDS = FILTERS.map((item) => item.id);
const DEFAULTS = { filter: "all", q: "" };
const NO_FILTER = { query: "", status: "all", role: "all", teamId: "all", workLocation: "all" } as const;

type Backfill =
  | { phase: "checking"; scanned: number }
  | { phase: "ready"; created: number; existing: number; skipped: number }
  | null;

function Roster() {
  const { api } = useApp();
  const company = useLoad((a) => a.companyInfo(), "company");
  // How many people have signed in (a count only): compared with the roster's joined entries to spot members the roster doesn't list yet.
  const members = useLoad((a) => a.listMembersPage(NO_FILTER, null, 1), "member-total");
  const [qs, setQs] = useQueryState(DEFAULTS);
  const filter: Filter = oneOf(qs.filter, FILTER_IDS, "all");
  const search = qs.q;
  useSlashFocus("roster-search");
  const [revoking, setRevoking] = useState<RosterRow | null>(null);
  const [resent, setResent] = useState<{ row: RosterRow; result: ResendResult } | null>(null);
  const [backfill, setBackfill] = useState<Backfill>(null);
  const [adding, setAdding] = useState(false);
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
      setResent({ row, result }); // the message dialog is the outcome: no toast behind it
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
      toast(t("roster.toast.reinvited", { name: row.displayName }));
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
    setError("");
    setBackfill({ phase: "checking", scanned: 0 });
    try {
      const total = await walkBackfill(true, (scanned) => setBackfill({ phase: "checking", scanned }));
      if (total.created === 0) { setBackfill(null); toast(t("roster.toast.nothingToAdd")); return; }
      setBackfill({ phase: "ready", created: total.created, existing: total.existing, skipped: total.skipped });
    } catch (failure) {
      setBackfill(null);
      setError(describe(failure));
    }
  }

  const empty = list.items.length === 0;
  const hold = useSkeletonGate(list.loading && empty);
  return (
    <Shell title={t("roster.title")} subtitle={t("roster.subtitle")} requires="roster.manage"
      action={<><Button variant="primary" onClick={() => setAdding(true)}>{t("roster.add")}</Button><Button href="/import/">{t("roster.import")}</Button></>}>
      {unlisted > 0 && (
        <div className="review-banner ok" role="status">
          <span><strong>{t("roster.unlisted.headline", { count: unlisted })}</strong> {t("roster.unlisted.detail")}</span>
          <Button variant="primary" size="sm" disabled={backfill?.phase === "checking"} onClick={() => void previewBackfill()}>{backfill?.phase === "checking" ? t("roster.unlisted.checking", { count: number(backfill.scanned) }) : t("roster.unlisted.add")}</Button>
        </div>
      )}
      <Tabs idBase="roster" label={t("roster.filterLabel")} value={filter} onChange={(id) => setQs({ filter: id })}
        items={FILTERS.map((item) => ({ id: item.id, label: t(item.labelKey), ...(counts ? { count: number(counts[item.id]) } : {}) }))} />
      <SearchBox id="roster-search" value={search} onChange={(v) => setQs({ q: v })} label={t("roster.search.label")} placeholder={t("roster.search.placeholder")} />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div {...tabPanelProps("roster", filter)}>
      {list.error && empty ? <LoadError error={list.error} onRetry={list.reload} />
        : (list.loading && empty) || hold ? <Loading label={t("roster.loading")} layout="roster" />
        : empty ? (
          <Empty
            title={counts?.all === 0 ? t("roster.empty.rosterEmpty") : searching ? t("roster.empty.noMatches") : t(EMPTY_FILTER_KEY[filter])}
            body={counts?.all === 0 ? t("roster.empty.importBody") : filter === "invited" && !searching ? t("roster.empty.invitedBody") : searching ? t("roster.empty.searchBody") : t("roster.empty.groupBody")}
            action={counts?.all === 0 ? <Button variant="primary" href="/import/">{t("roster.import")}</Button> : undefined}
          />
        ) : (
          <>
            <ResultCount>
              {!searching && counts
                ? t("roster.count.showingOf", { shown: number(list.items.length), total: counts[filter] })
                : list.hasMore ? t("roster.count.matchesSoFar", { count: number(list.items.length) }) : t("roster.count.matches", { count: list.items.length })}
            </ResultCount>
            <TableRegion label={t("roster.tableLabel")} busy={list.loading}>
              <table className="table responsive">
                <caption className="sr-only">{t("roster.tableLabel")}</caption>
                <thead><tr><th scope="col">{t("roster.table.name")}</th><th scope="col">{t("roster.table.role")}</th><th scope="col">{t("roster.table.teams")}</th><th scope="col">{t("roster.table.status")}</th><th scope="col">{t("roster.table.added")}</th><th scope="col"><span className="sr-only">{t("roster.table.actions")}</span></th></tr></thead>
                <tbody>
                  {list.items.map((r) => (
                    <tr key={r.entryId}>
                      <th scope="row">
                        {r.memberId
                          ? <Link className="person" href={`/members/detail/?id=${encodeURIComponent(r.memberId)}`}><Avatar name={r.displayName} userId={r.memberId} photoURL={r.photoURL} avatarId={r.avatarId} /><span><strong>{r.displayName}</strong><br /><span className="muted">{r.email}</span></span></Link>
                          : <span className="person"><Avatar name={r.displayName} userId={r.memberId} photoURL={r.photoURL} avatarId={r.avatarId} /><span><strong>{r.displayName}</strong><br /><span className="muted">{r.email}</span></span></span>}
                      </th>
                      <td data-label={t("roster.table.role")}>{ROLE_LABEL[r.role]}</td>
                      <td data-label={t("roster.table.teams")}>{r.teamIds.map(teamName).join(", ") || <span className="muted">{t("roster.table.noTeams")}</span>}</td>
                      <td data-label={t("roster.table.status")}>
                        <Info tone={r.state === "active" || r.state === "invited" ? "ok" : "warn"}>{t(STATE_LABEL_KEY[r.state])}</Info>
                        {r.state === "invited" && r.resendCount ? <><br /><span className="muted small-note">{r.lastResentAt ? t("roster.table.resentLast", { count: r.resendCount, date: formatDate(r.lastResentAt) }) : t("roster.table.resent", { count: r.resendCount })}</span></> : null}
                      </td>
                      <td data-label={t("roster.table.added")}>{formatDate(r.invitedAt)}</td>
                      <td className="right">
                        <div className="row-actions">
                          {r.state === "invited" && <Button variant="primary" size="sm" disabled={busy === r.entryId} onClick={() => void resend(r)} aria-label={t("roster.action.resendAria", { name: r.displayName })}>{busy === r.entryId ? t("roster.action.resending") : t("roster.action.resend")}</Button>}
                          {r.state === "invited" && <Button size="sm" className="quiet-danger" onClick={() => setRevoking(r)} aria-label={t("roster.action.revokeAria", { name: r.displayName })}>{t("roster.action.revoke")}</Button>}
                          {r.state === "revoked" && <Button variant="primary" size="sm" disabled={busy === r.entryId} onClick={() => void reinvite(r)} aria-label={t("roster.action.inviteAgainAria", { name: r.displayName })}>{t("roster.action.inviteAgain")}</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
            {list.error && <ErrorNotice error={list.error} />}
            {list.hasMore && <LoadMore shown={list.items.length} total={!searching && counts ? counts[filter] : undefined} loading={list.loadingMore} onClick={list.loadMore} />}
          </>
        )}
      </div>
      {revoking && (
        <Dialog danger title={t("roster.revoke.title", { name: revoking.displayName })} confirmLabel={t("roster.revoke.confirm")} busyLabel={t("roster.revoke.busy")} onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await api.revokeRosterEntry(revoking.entryId);
            setRevoking(null);
            toast(t("roster.toast.revoked", { email: revoking.email }));
            list.reload();
          }}>
          <p>{t("roster.revoke.body", { email: revoking.email })}</p>
        </Dialog>
      )}
      {resent && <ResendDialog row={resent.row} result={resent.result} onClose={() => setResent(null)} />}
      {adding && (
        <AddPersonDialog api={api} domain={company.data?.emailDomain ?? ""} onClose={() => setAdding(false)}
          onAdded={(name) => { setAdding(false); toast(t("roster.toast.addedPerson", { name })); list.reload(); }} />
      )}
      {backfill?.phase === "ready" && (
        <Dialog title={t("roster.backfill.title")} confirmLabel={t("roster.backfill.confirm", { count: backfill.created })} busyLabel={t("roster.backfill.busy")} onClose={() => setBackfill(null)}
          onConfirm={async () => {
            const total = await walkBackfill(false);
            setBackfill(null);
            toast(t("roster.toast.added", { count: total.created }));
            list.reload();
            members.reload();
          }}>
          <p>{t("roster.backfill.signedIn", { count: backfill.created })}</p>
          <p>{backfill.skipped ? t("roster.backfill.existingSkipped", { count: number(backfill.existing), skipped: number(backfill.skipped) }) : t("roster.backfill.existing", { count: number(backfill.existing) })}</p>
        </Dialog>
      )}
    </Shell>
  );
}

export default function RosterPage() {
  return <Suspense fallback={<Loading label={t("roster.loading")} layout="roster" />}><Roster /></Suspense>;
}

/** DIP sends no email: the resend is recorded and this is what the admin shares through their own channel. */
function ResendDialog({ row, result, onClose }: { row: RosterRow; result: ResendResult; onClose: () => void }) {
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
      <p><strong>{t("roster.message.intro", { email: row.email })}</strong> {t("roster.message.recorded", { count: result.resendCount })}</p>
      <div className="field">
        <label htmlFor="invite-message">{t("roster.message.label")}</label>
        <textarea id="invite-message" readOnly rows={5} value={result.message} />
        <span className="hint">{t("roster.message.link", { url: result.signInUrl })}</span>
      </div>
    </Dialog>
  );
}
