/**
 * Every action key an audit entry can carry. `AuditInput.action` is typed from this list, so a writer cannot
 * add a new action without extending it here, and the admin portal test (apps/admin/src/lib/__tests__/auditLabels.test.ts)
 * fails until `apps/admin/src/lib/auditLabels.ts` has a human-readable label for it.
 *
 * Keep one quoted string per entry; the portal test parses this file.
 */
export const AUDIT_ACTIONS = [
  "member.update",
  "member.reset",
  "member.status",
  "points.adjust",
  "photo.remove",
  "photo.comment.remove",
  "attendee.add",
  "attendee.remove",
  "attendance.record",
  "team.upsert",
  "roster.upsert",
  "roster.revoke",
  "roster.resend",
  "roster.inviteEmail",
  "roster.backfill",
  "roster.claim",
  "import.plan",
  "import.apply",
  "bugreport.update",
  "ai.generateDrafts",
  "ai.noteDeclined",
  "ai.generateFailed",
  "ai.ideasGenerated",
  "ai.ideasFailed",
  "suggestions.setSchedule",
  "company.office.update",
  "event.create",
  "event.update",
  "event.status",
  "event.cancel",
  "challenge.create",
  "challenge.update",
  "submission.approve",
  "submission.reject",
  "cover.pick",
  "cover.import",
  "suggestions.sendTest",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
