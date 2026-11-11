// Types, permissions and callable names for the admin tools (members, roster, import, albums, attendees,
// audit). They follow the tickets #121-#126 and are adapted to docs/contracts/admin.md; every callable name
// lives in ADMIN_CALLABLES so a rename in the spec is a one-line change.

export type Role = "member" | "organizer" | "admin";
export type MemberStatus = "invited" | "active" | "deactivated";

/** Actions the portal gates in the UI. The backend enforces the same matrix; this is only a convenience. */
export type Capability =
  | "events.manage" | "themes.manage" | "albums.moderate" | "attendees.manage"
  | "members.view" | "members.edit" | "members.status" | "members.reset" | "points.adjust"
  | "import.run" | "roster.manage" | "audit.view";

const ORGANIZER_CAPS: readonly Capability[] = ["events.manage", "themes.manage", "albums.moderate", "attendees.manage"];
const ADMIN_CAPS: readonly Capability[] = [
  ...ORGANIZER_CAPS, "members.view", "members.edit", "members.status", "members.reset", "points.adjust",
  "import.run", "roster.manage", "audit.view",
];

export function capabilitiesOf(role: Role): readonly Capability[] {
  return role === "admin" ? ADMIN_CAPS : role === "organizer" ? ORGANIZER_CAPS : [];
}
export function can(role: Role | undefined, capability: Capability): boolean {
  return role !== undefined && capabilitiesOf(role).includes(capability);
}
/** Organizers and admins may open the portal at all. */
export function isStaff(role: Role | undefined): boolean {
  return role === "admin" || role === "organizer";
}
export const ROLE_LABEL: Record<Role, string> = { member: "Member", organizer: "Organizer", admin: "Admin" };

export const ADMIN_CALLABLES = {
  removePhoto: "removeEventPhotoV1",
  removePhotoComment: "removeEventPhotoCommentV1",
  addAttendee: "addEventAttendeeV1",
  removeAttendee: "removeEventAttendeeV1",
  recordAttendance: "recordAttendanceV1",
  setAttendance: "setEventAttendanceV1",
  updateMember: "updateMemberV1",
  setMemberStatus: "setMemberStatusV1",
  resetMemberProfile: "resetMemberProfileV1",
  adjustPoints: "adjustMemberPointsV1",
  planImport: "importEmployeesV1",
  applyImport: "applyEmployeeImportV1",
  resendInvite: "resendRosterInviteV1",
  revokeInvite: "revokeRosterInviteV1",
} as const;

export interface Team { id: string; name: string }

export interface CompanyInfo {
  id: string;
  name: string;
  /** Lowercase domain members' emails must belong to (e.g. "acme.com"). */
  emailDomain: string;
  teams: Team[];
}

export interface Member {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  teamIds: string[];
  workLocation: string;
  department: string;
  jobTitle: string;
  status: MemberStatus;
  pointsBalance: number;
  createdAt: string;
  /** Self-set profile data that "Reset participant profile" clears. */
  interestTagIds: string[];
  avatarId: string;
  city: string;
  favoriteCount: number;
  revision: number;
}

/** The fields an admin may change on a member (never points, ids or email). */
export interface MemberPatch {
  role?: Role;
  teamIds?: string[];
  workLocation?: string;
  department?: string;
  jobTitle?: string;
}

export interface RosterRow {
  email: string;
  displayName: string;
  role: Role;
  teamIds: string[];
  workLocation: string;
  department: string;
  jobTitle: string;
  /** invited: no account yet; active/deactivated: the member exists; revoked: invite withdrawn. */
  state: "invited" | "active" | "deactivated" | "revoked";
  memberId?: string;
  invitedAt: string;
  lastInvitedAt: string;
  inviteCount: number;
}

export interface AlbumPhoto {
  id: string;
  eventId: string;
  uploaderId: string;
  uploaderName: string;
  caption: string;
  commentCount: number;
  createdAt: string;
  /** Storage object path; live mode reads the bytes through the authenticated SDK. */
  storagePath: string;
  /** Mock mode only: a bundled picture. */
  previewImage?: string;
}

export interface AlbumComment {
  id: string;
  photoId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export type Attendance = "unmarked" | "checkedIn" | "noShow";

export interface Attendee {
  memberId: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
  rsvpAt: string;
  attendance: Attendance;
  addedByAdmin: boolean;
}

export interface AddAttendeeInput {
  eventId: string;
  memberId: string;
  requestId: string;
  /** Allow going over capacity; requires a reason. */
  overrideCapacity: boolean;
  reason?: string;
  notify: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: "member" | "event" | "photo" | "comment" | "roster" | "import" | "attendee";
  targetId: string;
  targetLabel: string;
  summary: string;
  reason?: string;
  before?: Record<string, string>;
  after?: Record<string, string>;
}

export const AUDIT_ACTIONS: Record<string, string> = {
  "member.update": "Member edited",
  "member.deactivate": "Member deactivated",
  "member.reactivate": "Member reactivated",
  "member.resetProfile": "Profile reset",
  "member.points": "Points changed",
  "photo.remove": "Photo removed",
  "comment.remove": "Comment removed",
  "attendee.add": "Attendee added",
  "attendee.remove": "Attendee removed",
  "attendee.attendance": "Attendance recorded",
  "roster.resend": "Invite resent",
  "roster.revoke": "Invite revoked",
  "import.apply": "Import applied",
};

// ---------- Bulk import

export interface ImportRow {
  email: string;
  displayName: string;
  /** Blank keeps the current role (new people become members). */
  role: Role | "";
  /** Team names (or ids); the server resolves them against the company's teams catalog. */
  teams: string[];
  department: string;
  jobTitle: string;
  workLocation: string;
  managerEmail: string;
  startDate: string;
}
export const IMPORT_FIELDS = ["email", "displayName", "role", "teams", "department", "jobTitle", "workLocation", "managerEmail", "startDate"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_LIMITS = { maxRows: 2000, maxBytes: 2 * 1024 * 1024, chunkSize: 200 } as const;

export type PlanAction = "create" | "update" | "unchanged" | "invalid";
export interface FieldChange { field: ImportField; before: string; after: string }
export interface PlanRow {
  /** 1-based spreadsheet line (the header is line 1). */
  line: number;
  email: string;
  action: PlanAction;
  changes: FieldChange[];
  errors: string[];
}

export interface ImportChunkRequest {
  jobId: string;
  chunkIndex: number;
  chunkCount: number;
  rows: ImportRow[];
  /** Spreadsheet line of each row (same length as rows), so row numbers stay global. */
  lines: number[];
}

export type ApplyOutcome = "created" | "updated" | "unchanged" | "failed";
export interface ApplyRowResult { line: number; email: string; outcome: ApplyOutcome; error?: string }
