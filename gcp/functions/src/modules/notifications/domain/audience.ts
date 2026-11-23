/**
 * Company-wide fan-out audience (weekly theme push and weekly theme email, docs/design/push-catalog.md row 11):
 * every active member of the company, whatever the role (`member`, `organizer`, `admin`). `invited` (not yet joined)
 * and `deactivated` users are excluded; a missing status means active (older user documents). Unknown roles are
 * excluded, so a malformed document never widens the audience.
 */
export const COMPANY_AUDIENCE_ROLES = ["member", "organizer", "admin"] as const;

export function isCompanyAudienceMember(user: { role?: unknown; status?: unknown }): boolean {
  const activeStatus = user.status === undefined || user.status === null || user.status === "active";
  return activeStatus && typeof user.role === "string" && (COMPANY_AUDIENCE_ROLES as readonly string[]).includes(user.role);
}
