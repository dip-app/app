/**
 * Stable message keys for audit entry summaries (issue #259 backend phase). Every audit entry still stores the English
 * `summary` sentence; entries also carry one of these keys plus `summaryParams` so the admin portal can render the
 * sentence in the viewer's language. Params hold server or user content (names, titles, emails, counts as decimal strings)
 * and are never translated. The portal catalog has `audit.summary.<key>` for each (scripts/backend-i18n checks it).
 *
 * Keep one quoted string per entry; scripts parse this file.
 */
export const AUDIT_SUMMARY_KEYS = [
  "roster.invite",
  "roster.update",
  "roster.revoke",
  "roster.resend",
  "roster.inviteEmail",
  "roster.backfill",
  "roster.claim",
  "attendee.remove",
  "attendee.add",
  "attendee.addOverCapacity",
  "attendance.unmark",
  "attendance.checkIn",
  "attendance.checkInPoints",
  "photo.remove",
  "comment.remove",
  "import.plan",
  "import.update",
  "import.invite",
  "import.updateInvite",
  "import.apply",
  "bugReport.update",
  "bugReport.updateStatus",
  "member.update",
  "member.reset",
  "member.deactivate",
  "member.reactivate",
  "points.adjust",
  "team.create",
  "team.update",
  "event.create",
  "event.update",
  "event.cancel",
  "event.status",
  "challenge.create",
  "challenge.update",
  "submission.approve",
  "submission.reject",
  "office.set",
  "office.change",
  "suggestions.setSchedule",
  "suggestions.sendTest",
  "cover.pick",
  "cover.import",
  "ai.ideasUpdated",
  "ai.ideasFailed",
  "ai.generated",
  "ai.noteDeclined",
  "ai.generateFailed",
] as const;

export type AuditSummaryKey = (typeof AUDIT_SUMMARY_KEYS)[number];

/**
 * Params for a name that may be missing: `known` ("yes" or "no") selects the catalog message's fallback wording
 * ("a member", "a person", "an event"), so the fallback is translated too.
 */
export function named(name: unknown, field = "name"): Record<string, string> {
  const flag = field === "name" ? "known" : `${field}Known`;
  return typeof name === "string" ? { [flag]: "yes", [field]: name } : { [flag]: "no", [field]: "" };
}
