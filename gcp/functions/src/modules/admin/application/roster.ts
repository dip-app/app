import type {
  ListRosterResponse, ResendRosterInviteResponse, RevokeRosterEntryResponse, RosterCounts, RosterEntry, UpsertRosterEntryResponse,
} from "../../../generated/models";
import { inviteMessage, matchesRoster, MAX_RESENDS, toRosterEntry } from "../domain/rosterView";
import { change } from "../domain/audit";
import { assertValid, emailHash, entryChanges, newEntryFields, normalizeEmployee, type EmployeeContext } from "../domain/employee";
import { AdminError, stored } from "../domain/errors";
import { paths, SERVER_TIME } from "../domain/ops";
import { parseListRoster, parseResendRoster, parseRevokeRoster, parseUpsertRoster } from "../domain/requests";
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

/**
 * resendRosterInviteV1: DIP sends no email, so "resend" records the event on the invited entry (count, time, admin) and returns the
 * sign-in link plus a ready message for the admin to share. Only invited entries; at most MAX_RESENDS per entry; idempotent per requestId.
 */
export async function resendRosterInvite(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ResendRosterInviteResponse> {
  const authenticated = requireCaller(caller);
  const req = parseResendRoster(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "roster.manage");
    return once(tx, actor, "resendRosterInviteV1", req.requestId, { entryId: req.entryId }, async () => {
      const entry = await tx.get(paths.rosterEntry(actor.companyId, req.entryId));
      if (!entry || entry.companyId !== actor.companyId) throw new AdminError("not-found", "ROSTER_ENTRY_NOT_FOUND", "Roster entry not found.");
      if (entry.status === "claimed") throw new AdminError("failed-precondition", "ROSTER_ENTRY_CLAIMED", "This person already signed in.");
      if (entry.status !== "invited") throw new AdminError("failed-precondition", "ROSTER_ENTRY_NOT_INVITED", "Invite this person again before resending.");
      const sent = typeof entry.resendCount === "number" && entry.resendCount >= 0 ? entry.resendCount : 0;
      if (sent >= MAX_RESENDS) throw new AdminError("resource-exhausted", "RESEND_LIMIT", "This invite was already resent several times. Reach out to the person directly.");
      const company = await tx.get(paths.company(actor.companyId));
      const email = typeof entry.email === "string" ? entry.email : "";
      const { signInUrl, message } = inviteMessage({
        name: typeof entry.displayName === "string" ? entry.displayName : "", company: typeof company?.name === "string" ? company.name : "", email, role: String(entry.role ?? "member"),
      });
      const revision = typeof entry.revision === "number" ? entry.revision : 1;
      tx.update(paths.rosterEntry(actor.companyId, req.entryId), { resendCount: sent + 1, lastResentAt: now, lastResentBy: actor.uid, updatedAt: now, revision: revision + 1 });
      writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "roster.resend", targetType: "roster", targetId: req.entryId,
        summary: `Resent the invite for ${email || "a person"} (#${sent + 1})`, changes: [change("resendCount", sent, sent + 1)], requestId: req.requestId });
      return { contractVersion: 1, entryId: req.entryId, status: "invited", resendCount: sent + 1, lastResentAt: now.toISOString(), signInUrl, message } satisfies ResendRosterInviteResponse;
    }, now);
  })).value;
}

const SCAN_BATCH = 250;
const MAX_SCAN = 1000;

/**
 * listRosterV1: a page of the roster. Scans entries in id order (bounded per call), filters by state and search text in memory and
 * returns the id cursor, so any roster size pages without a composite index. The first page also carries exact counts per state.
 */
export async function listRoster(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ListRosterResponse> {
  const authenticated = requireCaller(caller);
  const req = parseListRoster(data);
  await deps.limiter?.consume(authenticated.uid);
  return deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "roster.manage");
    const collection = paths.roster(actor.companyId);
    const entries: RosterEntry[] = [];
    let scanned = 0;
    let afterId = req.pageToken;
    let exhausted = false;
    scan: while (true) {
      const batch = await tx.list(collection, { limit: SCAN_BATCH, ...(afterId ? { afterId } : {}) });
      for (const item of batch) {
        scanned += 1;
        afterId = item.id;
        const entry = toRosterEntry(item.id, item.data);
        if (matchesRoster(entry, req)) entries.push(entry);
        if (entries.length >= req.pageSize || scanned >= MAX_SCAN) break scan;
      }
      if (batch.length < SCAN_BATCH) { exhausted = true; break; }
    }
    const nextPageToken = exhausted ? undefined : afterId;
    let counts: RosterCounts | undefined;
    if (!req.pageToken) {
      const [all, invited, revoked, claimed, deactivated] = await Promise.all([
        tx.count(collection), tx.count(collection, [["status", "invited"]]), tx.count(collection, [["status", "revoked"]]),
        tx.count(collection, [["status", "claimed"]]), tx.count(collection, [["status", "claimed"], ["memberStatus", "deactivated"]]),
      ]);
      counts = { all, invited, revoked, deactivated, active: Math.max(0, claimed - deactivated) };
    }
    return { contractVersion: 1, entries, ...(nextPageToken ? { nextPageToken } : {}), ...(counts ? { counts } : {}) } satisfies ListRosterResponse;
  });
}

export type { Doc };
