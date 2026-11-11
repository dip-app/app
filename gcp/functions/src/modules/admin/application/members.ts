import type {
  AdjustMemberPointsResponse, GetMemberResponse, ListMembersResponse, ResetMemberProfileResponse, SetMemberStatusResponse,
  UpdateCompanySettingsResponse, UpdateMemberResponse, UpsertTeamResponse,
} from "../../../generated/models";
import { change, diffFields } from "../domain/audit";
import { AdminError, stored } from "../domain/errors";
import { hasOtherActiveAdmin, matchesFilter, resetPatch, revisionOf, statusOf, toSummary, type MemberSummary } from "../domain/member";
import { paths, SERVER_TIME, increment } from "../domain/ops";
import {
  parseAdjustPoints, parseCompanySettings, parseGetMember, parseListMembers, parseResetProfile, parseSetStatus, parseUpdateMember, parseUpsertTeam,
} from "../domain/requests";
import { cancelAttendance } from "./attendees";
import { authorize, loadMember, once, requireCaller, writeAudit, type Actor } from "./context";
import type { AdminDeps, AdminTransaction, Caller, Doc } from "./ports";

const SCAN_BATCH = 250;
const MAX_SCAN = 1000;
const MAX_RSVP_CLEANUP = 200;

/** Active admins other than `exceptUid` (the last-admin guard). Reads the admin role index, never the whole company. */
async function otherActiveAdminExists(tx: AdminTransaction, actor: Actor, exceptUid: string): Promise<boolean> {
  const admins = await tx.list("users", { where: [["companyId", actor.companyId], ["role", "admin"]], limit: 50 });
  return hasOtherActiveAdmin(admins, exceptUid);
}

/** Directory page: scans members in id order (bounded), filters in memory, returns an id cursor. */
export async function listMembers(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ListMembersResponse> {
  const authenticated = requireCaller(caller);
  const req = parseListMembers(data);
  await deps.limiter?.consume(authenticated.uid);
  return deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "member.read");
    const includePoints = actor.role === "admin";
    const members: MemberSummary[] = [];
    let scanned = 0;
    let afterId = req.pageToken;
    let exhausted = false;
    scan: while (true) {
      const batch = await tx.list("users", { where: [["companyId", actor.companyId]], limit: SCAN_BATCH, ...(afterId ? { afterId } : {}) });
      for (const entry of batch) {
        scanned += 1;
        afterId = entry.id;
        const summary = toSummary(entry.id, entry.data, includePoints);
        if (matchesFilter(summary, req)) members.push(summary);
        if (members.length >= req.pageSize || scanned >= MAX_SCAN) break scan;
      }
      if (batch.length < SCAN_BATCH) { exhausted = true; break; }
    }
    const nextPageToken = exhausted ? undefined : afterId;
    return { contractVersion: 1, members, ...(nextPageToken ? { nextPageToken } : {}) } satisfies ListMembersResponse;
  });
}

export async function getMember(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<GetMemberResponse> {
  const authenticated = requireCaller(caller);
  const req = parseGetMember(data);
  await deps.limiter?.consume(authenticated.uid);
  return deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "member.read");
    const member = await loadMember(tx, actor, req.userId);
    return { contractVersion: 1, member: toSummary(req.userId, member, actor.role === "admin") } satisfies GetMemberResponse;
  });
}

/**
 * updateMemberV1: role, teams and org attributes. Admin only. Never touches displayName, email, points or auth ids.
 * Teams must exist and be active; the last active admin cannot be demoted; expectedRevision guards lost updates.
 */
export async function updateMember(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<UpdateMemberResponse> {
  const authenticated = requireCaller(caller);
  const req = parseUpdateMember(data);
  await deps.limiter?.consume(authenticated.uid);
  const { userId } = req;
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "member.manage");
    const payload = { ...req, companyId: undefined, requestId: undefined };
    return once(tx, actor, "updateMemberV1", req.requestId, payload, async () => {
      const member = await loadMember(tx, actor, userId);
      const revision = revisionOf(member);
      if (req.expectedRevision !== undefined && req.expectedRevision !== revision) {
        throw new AdminError("aborted", "REVISION_CONFLICT", "Someone else changed this member. Reload and try again.");
      }
      if (req.teamIds) {
        for (const teamId of req.teamIds) {
          const team = await tx.get(paths.team(actor.companyId, teamId));
          if (!team || team.archived === true) throw new AdminError("invalid-argument", "TEAM_NOT_FOUND", "Choose teams from the catalog.", ["teamIds"]);
        }
      }
      const wanted: Doc = {
        role: req.role, teamIds: req.teamIds, workLocation: req.workLocation, department: req.department, jobTitle: req.jobTitle,
        managerEmail: req.managerEmail, startDate: req.startDate,
      };
      const changes = diffFields({ ...member, teamIds: Array.isArray(member.teamIds) ? member.teamIds : [] }, wanted);
      if (changes.length === 0) return { contractVersion: 1, userId, revision, changedFields: [] } satisfies UpdateMemberResponse;
      if (member.role === "admin" && req.role !== undefined && req.role !== "admin" && !(await otherActiveAdminExists(tx, actor, userId))) {
        throw new AdminError("failed-precondition", "LAST_ADMIN", "A company needs at least one admin.");
      }
      const patch: Doc = {};
      for (const c of changes) patch[c.field] = wanted[c.field];
      const nextRevision = revision + 1;
      tx.update(paths.user(userId), { ...patch, revision: nextRevision });
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "member.update", targetType: "member", targetId: userId,
        summary: `Updated ${typeof member.displayName === "string" ? member.displayName : "a member"}: ${changes.map(c => c.field).join(", ")}`,
        changes, requestId: req.requestId,
      });
      return { contractVersion: 1, userId, revision: nextRevision, changedFields: changes.map(c => c.field) } satisfies UpdateMemberResponse;
    }, deps.now());
  })).value;
}

/** resetMemberProfileV1: clears self-set profile data; identity, role, org attributes, status, friends and points stay. */
export async function resetMemberProfile(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ResetMemberProfileResponse> {
  const authenticated = requireCaller(caller);
  const req = parseResetProfile(data);
  await deps.limiter?.consume(authenticated.uid);
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "member.manage");
    return once(tx, actor, "resetMemberProfileV1", req.requestId, { userId: req.userId, reason: req.reason ?? null }, async () => {
      const member = await loadMember(tx, actor, req.userId);
      const patch = resetPatch(member);
      const revision = revisionOf(member);
      const fields = Object.keys(patch);
      if (fields.length === 0) return { contractVersion: 1, userId: req.userId, resetFields: [], revision } satisfies ResetMemberProfileResponse;
      const nextRevision = revision + 1;
      tx.update(paths.user(req.userId), { ...patch, revision: nextRevision });
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "member.reset", targetType: "member", targetId: req.userId,
        summary: `Reset the profile of ${typeof member.displayName === "string" ? member.displayName : "a member"}`,
        changes: fields.map(f => change(f, Array.isArray(member[f]) ? `${(member[f] as unknown[]).length} items` : member[f], Array.isArray(patch[f]) ? "0 items" : patch[f])),
        reason: req.reason, requestId: req.requestId,
      });
      return { contractVersion: 1, userId: req.userId, resetFields: fields, revision: nextRevision } satisfies ResetMemberProfileResponse;
    }, deps.now());
  })).value;
}

/**
 * setMemberStatusV1: deactivate or reactivate. Deactivation (never self, never the last active admin) revokes the member's
 * sessions and cancels their upcoming going RSVPs; rules, resolveMembershipV1 and the callables refuse deactivated accounts.
 * The cleanup after the transaction also runs on a replay, so an interrupted run converges.
 */
export async function setMemberStatus(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<SetMemberStatusResponse> {
  const authenticated = requireCaller(caller);
  const req = parseSetStatus(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  let actorRef: Actor | undefined;
  const result = (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "member.manage");
    actorRef = actor;
    return once(tx, actor, "setMemberStatusV1", req.requestId, { userId: req.userId, status: req.status, reason: req.reason ?? null }, async () => {
      const member = await loadMember(tx, actor, req.userId);
      const revision = revisionOf(member);
      const current = statusOf(member) === "deactivated" ? "deactivated" : "active";
      if (current === req.status) {
        return { contractVersion: 1, userId: req.userId, status: req.status, changed: false, rsvpsCancelled: 0, revision } satisfies SetMemberStatusResponse;
      }
      if (req.status === "deactivated") {
        if (req.userId === actor.uid) throw new AdminError("failed-precondition", "CANNOT_DEACTIVATE_SELF", "You can't deactivate your own account.");
        if (member.role === "admin" && !(await otherActiveAdminExists(tx, actor, req.userId))) {
          throw new AdminError("failed-precondition", "LAST_ADMIN", "A company needs at least one active admin.");
        }
      }
      const nextRevision = revision + 1;
      tx.update(paths.user(req.userId), { status: req.status, statusUpdatedAt: SERVER_TIME, revision: nextRevision });
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "member.status", targetType: "member", targetId: req.userId,
        summary: `${req.status === "deactivated" ? "Deactivated" : "Reactivated"} ${typeof member.displayName === "string" ? member.displayName : "a member"}`,
        changes: [change("status", current, req.status)], reason: req.reason, requestId: req.requestId,
      });
      return { contractVersion: 1, userId: req.userId, status: req.status, changed: true, rsvpsCancelled: 0, revision: nextRevision } satisfies SetMemberStatusResponse;
    }, now);
  })).value;
  if (req.status !== "deactivated" || !actorRef) return result;
  const actor = actorRef;
  // Convergent cleanup: end sessions, then free the seats of upcoming events (each in its own transaction).
  await deps.sessions.revoke(req.userId).catch(() => undefined);
  const upcoming = await deps.store.queryGroup("rsvps", {
    where: [["companyId", "==", actor.companyId], ["userId", "==", req.userId], ["status", "==", "going"], ["eventStartTime", ">", now]],
    orderBy: "eventStartTime", limit: MAX_RSVP_CLEANUP,
  });
  let cancelled = 0;
  for (const rsvp of upcoming) {
    const eventId = rsvp.path.split("/")[3];
    if (!eventId) continue;
    const done = await deps.store.runTransaction(tx => cancelAttendance(tx, actor, eventId, req.userId, {
      now, notify: false, auditId: `${actor.uid}_${req.requestId}_${eventId}`, requestId: req.requestId, reason: "Member deactivated", notificationId: "",
    })).catch(() => ({ removed: false }));
    if (done.removed) cancelled += 1;
  }
  return { ...result, rsvpsCancelled: result.rsvpsCancelled + cancelled };
}

/** adjustMemberPointsV1: appends an admin_adjustment ledger entry and updates the balance in one transaction. */
export async function adjustMemberPoints(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<AdjustMemberPointsResponse> {
  const authenticated = requireCaller(caller);
  const req = parseAdjustPoints(data);
  await deps.limiter?.consume(authenticated.uid);
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "member.manage");
    return once(tx, actor, "adjustMemberPointsV1", req.requestId, { userId: req.userId, delta: req.delta, reason: req.reason }, async () => {
      const member = await loadMember(tx, actor, req.userId);
      stored(typeof member.pointsBalance === "number" && Number.isSafeInteger(member.pointsBalance) && member.pointsBalance >= 0, "balance");
      const balance = member.pointsBalance as number;
      const pointsBalance = balance + req.delta;
      if (pointsBalance < 0) throw new AdminError("failed-precondition", "INSUFFICIENT_POINTS", "The balance can't go below zero.");
      tx.create(paths.pointTransaction(actor.companyId, `adjust_${actor.uid}_${req.requestId}`), {
        companyId: actor.companyId, userId: req.userId, amount: req.delta, reason: `admin_adjustment: ${req.reason}`.slice(0, 220), sourceId: actor.uid, createdAt: SERVER_TIME,
      });
      tx.update(paths.user(req.userId), { pointsBalance: increment(req.delta) });
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "points.adjust", targetType: "points", targetId: req.userId,
        summary: `Adjusted points by ${req.delta > 0 ? "+" : ""}${req.delta}`, changes: [change("pointsBalance", balance, pointsBalance)],
        reason: req.reason, requestId: req.requestId,
      });
      return { contractVersion: 1, userId: req.userId, pointsBalance, applied: true } satisfies AdjustMemberPointsResponse;
    }, deps.now());
  })).value;
}

/** upsertTeamV1: create (no teamId) or rename/archive a team. Names are unique case-insensitively per company. */
export async function upsertTeam(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<UpsertTeamResponse> {
  const authenticated = requireCaller(caller);
  const req = parseUpsertTeam(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "team.manage");
    const payload = { teamId: req.teamId ?? null, name: req.name, archived: req.archived ?? null };
    return once(tx, actor, "upsertTeamV1", req.requestId, payload, async () => {
      const teams = await tx.list(paths.teams(actor.companyId), { limit: 500 });
      if (teams.some(t => t.id !== req.teamId && typeof t.data.name === "string" && t.data.name.toLowerCase() === req.name.toLowerCase())) {
        throw new AdminError("failed-precondition", "TEAM_NAME_TAKEN", "A team with this name already exists.", ["name"]);
      }
      const existing = req.teamId ? teams.find(t => t.id === req.teamId) : undefined;
      if (req.teamId && !existing) throw new AdminError("not-found", "TEAM_NOT_FOUND", "Team not found.");
      if (!existing) {
        const teamId = deps.newId();
        tx.create(paths.team(actor.companyId, teamId), {
          companyId: actor.companyId, name: req.name, archived: req.archived ?? false, createdAt: SERVER_TIME, updatedAt: SERVER_TIME, revision: 1,
        });
        writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "team.upsert", targetType: "team", targetId: teamId,
          summary: `Created team ${req.name}`, changes: [change("name", null, req.name)], requestId: req.requestId });
        return { contractVersion: 1, teamId, created: true, revision: 1 } satisfies UpsertTeamResponse;
      }
      const revision = typeof existing.data.revision === "number" ? existing.data.revision : 1;
      const changes = diffFields(existing.data, { name: req.name, archived: req.archived });
      if (changes.length === 0) return { contractVersion: 1, teamId: existing.id, created: false, revision } satisfies UpsertTeamResponse;
      tx.update(paths.team(actor.companyId, existing.id), { name: req.name, ...(req.archived !== undefined ? { archived: req.archived } : {}), updatedAt: now, revision: revision + 1 });
      writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "team.upsert", targetType: "team", targetId: existing.id,
        summary: `Updated team ${req.name}`, changes, requestId: req.requestId });
      return { contractVersion: 1, teamId: existing.id, created: false, revision: revision + 1 } satisfies UpsertTeamResponse;
    }, now);
  })).value;
}

/** updateCompanySettingsV1: open vs roster-only membership. Existing members are never affected. */
export async function updateCompanySettings(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<UpdateCompanySettingsResponse> {
  const authenticated = requireCaller(caller);
  const req = parseCompanySettings(data);
  await deps.limiter?.consume(authenticated.uid);
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "company.settings");
    return once(tx, actor, "updateCompanySettingsV1", req.requestId, { membershipMode: req.membershipMode }, async () => {
      const company = await tx.get(paths.company(actor.companyId));
      if (!company) throw new AdminError("not-found", "COMPANY_NOT_FOUND", "Company not found.");
      const current = company.membershipMode === "rosterOnly" ? "rosterOnly" : "open";
      if (current === req.membershipMode) return { contractVersion: 1, membershipMode: current, changed: false } satisfies UpdateCompanySettingsResponse;
      tx.update(paths.company(actor.companyId), { membershipMode: req.membershipMode });
      writeAudit(tx, actor, { id: `${actor.uid}_${req.requestId}`, action: "company.settings", targetType: "company", targetId: actor.companyId,
        summary: `Membership mode set to ${req.membershipMode}`, changes: [change("membershipMode", current, req.membershipMode)], requestId: req.requestId });
      return { contractVersion: 1, membershipMode: req.membershipMode, changed: true } satisfies UpdateCompanySettingsResponse;
    }, deps.now());
  })).value;
}
