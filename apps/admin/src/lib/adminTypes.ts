// Types, permissions and callable names for the admin tools (members, roster, import, albums, attendees,
// audit). They follow the tickets #121-#126 and are adapted to docs/contracts/admin.md; every callable name
// lives in ADMIN_CALLABLES so a rename in the spec is a one-line change.

export type Role = "member" | "organizer" | "admin";
export type MemberStatus = "invited" | "active" | "deactivated";

/** Actions the portal gates in the UI. The backend enforces the same matrix; this is only a convenience. */
export type Capability =
  | "events.manage" | "themes.manage" | "albums.moderate" | "attendees.manage"
  | "members.view" | "members.edit" | "members.status" | "members.reset" | "points.adjust"
  | "import.run" | "roster.manage" | "audit.view" | "challenges.review";

const ORGANIZER_CAPS: readonly Capability[] = ["events.manage", "albums.moderate", "attendees.manage", "members.view"];
const ADMIN_CAPS: readonly Capability[] = [
  ...ORGANIZER_CAPS, "themes.manage", "challenges.review", "members.edit", "members.status", "members.reset", "points.adjust",
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

/** Callable names from docs/contracts/admin.md. */
export const ADMIN_CALLABLES = {
  removePhoto: "removeEventPhotoV1",
  removePhotoComment: "removeEventPhotoCommentV1",
  addAttendee: "addEventAttendeeV1",
  removeAttendee: "removeEventAttendeeV1",
  recordAttendance: "recordAttendanceV1",
  listMembers: "listMembersV1",
  getMember: "getMemberV1",
  updateMember: "updateMemberV1",
  setMemberStatus: "setMemberStatusV1",
  resetMemberProfile: "resetMemberProfileV1",
  adjustPoints: "adjustMemberPointsV1",
  upsertRosterEntry: "upsertRosterEntryV1",
  revokeRosterEntry: "revokeRosterEntryV1",
  planImport: "importEmployeesV1",
  applyImport: "applyEmployeeImportV1",
  getImport: "getEmployeeImportV1",
  listSubmissions: "listChallengeSubmissionsV1",
  approveSubmission: "approveChallengeV1",
  rejectSubmission: "rejectChallengeV1",
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
  /** Present for admins only (organizers see people without balances). */
  pointsBalance: number | null;
  createdAt: string;
  /** Self-set profile data that "Reset participant profile" clears (with interests, travel radius, availability and favorites). */
  avatarId: string;
  city: string;
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
  /** Roster document id (hash of the email); members without a roster entry use their uid. */
  entryId: string;
  email: string;
  displayName: string;
  role: Role;
  teamIds: string[];
  workLocation: string;
  department: string;
  jobTitle: string;
  managerEmail: string;
  startDate: string;
  /** invited: no account yet; active/deactivated: the member exists; revoked: invite withdrawn. */
  state: "invited" | "active" | "deactivated" | "revoked";
  memberId?: string;
  invitedAt: string;
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

export interface Attendee {
  memberId: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
  rsvpAt: string;
  checkedIn: boolean;
  addedByAdmin: boolean;
}

export interface AddAttendeeInput {
  eventId: string;
  memberId: string;
  requestId: string;
  /** Needed when the event is full: capacity grows by one and the reason is audited (3 to 200 characters). */
  capacityOverrideReason?: string;
  notify: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  action: string;
  targetType: "member" | "event" | "photo" | "comment" | "attendee" | "roster" | "import" | "team" | "company" | "points";
  targetId: string;
  summary: string;
  reason?: string;
  changes: { field: string; before: string; after: string }[];
}

export const AUDIT_ACTIONS: Record<string, string> = {
  "member.update": "Member edited",
  "member.reset": "Profile reset",
  "member.status": "Access changed",
  "points.adjust": "Points changed",
  "photo.remove": "Photo removed",
  "photo.comment.remove": "Comment removed",
  "attendee.add": "Attendee added",
  "attendee.remove": "Attendee removed",
  "attendance.record": "Attendance recorded",
  "team.upsert": "Team saved",
  "company.settings": "Settings changed",
  "roster.upsert": "Roster entry saved",
  "roster.revoke": "Invite revoked",
  "roster.claim": "Invite claimed",
  "import.plan": "Import previewed",
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

/** The server limit (importEmployeesV1 maxItems) and the size of its apply chunks. */
export const IMPORT_LIMITS = { maxRows: 2000, maxBytes: 2 * 1024 * 1024, serverChunk: 100 } as const;

export type PlanAction = "create" | "update" | "unchanged" | "invalid";
export interface FieldChange { field: string; before: string; after: string }
export interface PlanRow {
  /** 1-based spreadsheet line (the header is line 1). */
  line: number;
  email: string;
  action: PlanAction;
  changes: FieldChange[];
  errors: string[];
}

export interface ImportPlanRequest {
  /** One key per attempt; a retry with the same rows returns the same job. */
  requestId: string;
  fileName: string;
  rows: ImportRow[];
}
/** Row numbers are 1-based positions in the submitted rows (importEmployeesV1). */
export interface ImportPlanResponse {
  jobId: string;
  planHash: string;
  chunkCount: number;
  rows: { rowNumber: number; email: string; action: PlanAction; target: "member" | "roster" | "none"; changes: FieldChange[]; errors: { field?: string; code: string; message: string }[] }[];
}

export type ApplyOutcome = "created" | "updated" | "unchanged" | "failed";
export interface ApplyRowResult { rowNumber: number; email: string; outcome: ApplyOutcome; message?: string }
export interface ImportProgress { processed: number; total: number; created: number; updated: number; unchanged: number; failed: number }
export interface ApplyStepResponse {
  status: "planned" | "running" | "completed" | "completed_with_errors";
  done: boolean;
  progress: ImportProgress;
  results: ApplyRowResult[];
}

// ---------- Challenge submissions (docs/contracts/challenge-submissions.md)

export type SubmissionStatus = "submitted" | "approved" | "rejected";
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = { submitted: "Pending", rejected: "Needs changes", approved: "Approved" };

export interface Submission {
  /** `{challengeId}_{userId}` */
  id: string;
  challengeId: string;
  userId: string;
  userName: string;
  caption: string;
  progress: number;
  status: SubmissionStatus;
  createdAt: string;
  /** Send back as `expectedUpdatedAt` when reviewing: the review fails if the member edited since. */
  updatedAt: string;
  /** Evidence object path, or null for a note-only entry. */
  storagePath: string | null;
  attempt: number;
  reviewedAt: string | null;
  reviewNote: string | null;
  pointsAwarded: number;
}

export interface SubmissionPage { submissions: Submission[]; nextCursor: string | null }
