import type {
  AddAttendeeInput, AlbumComment, AlbumPhoto, ApplyStepResponse, Attendee, AuditEntry, CompanyInfo,
  BackfillStep, ImportJobInfo, ImportPlanRequest, ImportPlanResponse, Member, MemberPage, MemberPatch, MemberQuery, MemberStatus, ResendResult,
  RosterPage, RosterQuery, RosterRow, Submission, SubmissionPage, SubmissionStatus,
} from "./adminTypes";

/**
 * Admin tools beyond events and themes (docs/contracts/admin.md). Implemented by the mock (adminMock.ts,
 * enforces the same rules as the callables) and by the Firebase adapter (adminLive.ts). Every method is
 * authorized by the backend; the portal's capability gating only hides controls.
 */
export interface AdminOpsApi {
  companyInfo(): Promise<CompanyInfo>;

  // ----- Albums (#122)
  listPhotos(eventId: string): Promise<AlbumPhoto[]>;
  listPhotoComments(eventId: string, photoId: string): Promise<AlbumComment[]>;
  /** A displayable URL for the photo (live: a blob URL read through the authenticated Storage SDK). */
  photoImage(photo: AlbumPhoto): Promise<string>;
  removePhoto(eventId: string, photoId: string, reason: string): Promise<void>;
  removePhotoComment(eventId: string, photoId: string, commentId: string, reason: string): Promise<void>;

  // ----- Attendees (#123)
  listAttendees(eventId: string): Promise<Attendee[]>;
  addAttendee(input: AddAttendeeInput): Promise<{ attendeeCount: number; capacity: number }>;
  removeAttendee(eventId: string, memberId: string, notify: boolean, reason: string): Promise<{ attendeeCount: number }>;
  /** recordAttendanceV1: check in (awards the event's points once) or mark a no-show (refused once points were awarded). */
  recordAttendance(eventId: string, memberId: string, checkedIn: boolean): Promise<{ pointsAwarded: number; checkedIn: boolean }>;

  // ----- Members (#124)
  /** Every member (follows the cursor to the end; for pickers and joins, not for the directory screen). */
  listMembers(): Promise<Member[]>;
  /** One page of the directory with server-side search and filters (listMembersV1 scans in id order, so a page can be short while more follow). */
  listMembersPage(query: MemberQuery, cursor?: string | null, pageSize?: number): Promise<MemberPage>;
  getMember(memberId: string): Promise<Member>;
  updateMember(memberId: string, expectedRevision: number, patch: MemberPatch): Promise<Member>;
  setMemberStatus(memberId: string, status: Exclude<MemberStatus, "invited">, reason: string): Promise<Member>;
  resetMemberProfile(memberId: string, reason: string): Promise<Member>;
  /** Adds a signed delta (reset = minus the current balance). Needs a reason; the balance can't go below zero. */
  adjustPoints(memberId: string, requestId: string, delta: number, reason: string): Promise<Member>;

  // ----- Roster (#126) and import (#125)
  /** One page of the roster with server-side state filter and search (listRosterV1). The first page also returns exact counts per state. */
  listRosterPage(query: RosterQuery, cursor?: string | null, pageSize?: number): Promise<RosterPage>;
  revokeRosterEntry(entryId: string): Promise<void>;
  /** resendRosterInviteV1: records a resend for an invited entry and returns the message and link to share (no email is sent). */
  resendInvite(row: RosterRow): Promise<ResendResult>;
  /** backfillRosterV1: adds existing members that have no roster entry, 100 per call. A dry run only counts. */
  backfillRoster(dryRun: boolean, requestId: string, cursor?: string | null): Promise<BackfillStep>;
  /** getEmployeeImportV1: where an import stands (used to resume after a reload). */
  getImport(jobId: string): Promise<ImportJobInfo>;
  /** Re-invites a revoked entry (upsertRosterEntryV1). */
  reinvite(row: RosterRow): Promise<void>;
  /** Dry run (importEmployeesV1): validates and plans every row, writes nothing but the job record. */
  planImport(request: ImportPlanRequest): Promise<ImportPlanResponse>;
  /** Applies the next unprocessed chunk (applyEmployeeImportV1); call until `done`. Repeating a finished job is a no-op. */
  applyImportStep(jobId: string, planHash: string): Promise<ApplyStepResponse>;

  // ----- Challenge submissions (review queue)
  /** One page of a theme's submissions (listChallengeSubmissionsV1), filtered by status. */
  listSubmissions(challengeId: string, status: SubmissionStatus, cursor?: string | null): Promise<SubmissionPage>;
  /** Evidence picture for a submission (live: a blob URL read through the authenticated Storage SDK). */
  submissionEvidence(submission: Submission): Promise<string>;
  /** approveChallengeV1: awards the theme's points once. `expectedUpdatedAt` is the listed `updatedAt` (SUBMISSION_CHANGED if the member edited since). */
  approveSubmission(submission: Submission): Promise<{ pointsAwarded: number; replayed: boolean }>;
  /** rejectChallengeV1: sends it back with a required note (1 to 280 characters). */
  rejectSubmission(submission: Submission, reason: string): Promise<{ replayed: boolean }>;

  // ----- Audit (#121)
  listAudit(): Promise<AuditEntry[]>;
}
