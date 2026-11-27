"use client";
// @i18n-migrated

import { Suspense, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { AddPersonDialog } from "@/components/AddPersonDialog";
import { Dialog } from "@/components/Dialog";
import { InvitedPersonDialog, ResendDialog } from "@/components/InviteDialogs";
import { rosterFilterStatus } from "@/components/Redirect";
import { type InviteActions, InviteTable, MemberTable } from "@/components/PeopleTables";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { dismissAllToasts, toast, toastError } from "@/components/Toast";
import { Empty, LoadError, LoadMore, Loading, ResultCount, SearchBox, formatDateTime } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { type Paged, useDebounced, usePaged } from "@/components/usePaged";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, ErrorNotice, InlineNotice } from "@/components/kit";
import { LIST_PAGE_SIZE, ROLE_LABEL, can, type Member, type MemberQuery, type ResendResult, type Role, type RosterCounts, type RosterRow } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { invitesCsv, membersCsv } from "@/lib/exports";
import { formatNumber, t, type MessageKey } from "@/lib/i18n";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";

/**
 * Everyone at the company on one page. All, Active and Deactivated list people who joined (the members callable);
 * Invited and Revoked list people added in advance who have not signed in (the roster callable). Admins who manage
 * invitations also see the invited people under All, so a search finds anyone.
 */
type View = "all" | "active" | "invited" | "deactivated" | "revoked";
const VIEWS: { id: View; labelKey: MessageKey; invites?: true }[] = [
  { id: "all", labelKey: "members.status.all" }, { id: "active", labelKey: "members.status.active" },
  { id: "invited", labelKey: "members.status.invited", invites: true }, { id: "deactivated", labelKey: "members.status.deactivated" },
  { id: "revoked", labelKey: "members.status.revoked", invites: true },
];
const VIEW_IDS = VIEWS.map((item) => item.id);
const ROLES = ["admin", "organizer", "member"] as const;
/** `filter` is the old Roster parameter, kept only to read it once (see the effect in Members). */
const DEFAULTS = { q: "", status: "all", role: "all", team: "all", location: "all", filter: "" };
const NO_FILTER: MemberQuery = { query: "", status: "all", role: "all", teamId: "all", workLocation: "all" };
const EMPTY_INVITES: Record<"invited" | "revoked", { title: MessageKey; body: MessageKey }> = {
  invited: { title: "members.invited.empty.title", body: "members.invited.empty.body" },
  revoked: { title: "members.revoked.empty.title", body: "members.revoked.empty.body" },
};
const number = (n: number) => formatNumber(n);

type Backfill = { phase: "checking"; scanned: number } | { phase: "ready"; created: number; existing: number; skipped: number } | null;

function Members() {
  const { api, session } = useApp();
  const canInvite = can(session?.role, "roster.manage");
  const canImport = can(session?.role, "import.run");
  const company = useLoad((a) => a.companyInfo(), "company");
  const [qs, setQs] = useQueryState(DEFAULTS);
  // An old Roster link that hosting redirected here (301, query kept): its `filter` picks the view, then leaves the URL.
  useEffect(() => { if (qs.filter) setQs({ status: rosterFilterStatus(qs.filter), filter: "" }); }, [qs.filter, setQs]);
  const requested = oneOf(qs.status, VIEW_IDS, "all");
  // Organizers look people up but don't manage invitations: the invite views fall back to All.
  const view: View = !canInvite && (requested === "invited" || requested === "revoked") ? "all" : requested;
  const joinedView = view === "all" || view === "active" || view === "deactivated";
  const search = qs.q;
  const role = oneOf(qs.role, ["all", ...ROLES] as const, "all") as Role | "all";
  const team = qs.team;
  const location = qs.location;
  const query = useDebounced(search.trim());
  useSlashFocus("members-search");
  const memberFilters = role !== "all" || team !== "all" || location !== "all";

  // Tab counts, all from the server's first pages: the company total and the per-status member counts (members callable)
  // and the invitation counts (roster callable).
  const memberTotal = useLoad((a) => a.listMembersPage(NO_FILTER, null, 1), "member-total");
  const summary = useLoad((a) => (canInvite ? a.listRosterPage({ query: "", state: "invited" }, null, 1) : Promise.resolve(null)), `roster-summary|${canInvite}`);
  const counts: RosterCounts | null = summary.data?.counts ?? null;
  // DIP can email invitations for this company: rows email the invite (the message stays one click away).
  const inviteEmail = summary.data?.inviteEmail === true;
  const total = memberTotal.data?.total ?? null;
  const statusCounts = memberTotal.data?.statusCounts ?? null;
  // People who signed in before the roster listed everyone: the roster's joined entries don't add up to the member total.
  const unlisted = total !== null && counts ? Math.max(0, total - counts.active - counts.deactivated) : 0;

  // People who joined. The callable filters by status, role, team and location; rows are sorted by name per page.
  const filter: MemberQuery = useMemo(() => ({ query, status: view === "active" || view === "deactivated" ? view : "all", role, teamId: team, workLocation: location }), [query, view, role, team, location]);
  const members = usePaged<Member, number>(
    async (a, cursor) => {
      if (!joinedView) return { items: [], nextCursor: null, extra: null };
      const page = await a.listMembersPage(filter, cursor, LIST_PAGE_SIZE);
      return { items: [...page.members].sort((x, y) => x.displayName.localeCompare(y.displayName)), nextCursor: page.nextCursor, extra: page.total };
    },
    joinedView ? JSON.stringify(filter) : "off",
    LIST_PAGE_SIZE,
  );
  // People invited in advance: the Invited and Revoked tabs, and the invited section under All. The roster callable takes
  // the same search, role, team and location filters as the members callable, so the section stays under any filter.
  const inviteState = view === "invited" || view === "revoked" ? view : view === "all" && canInvite ? "invited" : null;
  const inviteFilter = useMemo(() => (inviteState ? { query, state: inviteState, role, teamId: team, workLocation: location } : null), [inviteState, query, role, team, location]);
  const invites = usePaged<RosterRow, null>(
    async (a, cursor) => {
      if (!inviteFilter) return { items: [], nextCursor: null, extra: null };
      const page = await a.listRosterPage(inviteFilter, cursor, LIST_PAGE_SIZE);
      return { items: [...page.rows].sort((x, y) => x.displayName.localeCompare(y.displayName)), nextCursor: page.nextCursor, extra: null };
    },
    inviteFilter ? JSON.stringify(inviteFilter) : "off",
    LIST_PAGE_SIZE,
  );

  // Work locations to pick from: everything seen so far in either list (the server filters by exact location, so the
  // options must not shrink with the filter).
  const [knownLocations, setKnownLocations] = useState<string[]>([]);
  useEffect(() => {
    const seen = [...members.items.map((m) => m.workLocation), ...invites.items.map((r) => r.workLocation)].filter(Boolean);
    if (seen.length) setKnownLocations((previous) => [...new Set([...previous, ...seen])].sort());
  }, [members.items, invites.items]);

  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState<RosterRow | null>(null);
  const [revoking, setRevoking] = useState<RosterRow | null>(null);
  const [resent, setResent] = useState<{ row: RosterRow; result: ResendResult } | null>(null);
  const [emailing, setEmailing] = useState<RosterRow | null>(null);
  const [backfill, setBackfill] = useState<Backfill>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const teams = company.data?.teams ?? [];
  const teamName = (id: string) => teams.find((item) => item.id === id)?.name ?? id;
  // Organizers read people without balances (the backend leaves points out for them).
  const showPoints = members.items.some((m) => m.pointsBalance !== null);

  function refreshInvites() {
    invites.reload();
    summary.reload();
  }

  /** Exports the list the tab shows (with its search and filters): people who joined, or the invited or revoked people. */
  async function exportCsv() {
    setExporting(true);
    try {
      if (!joinedView) {
        const rows = await invites.loadAll();
        const file = `${view}.csv`;
        downloadText(file, invitesCsv(rows, teams));
        toast(t("members.export.doneFile", { count: rows.length, file }));
        return;
      }
      const everyone = await members.loadAll();
      downloadText("members.csv", membersCsv(everyone, teams));
      toast(t("members.export.done", { count: everyone.length }));
    } catch (failure) {
      toastError(failure, t("common.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function resend(row: RosterRow) {
    setBusy(row.entryId);
    setError("");
    try {
      const result = await api.resendInvite(row);
      invites.mutate((rows) => rows.map((r) => (r.entryId === row.entryId ? { ...r, resendCount: result.resendCount, lastResentAt: result.lastResentAt } : r)));
      setResent({ row, result }); // the message dialog is the outcome: no toast behind it
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy("");
    }
  }

  /** Confirmed in a dialog; the row shows the new count right away (the email goes out within a few minutes). */
  async function sendEmail(row: RosterRow) {
    const result = await api.sendInviteEmail(row);
    invites.mutate((rows) => rows.map((r) => (r.entryId === row.entryId ? { ...r, inviteEmailCount: result.inviteEmailCount, lastInviteEmailAt: result.lastInviteEmailAt } : r)));
    setEmailing(null);
    setOpened(null);
    toast(t("roster.toast.emailed", { email: row.email }));
  }

  async function reinvite(row: RosterRow) {
    setBusy(row.entryId);
    setError("");
    try {
      await api.reinvite(row);
      toast(t("roster.toast.reinvited", { name: row.displayName }));
      refreshInvites();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy("");
    }
  }

  /** After Add person: optionally email the new person right away (their entry is looked up by the email just added). */
  async function added(name: string, email: string, emailNow: boolean) {
    setAdding(false);
    setError("");
    if (!emailNow) {
      toast(t(inviteEmail ? "roster.toast.addedPersonEmail" : "roster.toast.addedPerson", { name }));
      refreshInvites();
      return;
    }
    try {
      const found = (await api.listRosterPage({ query: email, state: "invited" }, null, 5)).rows.find((r) => r.email === email);
      if (!found) throw new Error(t("common.genericError"));
      await api.sendInviteEmail(found);
      toast(t("roster.toast.addedEmailed", { name }));
    } catch (failure) {
      toast(t("roster.toast.addedPersonEmail", { name }));
      setError(describe(failure));
    } finally {
      refreshInvites();
    }
  }

  /** Walks every chunk of the backfill (100 members per call); `dryRun` only counts. */
  async function walkBackfill(dryRun: boolean, onStep?: (scanned: number) => void) {
    const sum = { created: 0, existing: 0, skipped: 0, scanned: 0 };
    let cursor: string | null = null;
    for (;;) {
      const step = await api.backfillRoster(dryRun, crypto.randomUUID(), cursor);
      sum.created += step.created; sum.existing += step.existing; sum.skipped += step.skipped; sum.scanned += step.scanned;
      onStep?.(sum.scanned);
      if (step.done || !step.nextCursor) return sum;
      cursor = step.nextCursor;
    }
  }
  async function previewBackfill() {
    setError("");
    setBackfill({ phase: "checking", scanned: 0 });
    try {
      const sum = await walkBackfill(true, (scanned) => setBackfill({ phase: "checking", scanned }));
      if (sum.created === 0) { setBackfill(null); toast(t("roster.toast.nothingToAdd")); return; }
      setBackfill({ phase: "ready", created: sum.created, existing: sum.existing, skipped: sum.skipped });
    } catch (failure) {
      setBackfill(null);
      setError(describe(failure));
    }
  }

  const actions: InviteActions = {
    inviteEmail, busy,
    onOpen: (row) => { dismissAllToasts(); setOpened(row); },
    onEmail: (row) => { dismissAllToasts(); setEmailing(row); },
    onResend: (row) => void resend(row),
    onRevoke: (row) => setRevoking(row),
    onReinvite: (row) => void reinvite(row),
  };

  // Tab counts, exact from the server: Active and Deactivated from the members callable, Invited and Revoked from the
  // roster callable. They appear together once both first pages are in, so the tabs never shift one count at a time.
  const countsReady = statusCounts !== null && total !== null && (!canInvite || counts !== null);
  const countFor = (id: View): number | undefined => {
    if (!countsReady) return undefined;
    if (id === "all") return total + (canInvite && counts ? counts.invited : 0);
    if (id === "invited" || id === "revoked") return counts ? counts[id] : undefined;
    return statusCounts[id];
  };
  const tabs = VIEWS.filter((item) => !item.invites || (canInvite && (item.id !== "revoked" || view === "revoked" || (counts?.revoked ?? 0) > 0)))
    .map((item) => { const count = countFor(item.id); return { id: item.id, label: t(item.labelKey), ...(count !== undefined ? { count: number(count) } : {}) }; });

  // Export is on every tab (it exports what the tab lists), so the header and the tab row stay put between tabs.
  const exportable = joinedView ? members.items.length > 0 : invites.items.length > 0;
  const header = (
    <>
      <Button disabled={!exportable || exporting} onClick={() => void exportCsv()}>{exporting ? t("common.exporting") : t("common.exportCsv")}</Button>
      {canImport && <Button href="/import/">{t("roster.import")}</Button>}
      {canInvite && <Button variant="primary" onClick={() => setAdding(true)}>{t("roster.add")}</Button>}
    </>
  );

  return (
    <Shell title={t("members.title")} subtitle={t(canInvite ? "members.subtitle.invites" : "members.subtitle")} requires="members.view" action={header}>
      {canInvite && unlisted > 0 && (
        <div className="review-banner ok" role="status">
          <span><strong>{t("roster.unlisted.headline", { count: unlisted })}</strong> {t("roster.unlisted.detail")}</span>
          <Button size="sm" disabled={backfill?.phase === "checking"} onClick={() => void previewBackfill()}>{backfill?.phase === "checking" ? t("roster.unlisted.checking", { count: number(backfill.scanned) }) : t("roster.unlisted.add")}</Button>
        </div>
      )}
      <Tabs idBase="members" label={t("members.filterByStatus")} value={view} onChange={(id) => setQs({ status: id })} items={tabs} />
      <div className="filters">
        <SearchBox shortcut id="members-search" value={search} onChange={(v) => setQs({ q: v })} label={t("members.search.label")} placeholder={t("members.search.placeholder")} />
        <div className="field"><label htmlFor="f-role">{t("members.filter.role")}</label>
          <select id="f-role" value={role} onChange={(e) => setQs({ role: e.target.value })}>
            <option value="all">{t("members.filter.allRoles")}</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-team">{t("members.filter.team")}</label>
          <select id="f-team" value={team} onChange={(e) => setQs({ team: e.target.value })}>
            <option value="all">{t("members.filter.allTeams")}</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-loc">{t("members.filter.location")}</label>
          <select id="f-loc" value={location} onChange={(e) => setQs({ location: e.target.value })}>
            <option value="all">{t("members.filter.allLocations")}</option>{[...new Set([...knownLocations, ...(location !== "all" ? [location] : [])])].sort().map((l) => <option key={l}>{l}</option>)}
          </select></div>
      </div>
      {(search !== "" || memberFilters) && (
        <div className="actions"><Button size="sm" onClick={() => setQs({ q: "", role: "all", team: "all", location: "all" })}>{t(memberFilters ? "members.filter.clear" : "members.filter.clearSearch")}</Button></div>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div key={view} {...tabPanelProps("members", view)}>
        {joinedView
          ? <JoinedPanel members={members} query={query} knownTotal={query !== "" || memberFilters ? undefined : view === "all" ? total ?? undefined : countFor(view)} teamName={teamName} showPoints={showPoints}
              invitesBelow={inviteState !== null && invites.items.length > 0} />
          : <InvitesPanel list={invites} view={view as "invited" | "revoked"} query={query} filtered={memberFilters} counts={counts} teamName={teamName} actions={actions} canImport={canImport} />}
        {view === "all" && inviteState && invites.items.length > 0 && (
          <section className="list-section" aria-labelledby="invited-heading">
            <h2 id="invited-heading" className="list-section-title">{t("members.invited.section", { count: !query && !memberFilters && counts ? counts.invited : invites.items.length })}</h2>
            <p className="muted list-section-note">{t("members.invited.sectionNote")}</p>
            <InviteTable rows={invites.items} teamName={teamName} busy={invites.loading} label={t("members.invited.tableLabel")} actions={actions} />
            {invites.error && <ErrorNotice error={invites.error} />}
            {invites.hasMore && <LoadMore hideCount shown={invites.items.length} loading={invites.loadingMore} onClick={invites.loadMore} />}
          </section>
        )}
      </div>

      {opened && (
        <InvitedPersonDialog row={opened} inviteEmail={inviteEmail} teamName={teamName} onClose={() => setOpened(null)}
          onEmail={sendEmail} onResend={(row) => { setOpened(null); void resend(row); }} onRevoke={(row) => setRevoking(row)}
          onReinvite={async (row) => { await api.reinvite(row); setOpened(null); toast(t("roster.toast.reinvited", { name: row.displayName })); refreshInvites(); }} />
      )}
      {revoking && (
        <Dialog danger title={t("roster.revoke.title", { name: revoking.displayName })} confirmLabel={t("roster.revoke.confirm")} busyLabel={t("roster.revoke.busy")} onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await api.revokeRosterEntry(revoking.entryId);
            setRevoking(null);
            toast(t("roster.toast.revoked", { email: revoking.email }));
            refreshInvites();
          }}>
          <p>{t("roster.revoke.body", { email: revoking.email })}</p>
        </Dialog>
      )}
      {resent && <ResendDialog row={resent.row} result={resent.result} inviteEmail={inviteEmail} onClose={() => setResent(null)} />}
      {emailing && (
        <Dialog title={t("roster.email.title", { name: emailing.displayName })} confirmLabel={t("roster.email.confirm")} busyLabel={t("roster.email.busy")}
          onClose={() => setEmailing(null)} onConfirm={() => sendEmail(emailing)}>
          <p>{t("roster.email.body", { email: emailing.email })}</p>
          {emailing.inviteEmailCount ? <p className="muted">{emailing.lastInviteEmailAt ? t("roster.email.sentBefore", { count: emailing.inviteEmailCount, date: formatDateTime(emailing.lastInviteEmailAt) }) : t("roster.table.emailed", { count: emailing.inviteEmailCount })}</p> : null}
          <p className="muted">{t("roster.email.copyInstead")}</p>
          <div><Button onClick={() => { const row = emailing; setEmailing(null); void resend(row); }}>{t("roster.action.resend")}</Button></div>
        </Dialog>
      )}
      {adding && (
        <AddPersonDialog api={api} domain={company.data?.emailDomain ?? ""} onClose={() => setAdding(false)}
          inviteEmail={inviteEmail} onAdded={(name, email, emailNow) => void added(name, email, emailNow)} />
      )}
      {backfill?.phase === "ready" && (
        <Dialog title={t("roster.backfill.title")} confirmLabel={t("roster.backfill.confirm", { count: backfill.created })} busyLabel={t("roster.backfill.busy")} onClose={() => setBackfill(null)}
          onConfirm={async () => {
            const sum = await walkBackfill(false);
            setBackfill(null);
            toast(t("roster.toast.added", { count: sum.created }));
            refreshInvites();
            memberTotal.reload();
          }}>
          <p>{t("roster.backfill.signedIn", { count: backfill.created })}</p>
          <p>{backfill.skipped ? t("roster.backfill.existingSkipped", { count: number(backfill.existing), skipped: number(backfill.skipped) }) : t("roster.backfill.existing", { count: number(backfill.existing) })}</p>
        </Dialog>
      )}
    </Shell>
  );
}

/** All, Active and Deactivated: people who joined. */
function JoinedPanel({ members, query, knownTotal, teamName, showPoints, invitesBelow }: {
  members: Paged<Member, number>; query: string; /** How many the list has in all, when known (no search or filter). */ knownTotal?: number; teamName: (id: string) => string; showPoints: boolean;
  /** Invited people matched below (All): an empty member list then says so instead of "No one matches". */
  invitesBelow: boolean;
}) {
  const total = members.extra;
  const firstLoad = members.loading && members.items.length === 0;
  const hold = useSkeletonGate(firstLoad);
  if (members.error && members.items.length === 0) return <LoadError error={members.error} onRetry={members.reload} />;
  if (firstLoad || hold) return <Loading label={t("members.loading")} layout="members" />;
  if (members.items.length === 0) {
    return invitesBelow ? <p className="muted">{t("members.empty.onlyInvited")}</p> : <Empty title={t("members.empty.title")} body={t(query ? "members.empty.body" : "members.empty.groupBody")} />;
  }
  const shownCount = formatNumber(members.items.length);
  const matches = members.hasMore ? t("members.count.matchesSoFar", { shown: shownCount }) : t("members.count.matches", { shown: members.items.length });
  const count = knownTotal !== undefined ? t(invitesBelow ? "members.count.showingOfJoined" : "members.count.showingOf", { shown: shownCount, total: knownTotal }) : matches;
  return (
    <>
      <ResultCount>{count}</ResultCount>
      <MemberTable members={members.items} teamName={teamName} showPoints={showPoints} busy={members.loading} />
      {members.error && <ErrorNotice error={members.error} />}
      {members.hasMore && <LoadMore hideCount shown={members.items.length} total={total ?? undefined} loading={members.loadingMore} onClick={members.loadMore} />}
    </>
  );
}

/** Invited and Revoked: people added in advance who have not joined. */
function InvitesPanel({ list, view, query, filtered, counts, teamName, actions, canImport }: {
  list: Paged<RosterRow, null>; counts: RosterCounts | null; view: "invited" | "revoked"; query: string; /** A role, team or location filter is set (the state counts then are not the list total). */ filtered: boolean; teamName: (id: string) => string; actions: InviteActions; canImport: boolean;
}) {
  const empty = list.items.length === 0;
  const hold = useSkeletonGate(list.loading && empty);
  if (list.error && empty) return <LoadError error={list.error} onRetry={list.reload} />;
  if ((list.loading && empty) || hold) return <Loading label={t("members.loading")} layout="roster" />;
  if (empty) {
    return query || filtered
      ? <Empty title={t("members.empty.title")} body={t(filtered ? "members.empty.body" : "members.empty.searchBody")} />
      : <Empty title={t(EMPTY_INVITES[view].title)} body={t(EMPTY_INVITES[view].body)} action={view === "invited" && canImport ? <Button href="/import/">{t("roster.import")}</Button> : undefined} />;
  }
  return (
    <>
      <ResultCount>{!query && !filtered && counts ? t("roster.count.showingOf", { shown: number(list.items.length), total: counts[view] }) : list.hasMore ? t("roster.count.matchesSoFar", { count: number(list.items.length) }) : t("roster.count.matches", { count: list.items.length })}</ResultCount>
      <InviteTable rows={list.items} teamName={teamName} busy={list.loading} label={t(view === "invited" ? "members.invited.tableLabel" : "members.revoked.tableLabel")} actions={actions} />
      {list.error && <ErrorNotice error={list.error} />}
      {list.hasMore && <LoadMore hideCount shown={list.items.length} total={!query && !filtered && counts ? counts[view] : undefined} loading={list.loadingMore} onClick={list.loadMore} />}
    </>
  );
}

export default function MembersPage() {
  return <Suspense fallback={<Loading label={t("members.loading")} layout="members" />}><Members /></Suspense>;
}
