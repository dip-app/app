"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, Info, LoadError, Loading, SearchBox } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { ROLE_LABEL, type MemberStatus, type Role } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { membersCsv } from "@/lib/exports";

const STATUSES: { id: MemberStatus | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "invited", label: "Invited" }, { id: "deactivated", label: "Deactivated" },
];
const PAGE = 25;

export default function MembersPage() {
  const members = useLoad((api) => api.listMembers(), "members");
  const company = useLoad((api) => api.companyInfo(), "company");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MemberStatus | "all">("all");
  const [role, setRole] = useState<Role | "all">("all");
  const [team, setTeam] = useState("all");
  const [location, setLocation] = useState("all");
  const [shown, setShown] = useState(PAGE);

  const teams = company.data?.teams ?? [];
  // Organizers read people without balances (the backend leaves points out for them).
  const showPoints = (members.data ?? []).some((m) => m.pointsBalance !== null);
  const locations = useMemo(() => [...new Set((members.data ?? []).map((m) => m.workLocation).filter(Boolean))].sort(), [members.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members.data ?? []).filter((m) =>
      (status === "all" || m.status === status) && (role === "all" || m.role === role) && (team === "all" || m.teamIds.includes(team)) &&
      (location === "all" || m.workLocation === location) && (!q || `${m.displayName} ${m.email} ${m.jobTitle} ${m.department}`.toLowerCase().includes(q)));
  }, [members.data, search, status, role, team, location]);
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
  const reset = (set: () => void) => { set(); setShown(PAGE); };

  return (
    <Shell title="Members" subtitle="Everyone at your company. Admins can open a person to edit their details." requires="members.view"
      action={<button className="pill-btn gray" disabled={!filtered.length} onClick={() => downloadText("members.csv", membersCsv(filtered, teams))}>Export CSV</button>}>
      {members.error ? <LoadError error={members.error} onRetry={members.reload} />
        : !members.data ? <Loading label="Loading members" />
        : (
          <>
            <div className="tabs" role="group" aria-label="Filter by status">
              {STATUSES.map((item) => (
                <button key={item.id} className="tab" aria-pressed={status === item.id} onClick={() => reset(() => setStatus(item.id))}>
                  {item.label} ({item.id === "all" ? members.data!.length : members.data!.filter((m) => m.status === item.id).length})
                </button>
              ))}
            </div>
            <div className="filters">
              <SearchBox value={search} onChange={(v) => reset(() => setSearch(v))} label="Search by name, email or title" />
              <div className="field"><label htmlFor="f-role">Role</label>
                <select id="f-role" value={role} onChange={(e) => reset(() => setRole(e.target.value as Role | "all"))}>
                  <option value="all">All roles</option>{(["admin", "organizer", "member"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select></div>
              <div className="field"><label htmlFor="f-team">Team</label>
                <select id="f-team" value={team} onChange={(e) => reset(() => setTeam(e.target.value))}>
                  <option value="all">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
              <div className="field"><label htmlFor="f-loc">Work location</label>
                <select id="f-loc" value={location} onChange={(e) => reset(() => setLocation(e.target.value))}>
                  <option value="all">All locations</option>{locations.map((l) => <option key={l}>{l}</option>)}
                </select></div>
            </div>
            {(search || role !== "all" || team !== "all" || location !== "all") && (
              <div className="actions"><button className="pill-btn gray small" onClick={() => reset(() => { setSearch(""); setRole("all"); setTeam("all"); setLocation("all"); })}>Clear filters</button></div>
            )}
            {filtered.length === 0 ? (
              <Empty title="No one matches" body="Clear a filter or search for a different name." />
            ) : (
              <>
                <p className="muted result-count" role="status">{filtered.length} {filtered.length === 1 ? "person" : "people"}</p>
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Company members</caption>
                    <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Teams</th><th scope="col">Work location</th><th scope="col">Status</th>{showPoints && <th scope="col" className="right">Points</th>}</tr></thead>
                    <tbody>
                      {filtered.slice(0, shown).map((m) => (
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
                {filtered.length > shown && <div className="actions"><button className="pill-btn gray" onClick={() => setShown((n) => n + PAGE)}>Show more ({filtered.length - shown} left)</button></div>}
              </>
            )}
          </>
        )}
    </Shell>
  );
}
