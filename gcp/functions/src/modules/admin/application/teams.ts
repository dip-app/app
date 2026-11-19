import { change } from "../domain/audit";
import { paths, SERVER_TIME } from "../domain/ops";
import { MAX_COMPANY_TEAMS, type NewTeam, type SkippedTeam } from "../domain/teamNames";
import { writeAudit, type Actor } from "./context";
import type { AdminTransaction } from "./ports";

export interface LiveTeams {
  /** The ids the row is assigned now: existing active teams plus the new ones this transaction creates. */
  teamIds: string[];
  /** Planned new teams that do not exist yet; `createTeams` writes them. */
  create: NewTeam[];
  /** Teams left out at apply time (archived since planning, or the company reached its team limit). */
  skipped: SkippedTeam[];
}

/**
 * Read phase (Firestore transactions read before they write): re-checks a row's team ids against live data. An id that exists
 * and is active is kept; an archived one is left out; a missing id is created only when the plan named it as a new team and the
 * company is under MAX_COMPANY_TEAMS. Nothing here fails the row. An existing team document is never overwritten.
 */
export async function resolveTeamsLive(tx: AdminTransaction, companyId: string, teamIds: readonly string[], planned: readonly NewTeam[]): Promise<LiveTeams> {
  const kept: string[] = [];
  const create: NewTeam[] = [];
  const skipped: SkippedTeam[] = [];
  for (const id of teamIds) {
    const team = await tx.get(paths.team(companyId, id));
    if (team) {
      if (team.archived === true) skipped.push({ name: typeof team.name === "string" ? team.name.slice(0, 80) : id, reason: "TEAM_ARCHIVED" });
      else kept.push(id);
      continue;
    }
    const wanted = planned.find(t => t.id === id);
    if (wanted) { kept.push(id); create.push(wanted); }
  }
  if (create.length > 0) {
    const room = Math.max(0, MAX_COMPANY_TEAMS - (await tx.count(paths.teams(companyId))));
    for (const extra of create.splice(room)) {
      skipped.push({ name: extra.name, reason: "TEAM_COMPANY_LIMIT" });
      kept.splice(kept.indexOf(extra.id), 1);
    }
  }
  return { teamIds: kept, create, skipped };
}

/** Write phase: creates each new team (same fields as upsertTeamV1) with a `team.create` audit entry under a deterministic id. */
export function createTeams(tx: AdminTransaction, actor: Actor, teams: readonly NewTeam[], auditPrefix: string, requestId: string): void {
  for (const team of teams) {
    tx.create(paths.team(actor.companyId, team.id), {
      companyId: actor.companyId, name: team.name, archived: false, createdAt: SERVER_TIME, updatedAt: SERVER_TIME, revision: 1,
    });
    writeAudit(tx, actor, {
      id: `${auditPrefix}_team_${team.id}`, action: "team.upsert", targetType: "team", targetId: team.id,
      summary: `Created team ${team.name}`, summaryKey: "team.create", summaryParams: { name: team.name }, changes: [change("name", null, team.name)], requestId,
    });
  }
}
