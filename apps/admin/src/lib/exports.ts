import type { Attendance, Attendee, AuditEntry, Member, Team } from "./adminTypes";
import { toCsv } from "./csv";

export const ATTENDANCE_LABEL: Record<Attendance, string> = { unmarked: "Not marked", checkedIn: "Checked in", noShow: "No-show" };

export function attendeesCsv(eventTitle: string, rows: Attendee[]): string {
  return toCsv([
    ["event", "name", "email", "department", "job title", "rsvp date", "attendance"],
    ...rows.map((a) => [eventTitle, a.name, a.email, a.department, a.jobTitle, a.rsvpAt.slice(0, 10), ATTENDANCE_LABEL[a.attendance]]),
  ]);
}

export function membersCsv(rows: Member[], teams: Team[]): string {
  const team = (ids: string[]) => ids.map((id) => teams.find((t) => t.id === id)?.name ?? id).join("; ");
  return toCsv([
    ["name", "email", "role", "status", "teams", "department", "job title", "work location", "points"],
    ...rows.map((m) => [m.displayName, m.email, m.role, m.status, team(m.teamIds), m.department, m.jobTitle, m.workLocation, m.pointsBalance]),
  ]);
}

export function auditCsv(rows: AuditEntry[]): string {
  return toCsv([
    ["time", "actor", "action", "target", "summary", "reason"],
    ...rows.map((r) => [r.at, r.actorName, r.action, r.targetLabel, r.summary, r.reason ?? ""]),
  ]);
}
