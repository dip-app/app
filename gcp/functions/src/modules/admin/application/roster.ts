import type {
  ListRosterResponse, ResendRosterInviteResponse, RevokeRosterEntryResponse, RosterCounts, RosterEntry, SendRosterInviteEmailResponse,
  UpsertRosterEntryResponse,
} from "../../../generated/models";
import { INVITE_OPT_OUTS_COLLECTION, SUPPRESSIONS_COLLECTION } from "../../email/domain/outbox";
import { rosterRecipientKey } from "../../email/domain/templates/types";
import { INVITE_EMAIL_GAP_MS, inviteMessage, matchesRoster, MAX_INVITE_EMAILS, MAX_RESENDS, toRosterEntry } from "../domain/rosterView";
import { companyEmailOn, queueEmailInTx } from "./accountEmails";
import { change } from "../domain/audit";
import { named } from "../domain/auditSummaries";
import { assertValid, emailHash, entryChanges, newEntryFields, normalizeEmployee, type EmployeeContext } from "../domain/employee";
import { AdminError, stored } from "../domain/errors";
import { paths, SERVER_TIME } from "../domain/ops";
import { parseListRoster, parseResendRoster, parseRevokeRoster, parseUpsertRoster } from "../domain/requests";
import { authorize, once, requireCaller, writeAudit, type Actor, consumeAfterAuth } from "./context";
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
  await consumeAfterAuth(deps, authenticated, req.companyId, "roster.manage");
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
          summary: `Invited ${record.email}`, summaryKey: "roster.invite", summaryParams: { email: record.email }, changes: [change("email", null, record.email), change("role", null, record.role ?? "member")], requestId: req.requestId });
        return { contractVersion: 1, entryId: id, created: true, status: "invited" } satisfies UpsertRosterEntryResponse;
      }
      const { patch, changes } = entryChanges(existing, record);
      if (changes.length === 0) {
        return { contractVersion: 1, entryId: id, created: false, status: existing.status === "claimed" ? "claimed" : "invited" } satisfies UpsertRosterEntryResponse;
      }
      const revision = typeof existing.revision === "number" ? existing.revision : 1;
      tx.update(paths.rosterEntry(actor.companyId, id), { ...patch, updatedAt: now, revision: revision + 1 });
      writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "roster.upsert", targetType: "roster", targetId: id,
        summary: `Updated roster entry ${record.email}`, summaryKey: "roster.update", summaryParams: { email: record.email }, changes, requestId: req.requestId });
      return { contractVersion: 1, entryId: id, created: false, status: "invited" } satisfies UpsertRosterEntryResponse;
    }, now);
  })).value;
}

/** revokeRosterEntryV1: only an invited entry can be revoked; claimed entries belong to a member now. */
export async function revokeRosterEntry(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<RevokeRosterEntryResponse> {
  const authenticated = requireCaller(caller);
  const req = parseRevokeRoster(data);
  await consumeAfterAuth(deps, authenticated, req.companyId, "roster.manage");
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
        summary: `Revoked the invitation for ${typeof entry.email === "string" ? entry.email : "a person"}`,
        summaryKey: "roster.revoke", summaryParams: named(entry.email, "email"), changes: [change("status", "invited", "revoked")], requestId: req.requestId });
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
  await consumeAfterAuth(deps, authenticated, req.companyId, "roster.manage");
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
        summary: `Resent the invite for ${email || "a person"} (#${sent + 1})`,
        summaryKey: "roster.resend", summaryParams: { ...named(email || undefined, "email"), number: sent + 1 }, changes: [change("resendCount", sent, sent + 1)], requestId: req.requestId });
      return { contractVersion: 1, entryId: req.entryId, status: "invited", resendCount: sent + 1, lastResentAt: now.toISOString(), signInUrl, message } satisfies ResendRosterInviteResponse;
    }, now);
  })).value;
}

/**
 * sendRosterInviteEmailV1: emails an invitation to an invited roster entry (docs/design/email-catalog.md, roster_invite):
 * the company name, the inviting admin's first name and the sign-in link for their role, in the admin's language. The
 * outbox entry is created in this transaction with the id `account_<entryId>_roster-<entryId>_invite<N>`, so a retried
 * or replayed request queues one email. Only `invited` entries, only while email is on for the company, never to an
 * address that opted out of invitations or bounced, at most MAX_INVITE_EMAILS per entry and INVITE_EMAIL_GAP_MS apart.
 * The address is the entry's own (validated against the company domain when it was added), never caller input.
 */
export async function sendRosterInviteEmail(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<SendRosterInviteEmailResponse> {
  const authenticated = requireCaller(caller);
  const req = parseResendRoster(data);
  await consumeAfterAuth(deps, authenticated, req.companyId, "roster.manage");
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "roster.manage");
    return once(tx, actor, "sendRosterInviteEmailV1", req.requestId, { entryId: req.entryId }, async () => {
      const entry = await tx.get(paths.rosterEntry(actor.companyId, req.entryId));
      if (!entry || entry.companyId !== actor.companyId) throw new AdminError("not-found", "ROSTER_ENTRY_NOT_FOUND", "Roster entry not found.");
      if (entry.status === "claimed") throw new AdminError("failed-precondition", "ROSTER_ENTRY_CLAIMED", "This person already signed in.");
      if (entry.status !== "invited") throw new AdminError("failed-precondition", "ROSTER_ENTRY_NOT_INVITED", "Invite this person again before resending.");
      const email = typeof entry.email === "string" ? entry.email : "";
      stored(email !== "" && emailHash(email) === req.entryId, "roster entry");
      if (!(await companyEmailOn(tx, deps, actor.companyId))) {
        throw new AdminError("failed-precondition", "EMAIL_NOT_ENABLED", "Email isn't turned on for your company yet. Copy the invite message instead.");
      }
      if (await tx.get(`${INVITE_OPT_OUTS_COLLECTION}/${req.entryId}`)) {
        throw new AdminError("failed-precondition", "INVITE_EMAIL_OPTED_OUT", "This person asked not to get invitation emails. Reach out to them directly.");
      }
      if (await tx.get(`${SUPPRESSIONS_COLLECTION}/${req.entryId}`)) {
        throw new AdminError("failed-precondition", "INVITE_EMAIL_UNDELIVERABLE", "Email to this address can't be delivered. Check the address or reach out to them directly.");
      }
      const sent = typeof entry.inviteEmailCount === "number" && entry.inviteEmailCount >= 0 ? entry.inviteEmailCount : 0;
      if (sent >= MAX_INVITE_EMAILS) throw new AdminError("resource-exhausted", "INVITE_EMAIL_LIMIT", "This person already got several invitation emails. Reach out to them directly.");
      const last = entry.lastInviteEmailAt instanceof Date ? entry.lastInviteEmailAt.getTime() : null;
      if (last !== null && now.getTime() - last < INVITE_EMAIL_GAP_MS) {
        throw new AdminError("resource-exhausted", "INVITE_EMAIL_TOO_SOON", "An invitation email went out less than an hour ago. Try again later.");
      }
      const company = await tx.get(paths.company(actor.companyId));
      const companyName = typeof company?.name === "string" && company.name.trim() !== "" ? company.name.trim().slice(0, 120) : "";
      stored(companyName !== "", "company");
      const inviter = actor.name.trim().split(/\s+/)[0]?.slice(0, 80) ?? "";
      const role = entry.role === "admin" || entry.role === "organizer" ? entry.role : "member";
      await queueEmailInTx(tx, {
        template: "roster_invite",
        variables: { entryId: req.entryId, companyName, role, reminder: sent > 0, ...(inviter ? { inviterFirstName: inviter } : {}) },
        uid: rosterRecipientKey(req.entryId), companyId: actor.companyId, objectId: req.entryId, revisionOrWindow: `invite${sent + 1}`,
        notAfter: new Date(now.getTime() + INVITE_EMAIL_TTL_MS), ...(actor.locale ? { locale: actor.locale } : {}),
      }, now);
      const revision = typeof entry.revision === "number" ? entry.revision : 1;
      tx.update(paths.rosterEntry(actor.companyId, req.entryId), {
        inviteEmailCount: sent + 1, lastInviteEmailAt: now, lastInviteEmailBy: actor.uid, updatedAt: now, revision: revision + 1,
      });
      writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "roster.inviteEmail", targetType: "roster", targetId: req.entryId,
        summary: `Emailed an invite to ${email} (#${sent + 1})`,
        summaryKey: "roster.inviteEmail", summaryParams: { ...named(email, "email"), number: sent + 1 }, changes: [change("inviteEmailCount", sent, sent + 1)], requestId: req.requestId });
      return { contractVersion: 1, entryId: req.entryId, status: "invited", inviteEmailCount: sent + 1, lastInviteEmailAt: now.toISOString() } satisfies SendRosterInviteEmailResponse;
    }, now);
  })).value;
}

/** An unsent invitation is useless after a week (the admin can send another). */
const INVITE_EMAIL_TTL_MS = 7 * 86_400_000;

const SCAN_BATCH = 250;
const MAX_SCAN = 500;

/**
 * Claimed entries carry their member's stored photo and avatar id so the portal draws the same avatar as the member list. One batched
 * read of at most a page of users documents; a user outside the caller's company (or a missing one) adds nothing.
 */
async function attachMemberProfiles(tx: AdminTransaction, companyId: string, entries: RosterEntry[]): Promise<void> {
  const claimed = entries.filter(e => e.status === "claimed" && e.claimedBy);
  if (claimed.length === 0) return;
  const users = await tx.getMany(claimed.map(e => paths.user(e.claimedBy as string)));
  claimed.forEach((entry, i) => {
    const user = users[i];
    if (!user || user.companyId !== companyId) return;
    if (typeof user.photoURL === "string" && user.photoURL) entry.memberPhotoURL = user.photoURL.slice(0, 2048);
    if (typeof user.avatarId === "string" && user.avatarId) entry.memberAvatarId = user.avatarId.slice(0, 120);
  });
}

/**
 * listRosterV1: a page of the roster. Scans entries in id order (bounded per call), filters by state and search text in memory and
 * returns the id cursor, so any roster size pages without a composite index. The first page also carries exact counts per state.
 */
export async function listRoster(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ListRosterResponse> {
  const authenticated = requireCaller(caller);
  const req = parseListRoster(data);
  await consumeAfterAuth(deps, authenticated, req.companyId, "roster.manage");
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
    await attachMemberProfiles(tx, actor.companyId, entries);
    let counts: RosterCounts | undefined;
    if (!req.pageToken) {
      const [all, invited, revoked, claimed, deactivated] = await Promise.all([
        tx.count(collection), tx.count(collection, [["status", "invited"]]), tx.count(collection, [["status", "revoked"]]),
        tx.count(collection, [["status", "claimed"]]), tx.count(collection, [["status", "claimed"], ["memberStatus", "deactivated"]]),
      ]);
      counts = { all, invited, revoked, deactivated, active: Math.max(0, claimed - deactivated) };
    }
    const inviteEmail = await companyEmailOn(tx, deps, actor.companyId);
    return { contractVersion: 1, entries, ...(nextPageToken ? { nextPageToken } : {}), ...(counts ? { counts } : {}), inviteEmail } satisfies ListRosterResponse;
  });
}

export type { Doc };
