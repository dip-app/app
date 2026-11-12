/**
 * Roles and permissions (docs/contracts/admin.md#roles-and-permission-matrix). Authorization is always
 * derived from the server-owned membership document; this table is the single server-side source of truth
 * and is mirrored by gcp/firestore.rules for direct reads.
 */
export type Role = "member" | "organizer" | "admin";

export type Permission =
  | "event.manage"
  | "attendee.manage"
  | "attendance.record"
  | "album.moderate"
  | "member.read"
  | "member.manage"
  | "team.manage"
  | "roster.manage"
  | "import.run"
  | "audit.read"
  | "insights.read"
  | "bugreport.manage"
  | "challenge.manage";

const ORGANIZER_AND_ADMIN: readonly Role[] = ["organizer", "admin"];
const ADMIN_ONLY: readonly Role[] = ["admin"];

export const PERMISSION_MATRIX: Readonly<Record<Permission, readonly Role[]>> = {
  "event.manage": ORGANIZER_AND_ADMIN,
  "attendee.manage": ORGANIZER_AND_ADMIN,
  "attendance.record": ORGANIZER_AND_ADMIN,
  "album.moderate": ORGANIZER_AND_ADMIN,
  "member.read": ORGANIZER_AND_ADMIN,
  "member.manage": ADMIN_ONLY,
  "team.manage": ADMIN_ONLY,
  "roster.manage": ADMIN_ONLY,
  "import.run": ADMIN_ONLY,
  "audit.read": ADMIN_ONLY,
  "insights.read": ORGANIZER_AND_ADMIN,
  "bugreport.manage": ADMIN_ONLY,
  // Challenges are admin-only until that module adopts `can`.
  "challenge.manage": ADMIN_ONLY,
};

export const ROLES: readonly Role[] = ["member", "organizer", "admin"];

export function isRole(value: unknown): value is Role {
  return value === "member" || value === "organizer" || value === "admin";
}

export function can(role: unknown, permission: Permission): boolean {
  return isRole(role) && PERMISSION_MATRIX[permission].includes(role);
}
