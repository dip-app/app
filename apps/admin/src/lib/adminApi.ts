import type {
  AddAttendeeInput, AlbumComment, AlbumPhoto, ApplyStepResponse, Attendee, AuditEntry, CompanyInfo,
  BackfillStep, ImportJobInfo, ImportPlanRequest, ImportPlanResponse, Member, MemberPage, MemberPatch, MemberQuery, MemberStatus, ResendResult,
  CompanyInsights, BugReportDetail, BugReportPage, BugReportPatch, BugReportQuery, BugReportUpdate,
  DipbotIdeas, DipbotIdeasInput, EventIdeaContext, EventIdeaSuggestions, EventIdeaSuggestionsInput, GenerateDraftsInput, GenerateDraftsResult, RosterPage, RosterQuery, RosterRow, Submission, SubmissionPage, SubmissionStatus,
} from "./adminTypes";
import type { ImportCoverPhotoResult, PickEventCoverInput, PickEventCoverResult, SearchCoverPhotosResult } from "./covers";
import type { TagStat } from "./tagStats";
import type { PlaceSuggestion, ResolveRequest, ResolvedPlace } from "./location/types";
import type { CompanyOffice, FindVenuesInput, FindVenuesResult } from "./venues";

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

  // ----- Bug reports inbox (admins only; listBugReportsV1, getBugReportV1, updateBugReportV1)
  /** One page of reports, newest first, with filters. The first page carries counts per status (also used for the sidebar badge). */
  listBugReports(query: BugReportQuery, cursor?: string | null, pageSize?: number): Promise<BugReportPage>;
  /** Full detail with the reporter's email, diagnostics, triage state and a 15 minute screenshot URL. */
  getBugReport(reportId: string): Promise<BugReportDetail>;
  /** Sets status, internal note and/or assignee; `expectedRevision` is the detail's revision (REVISION_CONFLICT if someone else saved). */
  updateBugReport(reportId: string, patch: BugReportPatch, expectedRevision: number): Promise<BugReportUpdate>;

  // ----- Insights
  /** getCompanyInsightsV1: usage overview for the company. `refresh` asks the server to bypass its 10-minute cache (honored at most once a minute). */
  companyInsights(refresh?: boolean): Promise<CompanyInsights>;

  // ----- Tag interest counts (TAG-5)
  /** `companies/{companyId}/tagStats`: member counts per interest tag. [] when the company has none yet; null when the role can't read them (counts are then hidden). */
  tagStats(): Promise<TagStat[] | null>;

  // ----- AI event ideas (admins only; getEventIdeaContextV1, generateEventDraftsV1)
  /** Interest buckets, the running weekly theme and the remaining AI quota. `enabled` is false when the company has AI event ideas off. */
  eventIdeaContext(): Promise<EventIdeaContext>;
  /** Returns up to `count` drafts for review; nothing is written to events. Retrying with the same `requestId` replays the stored result without spending quota. */
  generateEventDrafts(input: GenerateDraftsInput): Promise<GenerateDraftsResult>;
  /** getEventIdeaSuggestionsV1: per-step suggestions (Jev, then the OpenAI fallback, then a heuristic). One call per `sessionId`, cached by the server. */
  eventIdeaSuggestions(input?: EventIdeaSuggestionsInput): Promise<EventIdeaSuggestions>;
  /** pickEventCoverV1: Dipbot picks a cover from the library for the event text. Nothing is stored; the form applies the result. */
  pickEventCover(input: PickEventCoverInput): Promise<PickEventCoverResult>;
  /** searchCoverPhotosV1: "Search more photos". Free; returns up to 12 temporary Pixabay previews or a polite status. Nothing is stored. */
  searchCoverPhotos(query: string): Promise<SearchCoverPhotosResult>;
  /** importCoverPhotoV1: stores a photo from a recent search (by key only) as a dynamic cover and returns its catalog URL. Free. */
  importCoverPhoto(key: string): Promise<ImportCoverPhotoResult>;

  // ----- Smart location (admins only; findVenuesV1, setCompanyOfficeV1)
  /** The company office (`companies/{companyId}`); null when it is not set (missing, or 0/0). */
  companyOffice(): Promise<CompanyOffice | null>;
  /** setCompanyOfficeV1: saves the office the venue search starts from; the server resolves the place. */
  setCompanyOffice(request: { placeId: string; sessionToken?: string }): Promise<CompanyOffice>;
  /** autocompletePlacesV1: up to 5 typeahead rows for the input (shown only, never stored). */
  autocompletePlaces(input: string, sessionToken: string): Promise<PlaceSuggestion[]>;
  /** resolvePlaceV1: a pick (placeId + session token) or a free-typed address (query). Null when not found. */
  resolvePlace(request: ResolveRequest): Promise<ResolvedPlace | null>;
  /** findVenuesV1: Dipbot finds venues near the office for the event. 1 credit unless saved results are reused. Nothing is stored on the event. */
  findVenues(input: FindVenuesInput): Promise<FindVenuesResult>;

  /** getDipbotIdeasV1: "Ideas for you". `load` returns the stored ideas (free), `auto` the one background refresh, `refresh` the button (3 credits). */
  dipbotIdeas(input: DipbotIdeasInput): Promise<DipbotIdeas>;

  // ----- Audit (#121)
  listAudit(): Promise<AuditEntry[]>;

  // ----- Language (#259)
  /** setMyLocaleV1: saves the signed-in member's language on the server. Mock mode keeps it in this browser only (no-op). */
  setMyLocale(locale: "en" | "es"): Promise<void>;
}
