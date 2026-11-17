"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { TableRegion } from "@/components/TableRegion";
import { toast } from "@/components/Toast";
import { Avatar, Empty, Info, LoadError, LoadMore, Loading, ResultCount, SearchBox } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { useDebounced, usePaged } from "@/components/usePaged";
import { LIST_PAGE_SIZE, ROLE_LABEL, type Member, type MemberQuery, type MemberStatus, type Role } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { membersCsv } from "@/lib/exports";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";

const STATUSES: { id: MemberStatus | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "invited", label: "Invited" }, { id: "deactivated", label: "Deactivated" },
];
const STATUS_IDS = STATUSES.map((item) => item.id);
const ROLES = ["admin", "organizer", "member"] as const;
const number = (n: number) => n.toLocaleString("en-US");
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
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
  const clearable = search !== "" || role !== "all" || team !== "all" || location !== "all";
  const total = list.extra;
  const firstLoad = list.loading && list.items.length === 0;

  async function exportCsv() {
    setExporting(true);
    try {
      const everyone = await list.loadAll();
      downloadText("members.csv", membersCsv(everyone, teams));
      toast(`Exported ${number(everyone.length)} ${everyone.length === 1 ? "person" : "people"} to members.csv.`);
    } catch (failure) {
      toast(describe(failure, "The export didn’t finish. Try again."), { tone: "error" });
    } finally {
      setExporting(false);
    }
  }
  const count = !filtered && total !== null
    ? `Showing ${number(list.items.length)} of ${number(total)} ${total === 1 ? "person" : "people"}`
    : `${number(list.items.length)}${list.hasMore ? " matches so far" : list.items.length === 1 ? " person matches" : " people match"}${total !== null && !list.hasMore ? ` (of ${number(total)})` : ""}`;

  return (
    <Shell title="Members" subtitle="Everyone at your company. Admins can open a person to edit their details." requires="members.view"
      action={<button type="button" className="pill-btn gray" disabled={!list.items.length || exporting} onClick={() => void exportCsv()}>{exporting ? "Exporting…" : "Export CSV"}</button>}>
      <Tabs idBase="members" label="Filter by status" value={status} onChange={(id) => setQs({ status: id })} items={STATUSES} />
      <div className="filters">
        <SearchBox id="members-search" value={search} onChange={(v) => setQs({ q: v })} label="Search by name, email or title" placeholder="Search by name, email or title (press / to focus)" />
        <div className="field"><label htmlFor="f-role">Role</label>
          <select id="f-role" value={role} onChange={(e) => setQs({ role: e.target.value })}>
            <option value="all">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-team">Team</label>
          <select id="f-team" value={team} onChange={(e) => setQs({ team: e.target.value })}>
            <option value="all">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-loc">Work location</label>
          <select id="f-loc" value={location} onChange={(e) => setQs({ location: e.target.value })}>
            <option value="all">All locations</option>{[...new Set([...knownLocations, ...(location !== "all" ? [location] : [])])].sort().map((l) => <option key={l}>{l}</option>)}
          </select></div>
      </div>
      {clearable && (
        <div className="actions"><button type="button" className="pill-btn gray small" onClick={() => setQs({ q: "", role: "all", team: "all", location: "all" })}>Clear filters</button></div>
      )}
      <div {...tabPanelProps("members", status)}>
        {list.error && list.items.length === 0 ? <LoadError error={list.error} onRetry={list.reload} />
          : firstLoad ? <Loading label="Loading members" />
          : list.items.length === 0 ? (
            <Empty title="No one matches" body="Clear a filter or search for a different name." />
          ) : (
            <>
              <ResultCount>{count}</ResultCount>
              <TableRegion label="Company members" busy={list.loading}>
                <table className="table responsive">
                  <caption className="sr-only">Company members</caption>
                  <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Teams</th><th scope="col">Work location</th><th scope="col">Status</th>{showPoints && <th scope="col" className="right">Points</th>}</tr></thead>
                  <tbody>
                    {list.items.map((m) => (
                      <tr key={m.id}>
                        <th scope="row"><Link className="person" href={`/members/detail/?id=${encodeURIComponent(m.id)}`}><Avatar name={m.displayName} photoURL={m.photoURL} avatarId={m.avatarId} /><span><strong>{m.displayName}</strong><br /><span className="muted">{m.email}</span></span></Link></th>
                        <td data-label="Role">{ROLE_LABEL[m.role]}</td>
                        <td data-label="Teams">{m.teamIds.map(teamName).join(", ") || <span className="muted">None</span>}</td>
                        <td data-label="Work location">{m.workLocation || <span className="muted">Not set</span>}</td>
                        <td data-label="Status"><Info tone={m.status === "active" ? "ok" : "warn"}>{m.status === "active" ? "Active" : m.status === "invited" ? "Invited" : "Deactivated"}</Info></td>
                        {showPoints && <td className="right" data-label="Points">{m.pointsBalance}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableRegion>
              {list.error && <div className="banner error" role="alert"><span>{list.error.message}</span></div>}
              {list.hasMore && <LoadMore shown={list.items.length} total={total ?? undefined} loading={list.loadingMore} onClick={list.loadMore} />}
            </>
          )}
      </div>
    </Shell>
  );
}

export default function MembersPage() {
  return <Suspense fallback={<Loading label="Loading members" />}><Members /></Suspense>;
}
