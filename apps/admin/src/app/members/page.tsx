"use client";
// @i18n-migrated

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { TableRegion } from "@/components/TableRegion";
import { toast, toastError } from "@/components/Toast";
import { Avatar, Empty, Info, LoadError, LoadMore, Loading, ResultCount, SearchBox } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { useDebounced, usePaged } from "@/components/usePaged";
import { LIST_PAGE_SIZE, ROLE_LABEL, type Member, type MemberQuery, type MemberStatus, type Role } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { membersCsv } from "@/lib/exports";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, ErrorNotice } from "@/components/kit";
import { formatNumber, t, type MessageKey } from "@/lib/i18n";

const STATUSES: { id: MemberStatus | "all"; labelKey: MessageKey }[] = [
  { id: "all", labelKey: "members.status.all" }, { id: "active", labelKey: "members.status.active" },
  { id: "invited", labelKey: "members.status.invited" }, { id: "deactivated", labelKey: "members.status.deactivated" },
];
const STATUS_IDS = STATUSES.map((item) => item.id);
const ROLES = ["admin", "organizer", "member"] as const;
const DEFAULTS = { q: "", status: "all", role: "all", team: "all", location: "all" };

function Members() {
  const company = useLoad((api) => api.companyInfo(), "company");
  const [qs, setQs] = useQueryState(DEFAULTS);
  const search = qs.q;
  const status = oneOf(qs.status, STATUS_IDS, "all");
  const role = oneOf(qs.role, ["all", ...ROLES] as const, "all") as Role | "all";
  const team = qs.team;
  const location = qs.location;
  const [exporting, setExporting] = useState(false);
  const [knownLocations, setKnownLocations] = useState<string[]>([]);
  const query = useDebounced(search.trim());
  useSlashFocus("members-search");

  const filter: MemberQuery = useMemo(() => ({ query, status, role, teamId: team, workLocation: location }), [query, status, role, team, location]);
  const filtered = query !== "" || status !== "all" || role !== "all" || team !== "all" || location !== "all";
  const list = usePaged<Member, number>(
    async (api, cursor) => {
      const page = await api.listMembersPage(filter, cursor, LIST_PAGE_SIZE);
      return { items: [...page.members].sort((a, b) => a.displayName.localeCompare(b.displayName)), nextCursor: page.nextCursor, extra: page.total };
    },
    JSON.stringify(filter),
    LIST_PAGE_SIZE,
  );
  // Work locations to pick from: everything seen so far (the server filters by exact location, so the options must not shrink with the filter).
  useEffect(() => {
    const seen = list.items.map((m) => m.workLocation).filter(Boolean);
    if (seen.length) setKnownLocations((previous) => [...new Set([...previous, ...seen])].sort());
  }, [list.items]);

  const teams = company.data?.teams ?? [];
  // Organizers read people without balances (the backend leaves points out for them).
  const showPoints = list.items.some((m) => m.pointsBalance !== null);
  const teamName = (id: string) => teams.find((team) => team.id === id)?.name ?? id;
  const clearable = search !== "" || role !== "all" || team !== "all" || location !== "all";
  const total = list.extra;
  const firstLoad = list.loading && list.items.length === 0;
  const holdLoad = useSkeletonGate(firstLoad);

  async function exportCsv() {
    setExporting(true);
    try {
      const everyone = await list.loadAll();
      downloadText("members.csv", membersCsv(everyone, teams));
      toast(t("members.export.done", { count: everyone.length }));
    } catch (failure) {
      toastError(failure, t("common.exportFailed"));
    } finally {
      setExporting(false);
    }
  }
  const shownCount = formatNumber(list.items.length);
  const matches = list.hasMore ? t("members.count.matchesSoFar", { shown: shownCount }) : t("members.count.matches", { shown: list.items.length });
  const count = !filtered && total !== null
    ? t("members.count.showingOf", { shown: shownCount, total })
    : total !== null && !list.hasMore ? t("members.count.withTotal", { matches, total: formatNumber(total) }) : matches;

  return (
    <Shell title={t("members.title")} subtitle={t("members.subtitle")} requires="members.view"
      action={<Button disabled={!list.items.length || exporting} onClick={() => void exportCsv()}>{exporting ? t("common.exporting") : t("common.exportCsv")}</Button>}>
      <Tabs idBase="members" label={t("members.filterByStatus")} value={status} onChange={(id) => setQs({ status: id })} items={STATUSES.map((item) => ({ id: item.id, label: t(item.labelKey) }))} />
      <div className="filters">
        <SearchBox id="members-search" value={search} onChange={(v) => setQs({ q: v })} label={t("members.search.label")} placeholder={t("members.search.placeholder")} />
        <div className="field"><label htmlFor="f-role">{t("members.filter.role")}</label>
          <select id="f-role" value={role} onChange={(e) => setQs({ role: e.target.value })}>
            <option value="all">{t("members.filter.allRoles")}</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-team">{t("members.filter.team")}</label>
          <select id="f-team" value={team} onChange={(e) => setQs({ team: e.target.value })}>
            <option value="all">{t("members.filter.allTeams")}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-loc">{t("members.filter.location")}</label>
          <select id="f-loc" value={location} onChange={(e) => setQs({ location: e.target.value })}>
            <option value="all">{t("members.filter.allLocations")}</option>{[...new Set([...knownLocations, ...(location !== "all" ? [location] : [])])].sort().map((l) => <option key={l}>{l}</option>)}
          </select></div>
      </div>
      {clearable && (
        <div className="actions"><Button size="sm" onClick={() => setQs({ q: "", role: "all", team: "all", location: "all" })}>{t("members.filter.clear")}</Button></div>
      )}
      <div {...tabPanelProps("members", status)}>
        {list.error && list.items.length === 0 ? <LoadError error={list.error} onRetry={list.reload} />
          : firstLoad || holdLoad ? <Loading label={t("members.loading")} layout="members" />
          : list.items.length === 0 ? (
            <Empty title={t("members.empty.title")} body={t("members.empty.body")} />
          ) : (
            <>
              <ResultCount>{count}</ResultCount>
              <TableRegion label={t("members.table.label")} busy={list.loading}>
                <table className="table responsive">
                  <caption className="sr-only">{t("members.table.label")}</caption>
                  <thead><tr><th scope="col">{t("members.table.name")}</th><th scope="col">{t("members.table.role")}</th><th scope="col">{t("members.table.teams")}</th><th scope="col">{t("members.table.location")}</th><th scope="col">{t("members.table.status")}</th>{showPoints && <th scope="col" className="right">{t("members.table.points")}</th>}</tr></thead>
                  <tbody>
                    {list.items.map((m) => (
                      <tr key={m.id}>
                        <th scope="row"><Link className="person" href={`/members/detail/?id=${encodeURIComponent(m.id)}`}><Avatar name={m.displayName} userId={m.id} photoURL={m.photoURL} avatarId={m.avatarId} /><span><strong>{m.displayName}</strong><br /><span className="muted">{m.email}</span></span></Link></th>
                        <td data-label={t("members.table.role")}>{ROLE_LABEL[m.role]}</td>
                        <td data-label={t("members.table.teams")}>{m.teamIds.map(teamName).join(", ") || <span className="muted">{t("common.none")}</span>}</td>
                        <td data-label={t("members.table.location")}>{m.workLocation || <span className="muted">{t("common.notSet")}</span>}</td>
                        <td data-label={t("members.table.status")}><Info tone={m.status === "active" ? "ok" : "warn"}>{t(m.status === "active" ? "members.chip.active" : m.status === "invited" ? "members.chip.invited" : "members.chip.deactivated")}</Info></td>
                        {showPoints && <td className="right" data-label={t("members.table.points")}>{m.pointsBalance}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableRegion>
              {list.error && <ErrorNotice error={list.error} />}
              {list.hasMore && <LoadMore shown={list.items.length} total={total ?? undefined} loading={list.loadingMore} onClick={list.loadMore} />}
            </>
          )}
      </div>
    </Shell>
  );
}

export default function MembersPage() {
  return <Suspense fallback={<Loading label={t("members.loading")} layout="members" />}><Members /></Suspense>;
}
