import type { Attendee, AuditEntry, Member, RosterRow, Team } from "./adminTypes";
import { auditAction } from "./auditLabels";
import { toCsv } from "./csv";

export const attendanceLabel = (checkedIn: boolean, eventEnded: boolean) => (checkedIn ? "Checked in" : eventEnded ? "No-show" : "Not checked in");

export function attendeesCsv(eventTitle: string, rows: Attendee[], eventEnded: boolean): string {
  return toCsv([
    ["event", "name", "email", "department", "job title", "rsvp date", "attendance"],
    ...rows.map((a) => [eventTitle, a.name, a.email, a.department, a.jobTitle, a.rsvpAt.slice(0, 10), attendanceLabel(a.checkedIn, eventEnded)]),
  ]);
}

export function membersCsv(rows: Member[], teams: Team[]): string {
  const team = (ids: string[]) => ids.map((id) => teams.find((t) => t.id === id)?.name ?? id).join("; ");
  return toCsv([
    ["name", "email", "role", "status", "teams", "department", "job title", "work location", "points"],
    ...rows.map((m) => [m.displayName, m.email, m.role, m.status, team(m.teamIds), m.department, m.jobTitle, m.workLocation, m.pointsBalance ?? ""]),
  ]);
}

/** Invited or revoked people (Members > Invited / Revoked): the roster columns, with the date they were added. */
export function invitesCsv(rows: RosterRow[], teams: Team[]): string {
  const team = (ids: string[]) => ids.map((id) => teams.find((t) => t.id === id)?.name ?? id).join("; ");
  return toCsv([
    ["name", "email", "role", "status", "teams", "department", "job title", "work location", "added"],
    ...rows.map((r) => [r.displayName, r.email, r.role, r.state, team(r.teamIds), r.department, r.jobTitle, r.workLocation, r.invitedAt.slice(0, 10)]),
  ]);
}

export function auditCsv(rows: AuditEntry[]): string {
  return toCsv([
    ["time", "actor", "role", "action", "action key", "category", "target", "summary", "reason", "changes"],
    ...rows.map((r) => [r.at, r.actorName, r.actorRole, auditAction(r.action).label, r.action, auditAction(r.action).category, `${r.targetType}:${r.targetId}`, r.summary, r.reason ?? "", r.changes.map((c) => `${c.field}: ${c.before || "-"} -> ${c.after || "-"}`).join("; ")]),
  ]);
}
