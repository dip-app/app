"use client";
// @i18n-migrated

import { useId, useState } from "react";
import type { AdminOpsApi } from "@/lib/adminApi";
import { ROLE_LABEL, type ImportRow, type Role } from "@/lib/adminTypes";
import { validateRow } from "@/lib/importFile";
import { applyAll, planAll } from "@/lib/importRun";
import { t } from "@/lib/i18n";
import { Dialog } from "./Dialog";
import { Toggle } from "./Toggle";

const ROLES: Role[] = ["member", "organizer", "admin"];

/**
 * Adds one person to the roster as Invited. It is the bulk import's dry run and apply for a single row (same callables,
 * same validation and domain rule), so nothing new runs on the server. A row the dry run would update or leave
 * unchanged is not applied: adding someone must never silently change an existing person's role.
 */
export function AddPersonDialog({ api, domain, inviteEmail = false, onAdded, onClose }: {
  api: Pick<AdminOpsApi, "planImport" | "applyImportStep">;
  domain: string;
  /** True when DIP can email invitations for this company: the dialog offers to email the new person right away (on by default). */
  inviteEmail?: boolean;
  /** `emailNow` is true when the admin left "Email them an invitation now" on. */
  onAdded: (name: string, email: string, emailNow: boolean) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [emailNow, setEmailNow] = useState(true);

  async function add() {
    const row: ImportRow = { email: email.trim().toLowerCase(), displayName: name.trim(), role, teams: [], department: "", jobTitle: "", workLocation: "" };
    const found: { name?: string; email?: string } = {};
    if (!row.displayName) found.name = t("roster.add.nameRequired");
    const local = validateRow(row, domain);
    if (local.length) found.email = local.join(" ");
    setErrors(found);
    if (found.name || found.email) throw new Error(t("roster.add.checkDetails"));
    const plan = await planAll(api, { rows: [row], lines: [2], localErrors: new Map(), unknownColumns: [] }, crypto.randomUUID(), "add-person");
    const planned = plan.rows[0];
    if (!planned || planned.action === "invalid") {
      setErrors({ email: planned?.errors.join(" ") || t("roster.add.checkDetails") });
      throw new Error(t("roster.add.checkDetails"));
    }
    if (planned.action !== "create") throw new Error(t("roster.add.exists"));
    await applyAll(api, plan.jobId, plan.planHash, () => undefined);
    onAdded(row.displayName, row.email, inviteEmail && emailNow);
  }

  // The domain hint shows until there is an email error (which then says the same thing, or more).
  const field = (key: "name" | "email") => (errors[key] ? { "aria-invalid": true as const, "aria-describedby": `${uid}-${key}-error` } : key === "email" && domain ? { "aria-describedby": `${uid}-email-hint` } : {});
  return (
    <Dialog title={t("roster.add.title")} confirmLabel={t(inviteEmail && emailNow ? "roster.add.confirmEmail" : "roster.add.confirm")} busyLabel={t("roster.add.busy")} onConfirm={add} onClose={onClose}>
      <p>{t(inviteEmail ? "roster.add.introEmail" : "roster.add.intro")}</p>
      <div className="field">
        <label htmlFor={`${uid}-name`}>{t("roster.add.name")}</label>
        <input id={`${uid}-name`} autoComplete="off" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} {...field("name")} />
        {errors.name && <span className="error" id={`${uid}-name-error`}>{errors.name}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-email`}>{t("roster.add.email")}</label>
        <input id={`${uid}-email`} type="email" autoComplete="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} {...field("email")} />
        {domain && !errors.email && <span className="hint" id={`${uid}-email-hint`}>{t("roster.add.emailHint", { domain })}</span>}
        {errors.email && <span className="error" id={`${uid}-email-error`}>{errors.email}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-role`}>{t("roster.add.role")}</label>
        <select id={`${uid}-role`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </div>
      {inviteEmail && <Toggle checked={emailNow} onChange={setEmailNow} label={t("roster.add.sendEmail")} />}
    </Dialog>
  );
}
