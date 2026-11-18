"use client";
// @i18n-migrated

import { type Capability, type Role, can } from "@/lib/adminTypes";
import { t as tAi } from "@/lib/aiStrings";
import { hasMessage, t } from "@/lib/i18n";
import { Avatar } from "./Ui";
import { useLoad } from "./useLoad";
import { Button } from "@/components/kit";

/** What to ask an admin for, by the capability the page needs (a catalog key under shell.ask.*). */
function askFor(capability: Capability): string | null {
  if (capability === "ai.generate") return tAi("access.capability");
  const key = `shell.ask.${capability}`;
  return hasMessage(key) ? t(key) : null;
}

/** Shown instead of an admin page to an organizer: explains the limit, says what to ask for and who can help. */
export function AdminOnly({ page, capability, role }: { page: string; capability: Capability; role: Role }) {
  // Organizers may read the member directory, so they can see who the admins are.
  const admins = useLoad((api) => api.listMembersPage({ query: "", status: "active", role: "admin", teamId: "all", workLocation: "all" }, null, 10), "admins");
  const list = admins.data?.members ?? [];
  const ask = askFor(capability);
  return (
    <div className="empty admin-only">
      <h2>{t("shell.adminOnly.title")}</h2>
      <p>{t("shell.adminOnly.body", { page, role })}</p>
      {ask && <p><strong>{t("shell.adminOnly.askLabel")}</strong> {t("shell.adminOnly.ask", { ask })}</p>}
      {list.length > 0 && (
        <div className="admin-block">
          <p className="muted">{t("shell.adminOnly.admins")}</p>
          <ul className="admin-list">
            {list.map((a) => <li key={a.id}><Avatar name={a.displayName} userId={a.id} photoURL={a.photoURL} avatarId={a.avatarId} /><span><strong>{a.displayName}</strong><br /><span className="muted">{a.email}</span></span></li>)}
          </ul>
        </div>
      )}
      <div className="actions">
        <Button variant="primary" href="/events/">{t("shell.adminOnly.backToEvents")}</Button>
        {can(role, "members.view") && <Button href="/members/">{t("shell.adminOnly.openMembers")}</Button>}
      </div>
    </div>
  );
}
