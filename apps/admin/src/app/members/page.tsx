"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, Info, LoadError, Loading, SearchBox } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { useDebounced, usePaged } from "@/components/usePaged";
import { LIST_PAGE_SIZE, ROLE_LABEL, type Member, type MemberQuery, type MemberStatus, type Role } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { membersCsv } from "@/lib/exports";

const STATUSES: { id: MemberStatus | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "invited", label: "Invited" }, { id: "deactivated", label: "Deactivated" },
];
const number = (n: number) => n.toLocaleString("en-US");

export default function MembersPage() {
  const company = useLoad((api) => api.companyInfo(), "company");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MemberStatus | "all">("all");
  const [role, setRole] = useState<Role | "all">("all");
  const [team, setTeam] = useState("all");
  const [location, setLocation] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [knownLocations, setKnownLocations] = useState<string[]>([]);
  const query = useDebounced(search.trim());

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

  async function exportCsv() {
    setExporting(true);
    try {
      const everyone = await list.loadAll();
      downloadText("members.csv", membersCsv(everyone, teams));
    } finally {
      setExporting(false);
    }
  }
  const count = !filtered && total !== null
    ? `Showing ${number(list.items.length)} of ${number(total)} ${total === 1 ? "person" : "people"}`
    : `${number(list.items.length)}${list.hasMore ? " matches so far" : list.items.length === 1 ? " person matches" : " people match"}${total !== null && !list.hasMore ? ` (of ${number(total)})` : ""}`;

  return (
    <Shell title="Members" subtitle="Everyone at your company. Admins can open a person to edit their details." requires="members.view"
      action={<button className="pill-btn gray" disabled={!list.items.length || exporting} onClick={() => void exportCsv()}>{exporting ? "Exporting…" : "Export CSV"}</button>}>
      <div className="tabs" role="group" aria-label="Filter by status">
        {STATUSES.map((item) => (
          <button key={item.id} className="tab" aria-pressed={status === item.id} onClick={() => setStatus(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="filters">
        <SearchBox value={search} onChange={setSearch} label="Search by name, email or title" />
        <div className="field"><label htmlFor="f-role">Role</label>
          <select id="f-role" value={role} onChange={(e) => setRole(e.target.value as Role | "all")}>
            <option value="all">All roles</option>{(["admin", "organizer", "member"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-team">Team</label>
          <select id="f-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="f-loc">Work location</label>
          <select id="f-loc" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="all">All locations</option>{[...new Set([...knownLocations, ...(location !== "all" ? [location] : [])])].sort().map((l) => <option key={l}>{l}</option>)}
          </select></div>
      </div>
      {clearable && (
        <div className="actions"><button className="pill-btn gray small" onClick={() => { setSearch(""); setRole("all"); setTeam("all"); setLocation("all"); }}>Clear filters</button></div>
      )}
      {list.error && list.items.length === 0 ? <LoadError error={list.error} onRetry={list.reload} />
        : list.loading ? <Loading label="Loading members" />
        : list.items.length === 0 ? (
          <Empty title="No one matches" body="Clear a filter or search for a different name." />
        ) : (
          <>
            <p className="muted result-count" role="status">{count}</p>
            <div className="table-wrap">
              <table className="table responsive">
                <caption className="sr-only">Company members</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Teams</th><th scope="col">Work location</th><th scope="col">Status</th>{showPoints && <th scope="col" className="right">Points</th>}</tr></thead>
                <tbody>
                  {list.items.map((m) => (
                    <tr key={m.id}>
                      <td><Link className="person" href={`/members/detail/?id=${encodeURIComponent(m.id)}`}><Avatar name={m.displayName} /><span><strong>{m.displayName}</strong><br /><span className="muted">{m.email}</span></span></Link></td>
                      <td>{ROLE_LABEL[m.role]}</td>
                      <td>{m.teamIds.map(teamName).join(", ") || <span className="muted">None</span>}</td>
                      <td>{m.workLocation || <span className="muted">Not set</span>}</td>
                      <td><Info tone={m.status === "active" ? "ok" : "warn"}>{m.status === "active" ? "Active" : m.status === "invited" ? "Invited" : "Deactivated"}</Info></td>
                      {showPoints && <td className="right">{m.pointsBalance}</td>}
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
    </Shell>
  );
}
