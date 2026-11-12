"use client";

import Link from "next/link";
import { type Capability, ROLE_LABEL, type Role, can } from "@/lib/adminTypes";
import { Avatar } from "./Ui";
import { useLoad } from "./useLoad";

/** What to ask an admin for, by the capability the page needs. */
const ASK: Partial<Record<Capability, string>> = {
  "themes.manage": "create or change a weekly theme",
  "challenges.review": "review weekly theme submissions",
  "members.edit": "change someone’s role, teams or location",
  "members.status": "deactivate or reactivate a member",
  "members.reset": "reset a participant’s profile",
  "points.adjust": "adjust someone’s points",
  "import.run": "import people from a spreadsheet",
  "roster.manage": "invite someone, resend an invite or revoke one",
  "audit.view": "look something up in the audit log",
  "bugreports.manage": "look at bug reports from the app",
};

/** Shown instead of an admin page to an organizer: explains the limit, says what to ask for and who can help. */
export function AdminOnly({ page, capability, role }: { page: string; capability: Capability; role: Role }) {
  // Organizers may read the member directory, so they can see who the admins are.
  const admins = useLoad((api) => api.listMembersPage({ query: "", status: "active", role: "admin", teamId: "all", workLocation: "all" }, null, 10), "admins");
  const list = admins.data?.members ?? [];
  const ask = ASK[capability];
  return (
    <div className="empty admin-only" role="alert">
      <h2>Admins only</h2>
      <p>{page} is for company admins. As {role === "organizer" ? "an" : "a"} {ROLE_LABEL[role].toLowerCase()} you can manage events, albums and attendees, and look people up in Members.</p>
      {ask && <p><strong>What to ask:</strong> “Can you {ask}?”</p>}
      {list.length > 0 && (
        <div className="admin-block">
          <p className="muted">Admins at your company</p>
          <ul className="admin-list">
            {list.map((a) => <li key={a.id}><Avatar name={a.displayName} /><span><strong>{a.displayName}</strong><br /><span className="muted">{a.email}</span></span></li>)}
          </ul>
        </div>
      )}
      <div className="actions">
        <Link className="pill-btn dark" href="/events/">Back to events</Link>
        {can(role, "members.view") && <Link className="pill-btn gray" href="/members/">Open members</Link>}
      </div>
    </div>
  );
}
