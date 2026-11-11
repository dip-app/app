import type {
  AddAttendeeInput, AlbumComment, AlbumPhoto, ApplyStepResponse, Attendee, AuditEntry, CompanyInfo,
  ImportPlanRequest, ImportPlanResponse, Member, MemberPatch, MemberStatus, RosterRow, Submission, SubmissionPage, SubmissionStatus,
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
  listMembers(): Promise<Member[]>;
  getMember(memberId: string): Promise<Member>;
  updateMember(memberId: string, expectedRevision: number, patch: MemberPatch): Promise<Member>;
  setMemberStatus(memberId: string, status: Exclude<MemberStatus, "invited">, reason: string): Promise<Member>;
  resetMemberProfile(memberId: string, reason: string): Promise<Member>;
  /** Adds a signed delta (reset = minus the current balance). Needs a reason; the balance can't go below zero. */
  adjustPoints(memberId: string, requestId: string, delta: number, reason: string): Promise<Member>;

  // ----- Roster (#126) and import (#125)
  listRoster(): Promise<RosterRow[]>;
  revokeRosterEntry(entryId: string): Promise<void>;
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
