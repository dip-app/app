import type {
  AddAttendeeInput, AlbumComment, AlbumPhoto, ApplyRowResult, Attendance, Attendee, AuditEntry, CompanyInfo,
  ImportChunkRequest, Member, MemberPatch, MemberStatus, PlanRow, RosterRow,
} from "./adminTypes";

/**
 * Admin tools beyond events and themes. Implemented by the mock (adminMock.ts, enforces the same rules as
 * the callables) and by the Firebase adapter (adminLive.ts). Every method is authorized by the backend; the
 * portal's capability gating only hides controls.
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
  addAttendee(input: AddAttendeeInput): Promise<{ attendeeCount: number }>;
  removeAttendee(eventId: string, memberId: string, notify: boolean, reason: string): Promise<{ attendeeCount: number }>;
  setAttendance(eventId: string, memberId: string, attendance: Attendance): Promise<{ pointsAwarded: number }>;

  // ----- Members (#124)
  listMembers(): Promise<Member[]>;
  getMember(memberId: string): Promise<Member>;
  updateMember(memberId: string, expectedRevision: number, patch: MemberPatch): Promise<Member>;
  setMemberStatus(memberId: string, status: Exclude<MemberStatus, "invited">, reason: string): Promise<Member>;
  resetMemberProfile(memberId: string, reason: string): Promise<Member>;
  /** Either add a signed `delta` or reset the balance to zero; both need a reason and write an audit entry. */
  adjustPoints(memberId: string, requestId: string, change: { delta: number } | { reset: true }, reason: string): Promise<Member>;

  // ----- Roster (#126) and import (#125)
  listRoster(): Promise<RosterRow[]>;
  resendInvite(email: string): Promise<RosterRow>;
  revokeInvite(email: string): Promise<RosterRow>;
  /** Dry run: validates and plans one chunk without writing anything. */
  planImportChunk(request: ImportChunkRequest): Promise<PlanRow[]>;
  /** Executes one previously planned chunk; retrying the same chunk is a no-op that returns the same result. */
  applyImportChunk(jobId: string, chunkIndex: number): Promise<ApplyRowResult[]>;

  // ----- Audit (#121)
  listAudit(): Promise<AuditEntry[]>;
}
