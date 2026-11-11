import { rootDomainOfEmail } from "../../accounts/domain/emailDomain";
import { AdminError, invalid } from "./errors";
import { isRole, type Role } from "./permissions";
import { length, sha256 } from "./reader";
import { diffFields, type AuditChange } from "./audit";

/** One normalized employee row (roster entry or import row). Absent optional fields mean "leave unchanged". */
export interface EmployeeRecord {
  email: string;
  displayName?: string;
  role?: Role;
  teamIds?: string[];
  workLocation?: string;
  department?: string;
  jobTitle?: string;
  managerEmail?: string;
  startDate?: string;
}

export interface TeamRef { id: string; name: string; archived: boolean }
export interface RowIssue { field: string; code: string; message: string }
export interface EmployeeContext { companyDomain: string; teams: readonly TeamRef[] }

export const MAX_TEAMS_PER_MEMBER = 20;
export const EMPLOYEE_KEYS = ["email", "displayName", "role", "teamIds", "workLocation", "department", "jobTitle", "managerEmail", "startDate"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
/** Roster document id: lower-case hex SHA-256 of the lower-case email. */
export const emailHash = (email: string) => sha256(normalizeEmail(email));

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates and normalizes one raw row. Cells are trimmed and blank cells are treated as not supplied (spreadsheet
 * friendly). Every problem is reported with a stable code; the row is usable only when `issues` is empty.
 */
export function normalizeEmployee(raw: unknown, ctx: EmployeeContext): { record: EmployeeRecord; email: string; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const issue = (field: string, code: string, message: string) => { issues.push({ field, code, message }); };
  const record: EmployeeRecord = { email: "" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issue("row", "VALIDATION_FAILED", "Row must be an object.");
    return { record, email: "", issues };
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!(EMPLOYEE_KEYS as readonly string[]).includes(key)) issue(key, "UNKNOWN_FIELD", "Unknown column.");
  const cell = (key: string, max: number): string | undefined => {
    const value = input[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") { issue(key, "VALIDATION_FAILED", "Must be text."); return undefined; }
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (length(trimmed) > max) { issue(key, "TOO_LONG", `At most ${max} characters.`); return undefined; }
    return trimmed;
  };

  const email = cell("email", 254);
  if (!email) issue("email", "EMAIL_REQUIRED", "Email is required.");
  else if (!EMAIL.test(email)) issue("email", "EMAIL_INVALID", "Not a valid email address.");
  else {
    record.email = normalizeEmail(email);
    if (rootDomainOfEmail(record.email) !== ctx.companyDomain) issue("email", "EMAIL_DOMAIN_MISMATCH", "Email is outside the company's domain.");
  }
  const displayName = cell("displayName", 80);
  if (displayName !== undefined) record.displayName = displayName.replace(/\s+/g, " ");
  const roleText = cell("role", 20);
  if (roleText !== undefined) {
    const role = roleText.toLowerCase();
    if (isRole(role)) record.role = role; else issue("role", "ROLE_INVALID", "Role must be member, organizer or admin.");
  }
  for (const key of ["workLocation", "department", "jobTitle"] as const) {
    const value = cell(key, 120);
    if (value !== undefined) record[key] = value;
  }
  const manager = cell("managerEmail", 254);
  if (manager !== undefined) {
    if (EMAIL.test(manager)) record.managerEmail = normalizeEmail(manager); else issue("managerEmail", "EMAIL_INVALID", "Not a valid email address.");
  }
  const start = cell("startDate", 10);
  if (start !== undefined) {
    if (validDate(start)) record.startDate = start; else issue("startDate", "DATE_INVALID", "Use YYYY-MM-DD.");
  }
  const rawTeams = input.teamIds;
  if (rawTeams !== undefined && rawTeams !== null) {
    if (!Array.isArray(rawTeams) || rawTeams.length > MAX_TEAMS_PER_MEMBER || !rawTeams.every(t => typeof t === "string")) {
      issue("teamIds", "VALIDATION_FAILED", `Up to ${MAX_TEAMS_PER_MEMBER} team names.`);
    } else {
      const resolved: string[] = [];
      for (const name of (rawTeams as string[]).map(t => t.trim()).filter(Boolean)) {
        const team = ctx.teams.find(t => t.id === name) ?? ctx.teams.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (!team) issue("teamIds", "TEAM_NOT_FOUND", `Unknown team "${name.slice(0, 60)}".`);
        else if (team.archived) issue("teamIds", "TEAM_ARCHIVED", `Team "${team.name.slice(0, 60)}" is archived.`);
        else if (!resolved.includes(team.id)) resolved.push(team.id);
      }
      record.teamIds = resolved;
    }
  }
  return { record, email: record.email, issues };
}

/** Throws the matching AdminError for single-record commands (roster upsert). Fields are prefixed with `prefix`. */
export function assertValid(issues: readonly RowIssue[], prefix: string): void {
  if (issues.length === 0) return;
  const fields = issues.map(i => `${prefix}${i.field}`);
  if (issues.some(i => i.code === "EMAIL_DOMAIN_MISMATCH")) {
    throw new AdminError("invalid-argument", "EMAIL_DOMAIN_MISMATCH", "Email is outside the company's domain.", [...new Set(fields)].sort());
  }
  if (issues.some(i => i.code === "TEAM_NOT_FOUND" || i.code === "TEAM_ARCHIVED")) {
    throw new AdminError("invalid-argument", "TEAM_NOT_FOUND", "Choose teams from the catalog.", [...new Set(fields)].sort());
  }
  throw invalid(fields);
}

/** Document fields an employee record may set on users/{uid} (displayName, email and points never). */
export function memberPatch(record: EmployeeRecord): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["role", "teamIds", "workLocation", "department", "jobTitle", "managerEmail", "startDate"] as const) {
    if (record[key] !== undefined) patch[key] = record[key];
  }
  return patch;
}

/** Changes the record would make to an existing member document (only supplied fields). */
export function memberChanges(member: Record<string, unknown>, record: EmployeeRecord): { patch: Record<string, unknown>; changes: AuditChange[] } {
  const base = { ...member, teamIds: Array.isArray(member.teamIds) ? member.teamIds : [] };
  const wanted = memberPatch(record);
  const changes = diffFields(base, wanted);
  const patch: Record<string, unknown> = {};
  for (const c of changes) patch[c.field] = wanted[c.field];
  return { patch, changes };
}

/** Fields stored on a new roster entry; defaults fill every unsupplied field. */
export function newEntryFields(record: EmployeeRecord): Record<string, unknown> {
  return {
    email: record.email, displayName: record.displayName ?? "", role: record.role ?? "member", teamIds: record.teamIds ?? [],
    workLocation: record.workLocation ?? "", department: record.department ?? "", jobTitle: record.jobTitle ?? "",
    ...(record.managerEmail !== undefined ? { managerEmail: record.managerEmail } : {}),
    ...(record.startDate !== undefined ? { startDate: record.startDate } : {}),
  };
}

/** Changes the record would make to an existing roster entry (supplied fields; a revoked entry is re-invited). */
export function entryChanges(entry: Record<string, unknown>, record: EmployeeRecord): { patch: Record<string, unknown>; changes: AuditChange[] } {
  const wanted: Record<string, unknown> = { ...memberPatch(record) };
  if (record.displayName !== undefined) wanted.displayName = record.displayName;
  const changes = diffFields({ ...entry, teamIds: Array.isArray(entry.teamIds) ? entry.teamIds : [] }, wanted);
  const patch: Record<string, unknown> = {};
  for (const c of changes) patch[c.field] = wanted[c.field];
  if (entry.status !== "invited") {
    // A revoked (or orphaned claimed) entry is re-invited by a new upsert.
    patch.status = "invited";
    changes.push({ field: "status", before: typeof entry.status === "string" ? entry.status : null, after: "invited" });
  }
  return { patch, changes };
}
