import type { RevokeRosterEntryResponse, UpsertRosterEntryResponse } from "../../../generated/models";
import { change } from "../domain/audit";
import { assertValid, emailHash, entryChanges, newEntryFields, normalizeEmployee, type EmployeeContext } from "../domain/employee";
import { AdminError, stored } from "../domain/errors";
import { paths, SERVER_TIME } from "../domain/ops";
import { parseRevokeRoster, parseUpsertRoster } from "../domain/requests";
import { authorize, once, requireCaller, writeAudit, type Actor } from "./context";
import type { AdminDeps, AdminTransaction, Caller, Doc, Entry } from "./ports";

/** The company's email domain and active team catalog: the context every employee record is validated against. */
export async function loadEmployeeContext(tx: AdminTransaction, actor: Actor): Promise<EmployeeContext> {
  const company = await tx.get(paths.company(actor.companyId));
  if (!company) throw new AdminError("not-found", "COMPANY_NOT_FOUND", "Company not found.");
  stored(typeof company.emailDomain === "string" && company.emailDomain !== "", "company");
  const teams = await tx.list(paths.teams(actor.companyId), { limit: 500 });
  return {
    companyDomain: (company.emailDomain as string).toLowerCase(),
    teams: teams.map(t => ({ id: t.id, name: typeof t.data.name === "string" ? t.data.name : "", archived: t.data.archived === true })),
  };
}

/** The existing member of the company with this email, if any. */
export async function findMemberByEmail(tx: AdminTransaction, actor: Actor, email: string): Promise<Entry | null> {
  const found = await tx.list("users", { where: [["companyId", actor.companyId], ["email", email]], limit: 1 });
  return found[0] ?? null;
}

/** upsertRosterEntryV1: pre-provision one person who has not signed in. A member's email is refused. */
export async function upsertRosterEntry(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<UpsertRosterEntryResponse> {
  const authenticated = requireCaller(caller);
  const req = parseUpsertRoster(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "roster.manage");
    return once(tx, actor, "upsertRosterEntryV1", req.requestId, { entry: req.entry }, async () => {
      const ctx = await loadEmployeeContext(tx, actor);
      const { record, issues } = normalizeEmployee(req.entry, ctx);
      assertValid(issues, "entry.");
      if (await findMemberByEmail(tx, actor, record.email)) {
        throw new AdminError("failed-precondition", "EMAIL_ALREADY_MEMBER", "This person already has an account. Edit them as a member.", ["entry.email"]);
      }
      const id = emailHash(record.email);
      const existing = await tx.get(paths.rosterEntry(actor.companyId, id));
      if (!existing) {
        tx.create(paths.rosterEntry(actor.companyId, id), {
          companyId: actor.companyId, ...newEntryFields(record), status: "invited", source: "manual", invitedBy: actor.uid,
          createdAt: SERVER_TIME, updatedAt: SERVER_TIME, revision: 1,
        });
        writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "roster.upsert", targetType: "roster", targetId: id,
          summary: `Invited ${record.email}`, changes: [change("email", null, record.email), change("role", null, record.role ?? "member")], requestId: req.requestId });
        return { contractVersion: 1, entryId: id, created: true, status: "invited" } satisfies UpsertRosterEntryResponse;
      }
      const { patch, changes } = entryChanges(existing, record);
      if (changes.length === 0) {
        return { contractVersion: 1, entryId: id, created: false, status: existing.status === "claimed" ? "claimed" : "invited" } satisfies UpsertRosterEntryResponse;
      }
      const revision = typeof existing.revision === "number" ? existing.revision : 1;
      tx.update(paths.rosterEntry(actor.companyId, id), { ...patch, updatedAt: now, revision: revision + 1 });
      writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "roster.upsert", targetType: "roster", targetId: id,
        summary: `Updated roster entry ${record.email}`, changes, requestId: req.requestId });
      return { contractVersion: 1, entryId: id, created: false, status: "invited" } satisfies UpsertRosterEntryResponse;
    }, now);
  })).value;
}

/** revokeRosterEntryV1: only an invited entry can be revoked; claimed entries belong to a member now. */
export async function revokeRosterEntry(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<RevokeRosterEntryResponse> {
  const authenticated = requireCaller(caller);
  const req = parseRevokeRoster(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "roster.manage");
    return once(tx, actor, "revokeRosterEntryV1", req.requestId, { entryId: req.entryId }, async () => {
      const entry = await tx.get(paths.rosterEntry(actor.companyId, req.entryId));
      if (!entry || entry.companyId !== actor.companyId) throw new AdminError("not-found", "ROSTER_ENTRY_NOT_FOUND", "Roster entry not found.");
      const status = entry.status === "claimed" ? "claimed" : entry.status === "revoked" ? "revoked" : "invited";
      if (status !== "invited") return { contractVersion: 1, entryId: req.entryId, status, changed: false } satisfies RevokeRosterEntryResponse;
      const revision = typeof entry.revision === "number" ? entry.revision : 1;
      tx.update(paths.rosterEntry(actor.companyId, req.entryId), { status: "revoked", updatedAt: now, revision: revision + 1 });
      writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "roster.revoke", targetType: "roster", targetId: req.entryId,
        summary: `Revoked the invitation for ${typeof entry.email === "string" ? entry.email : "a person"}`, changes: [change("status", "invited", "revoked")], requestId: req.requestId });
      return { contractVersion: 1, entryId: req.entryId, status: "revoked", changed: true } satisfies RevokeRosterEntryResponse;
    }, now);
  })).value;
}

export type { Doc };
