import { sha256 } from "./reader";

/**
 * Team names in imports and Add person (docs/design/roster-data-minimization.md). An unknown team name never fails a row:
 * the import creates the team. Names are matched to existing teams case- and accent-insensitively after trimming and
 * collapsing whitespace, and a new team gets a deterministic id from its normalized name, so reruns and concurrent imports
 * converge on one document per name and company.
 */

/** Longest team name (Team.name maxLength). Longer names are skipped, not truncated. */
export const MAX_TEAM_NAME = 80;
/** New teams one import (or one Add person) may create; further new names are skipped and listed. */
export const MAX_NEW_TEAMS_PER_IMPORT = 50;
/** Teams a company may hold before imports stop creating more (the catalog read is capped at this size). */
export const MAX_COMPANY_TEAMS = 500;

export type TeamSkipReason = "TEAM_ARCHIVED" | "TEAM_NAME_TOO_LONG" | "TEAM_IMPORT_LIMIT" | "TEAM_COMPANY_LIMIT";
export interface TeamRefLike { id: string; name: string; archived: boolean }
export interface NewTeam { id: string; name: string }
export interface SkippedTeam { name: string; reason: TeamSkipReason }
export type TeamResolution = { kind: "existing"; id: string } | { kind: "new"; id: string; name: string } | { kind: "skipped"; name: string; reason: TeamSkipReason };

/** Display form: trimmed, inner whitespace collapsed to one space. */
export const cleanTeamName = (raw: string) => raw.replace(/\s+/g, " ").trim();
/** Match key: display form without accents, lower case ("Ingeniería " and "ingenieria" share a key). */
export const teamKey = (raw: string) => cleanTeamName(raw).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
/** Deterministic id of a team created from a name; the path is company scoped, so equal names in two companies never meet. */
export const teamIdFor = (raw: string) => `team_${sha256(teamKey(raw)).slice(0, 32)}`;

export const TEAM_SKIP_MESSAGES: Record<TeamSkipReason, (name: string) => string> = {
  TEAM_ARCHIVED: name => `Team "${name}" is archived, so it was left out.`,
  TEAM_NAME_TOO_LONG: () => `A team name is longer than ${MAX_TEAM_NAME} characters, so it was left out.`,
  TEAM_IMPORT_LIMIT: name => `Team "${name}" was left out: one import creates at most ${MAX_NEW_TEAMS_PER_IMPORT} new teams.`,
  TEAM_COMPANY_LIMIT: name => `Team "${name}" was left out: the company already has ${MAX_COMPANY_TEAMS} teams.`,
};

/**
 * Resolves team names (or ids) for one import against the catalog. Stateful across rows: each new name is planned once,
 * and the per-import and company caps count distinct new names. Order of first appearance decides which names fit a cap.
 */
export class TeamResolver {
  private readonly byId = new Map<string, TeamRefLike>();
  private readonly byKey = new Map<string, TeamRefLike>();
  private readonly planned = new Map<string, NewTeam>();
  private readonly skipped = new Map<string, SkippedTeam>();

  constructor(teams: readonly TeamRefLike[], private readonly limits = { perImport: MAX_NEW_TEAMS_PER_IMPORT, company: MAX_COMPANY_TEAMS }) {
    for (const team of teams) {
      this.byId.set(team.id, team);
      const key = teamKey(team.name);
      // An active team wins over an archived one with the same name.
      const prior = this.byKey.get(key);
      if (key && (!prior || (prior.archived && !team.archived))) this.byKey.set(key, team);
    }
  }

  resolve(raw: string): TeamResolution | null {
    const name = cleanTeamName(raw);
    if (!name) return null;
    const known = this.byId.get(raw.trim()) ?? this.byKey.get(teamKey(name)) ?? this.byId.get(teamIdFor(name));
    if (known) return known.archived ? this.skip(known.name, "TEAM_ARCHIVED") : { kind: "existing", id: known.id };
    if (Array.from(name).length > MAX_TEAM_NAME) return this.skip(`${Array.from(name).slice(0, 60).join("").trimEnd()}…`, "TEAM_NAME_TOO_LONG");
    const key = teamKey(name);
    const planned = this.planned.get(key);
    if (planned) return { kind: "new", ...planned };
    const skipped = this.skipped.get(key);
    if (skipped) return { kind: "skipped", ...skipped };
    if (this.planned.size >= this.limits.perImport) return this.skip(name, "TEAM_IMPORT_LIMIT");
    if (this.byId.size + this.planned.size >= this.limits.company) return this.skip(name, "TEAM_COMPANY_LIMIT");
    const team = { id: teamIdFor(name), name };
    this.planned.set(key, team);
    return { kind: "new", ...team };
  }

  /** New teams this import creates, in order of first appearance. */
  newTeams(): NewTeam[] { return [...this.planned.values()]; }
  /** Names left out (archived, too long, over a cap), once each. */
  skippedTeams(): SkippedTeam[] { return [...this.skipped.values()]; }

  private skip(name: string, reason: TeamSkipReason): TeamResolution {
    const key = teamKey(name);
    if (!this.skipped.has(key)) this.skipped.set(key, { name, reason });
    return { kind: "skipped", name, reason };
  }
}
