// Types, permissions and callable names for the admin tools (members, roster, import, albums, attendees,
// audit). They follow the tickets #121-#126 and are adapted to docs/contracts/admin.md; every callable name
// lives in ADMIN_CALLABLES so a rename in the spec is a one-line change.

import { t } from "./i18n";

export type Role = "member" | "organizer" | "admin";
export type MemberStatus = "invited" | "active" | "deactivated";

/** Actions the portal gates in the UI. The backend enforces the same matrix; this is only a convenience. */
export type Capability =
  | "events.manage" | "themes.manage" | "albums.moderate" | "attendees.manage"
  | "members.view" | "members.edit" | "members.status" | "members.reset" | "points.adjust"
  | "import.run" | "roster.manage" | "audit.view" | "challenges.review" | "bugreports.manage"
  | "insights.view" | "insights.points" | "ai.generate";

const ORGANIZER_CAPS: readonly Capability[] = ["insights.view", "events.manage", "albums.moderate", "attendees.manage", "members.view"];
const ADMIN_CAPS: readonly Capability[] = [
  ...ORGANIZER_CAPS, "themes.manage", "challenges.review", "members.edit", "members.status", "members.reset", "points.adjust",
  "import.run", "roster.manage", "audit.view", "bugreports.manage", "insights.points", "ai.generate",
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
/** Display names for roles in the current language (getters, so module-level use still follows a language change). */
export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  get member() { return t("common.role.member"); },
  get organizer() { return t("common.role.organizer"); },
  get admin() { return t("common.role.admin"); },
};

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
  resendRosterInvite: "resendRosterInviteV1",
  listRoster: "listRosterV1",
  backfillRoster: "backfillRosterV1",
  planImport: "importEmployeesV1",
  applyImport: "applyEmployeeImportV1",
  getImport: "getEmployeeImportV1",
  listSubmissions: "listChallengeSubmissionsV1",
  approveSubmission: "approveChallengeV1",
  rejectSubmission: "rejectChallengeV1",
  getInsights: "getCompanyInsightsV1",
  listBugReports: "listBugReportsV1",
  getBugReport: "getBugReportV1",
  updateBugReport: "updateBugReportV1",
  eventIdeaContext: "getEventIdeaContextV1",
  generateEventDrafts: "generateEventDraftsV1",
  eventIdeaSuggestions: "getEventIdeaSuggestionsV1",
  pickEventCover: "pickEventCoverV1",
  searchCoverPhotos: "searchCoverPhotosV1",
  importCoverPhoto: "importCoverPhotoV1",
  findVenues: "findVenuesV1",
  autocompletePlaces: "autocompletePlacesV1",
  resolvePlace: "resolvePlaceV1",
  setCompanyOffice: "setCompanyOfficeV1",
  dipbotIdeas: "getDipbotIdeasV1",
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
  /** Google profile photo (size-less base URL, set by the server at sign-in); empty when none. Rendered with a size suffix by Avatar. */
  photoURL: string;
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
  /** The claiming member's stored photo and avatar id (the server joins them for claimed entries only); absent for invited people. */
  photoURL?: string;
  avatarId?: string;
  invitedAt: string;
  /** How many times an admin resent the invite message, and when last. */
  resendCount?: number;
  lastResentAt?: string;
}

/** Page size of the people lists (the server allows up to 100). */
export const LIST_PAGE_SIZE = 25;

export interface MemberQuery { query: string; status: MemberStatus | "all"; role: Role | "all"; teamId: string; workLocation: string }
export interface MemberPage {
  members: Member[];
  /** Pass back to read the next page; null when everything was scanned. A page can be short while more follow. */
  nextCursor: string | null;
  /** All members of the company (first page only). */
  total: number | null;
}

export type RosterState = RosterRow["state"];
export interface RosterQuery { query: string; state: RosterState | "all" }
export interface RosterCounts { all: number; invited: number; active: number; deactivated: number; revoked: number }
export interface RosterPage { rows: RosterRow[]; nextCursor: string | null; /** First page only. */ counts: RosterCounts | null }

/** resendRosterInviteV1: DIP sends no email, so a resend records the event and returns a message for the admin to share. */
export interface ResendResult { resendCount: number; lastResentAt: string; signInUrl: string; message: string }

/** One chunk of backfillRosterV1 (`created` is "would create" in a dry run). */
export interface BackfillStep { dryRun: boolean; scanned: number; created: number; existing: number; skipped: number; nextCursor: string | null; done: boolean }

/** getEmployeeImportV1, for resuming an import after a reload. */
export interface ImportJobInfo {
  jobId: string;
  status: ApplyStepResponse["status"];
  chunkCount: number;
  nextChunk: number;
  progress: ImportProgress;
  planHash: string;
  fileName: string;
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
  /** From the RSVP profile snapshot or the member list; either may be empty (real accounts start with neither). */
  photoURL?: string;
  avatarId?: string;
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
  targetType: "member" | "event" | "photo" | "comment" | "attendee" | "roster" | "import" | "team" | "company" | "points" | "bugReport";
  targetId: string;
  summary: string;
  reason?: string;
  changes: { field: string; before: string; after: string }[];
}

// Action labels live in auditLabels.ts.

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
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = { submitted: "Pending", rejected: "Changes requested", approved: "Approved" };

export interface Submission {
  /** `{challengeId}_{userId}` */
  id: string;
  challengeId: string;
  userId: string;
  userName: string;
  photoURL?: string;
  avatarId?: string;
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

// ----- Company insights (getCompanyInsightsV1, docs/contracts/admin.md, "Company insights")
export interface InsightsDay { date: string; rsvps: number; photos: number }
export interface InsightsEvent { eventId: string; title: string; startTime: string; attendeeCount: number; capacity: number; status: "scheduled" | "completed" }
export interface InsightsTheme {
  challengeId: string; title: string; /** `catalog://theme/<key>`: picks the bundled illustration (optional). */ coverImageURL?: string; startDate: string; endDate: string; participantCount: number; completedCount: number; pendingReviews: number;
}
/** Submissions still waiting for review on one challenge (reviews stay open after the week ends). */
export interface OpenReview { challengeId: string; title: string; startDate: string; endDate: string; count: number }
/** Overview sections the server can report as unavailable (a failed query; the rest of the page still renders). */
export const INSIGHTS_SECTIONS = ["members", "events", "participation", "content", "challenges", "points", "activity"] as const;
export type InsightsSection = (typeof INSIGHTS_SECTIONS)[number];
export interface CompanyInsights {
  /** When the numbers were computed (the server caches them for up to 10 minutes). */
  generatedAt: string;
  windowDays: number;
  members: { total: number; active: number; deactivated: number; invited: number; activeLast30Days: number; activeCapped: boolean };
  events: { upcoming: number; thisMonth: number; completed: number; cancelled: number };
  participation: { rsvpsLast30Days: number; attendanceRate: number | null; attendanceSample: number; topEvents: InsightsEvent[] };
  content: { photosLast30Days: number; commentsLast30Days: number };
  /** `pendingReviews` is every open submission; `current.pendingReviews` only this week's. `openReviews` splits the total per challenge when the server sends it. */
  challenges: { pendingReviews: number; current: InsightsTheme | null; openReviews?: OpenReview[] };
  /** Admins only; null for organizers (the backend never sends it to them). */
  points: { issuedLast30Days: number; topMembers: { userId: string; displayName: string; pointsBalance: number; photoURL?: string; avatarId?: string }[] } | null;
  /** The last 30 UTC days, oldest first. */
  activity: InsightsDay[];
  /** Sections whose numbers could not be computed this time: show "unavailable", never their placeholder zeros. */
  unavailable: InsightsSection[];
}

// ---------- Bug reports (shake-to-report inbox, docs/contracts/admin.md#bug-reports-inbox-bugreportmanage-admin-only)

export type BugStatus = "new" | "triaged" | "resolved";
export type BugCategory = "bug" | "confusing" | "looksWrong" | "idea" | "unspecified";

export interface BugDiagnostics {
  appVersion?: string; appBuild?: string; osVersion?: string; deviceModel?: string; locale?: string; screen?: string; installId?: string;
}

export interface BugReport {
  id: string;
  category: BugCategory;
  description: string;
  source: "shake" | "profile";
  /** Screen the member was on (home, rewards, event, ...). */
  screen: string;
  createdAt: string;
  reporterId: string;
  reporterName: string;
  reporterPhotoURL?: string;
  reporterAvatarId?: string;
  appVersion?: string;
  hasScreenshot: boolean;
  status: BugStatus;
  hasNote: boolean;
  assigneeId?: string;
  assigneeName?: string;
}

export interface BugReportQuery { query: string; status: BugStatus | "all"; category: BugCategory | "all"; from: string; to: string }
/** Counts per status over the newest reports of the first page; `capped` when older reports were not counted. */
export interface BugReportCounts { all: number; new: number; triaged: number; resolved: number; capped: boolean }
export interface BugReportPage { reports: BugReport[]; nextCursor: string | null; counts: BugReportCounts | null }

export interface BugReportDetail {
  report: BugReport;
  reporterEmail: string;
  diagnostics: BugDiagnostics | null;
  /** Short-lived signed URL (15 minutes) or a data: URL; null without a screenshot. */
  screenshotUrl: string | null;
  note: string;
  revision: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface BugReportPatch { status?: BugStatus; note?: string; /** null clears the assignee. */ assigneeId?: string | null }
export interface BugReportUpdate { status: BugStatus; note: string; assigneeId: string | null; assigneeName: string | null; revision: number; updatedAt: string; changed: boolean }

// ---------- AI event ideas (docs/design/stretch/ai-event-creation.md). Mirrors the server contract types
// AiInterestTag, AiUsageSummary, GetEventIdeaContextResponse, AiEventChoices and GeneratedEventDraft.

export type AiBucket = "5-9" | "10-19" | "20+";
export interface AiInterestTag { tagId: string; bucket: AiBucket }
export interface AiIdeaTheme { title: string; tagIds: string[] }
export interface AiUsage {
  monthlyGenerationLimit: number;
  monthlyGenerationsUsed: number;
  dailyGenerationLimit: number;
  dailyGenerationsUsed: number;
  generationsRemaining: number;
}
/** Dipbot credits: the only unit the portal shows for AI use (a fixed price per tool, never a currency amount). */
export interface AiCredits {
  creditsAllowance: number;
  creditsUsed: number;
  creditsRemaining: number;
  /** ISO instant the allowance resets (start of next month in the company's time zone). */
  resetsAt: string;
  creditCost: { suggest: number; generate: number; regenerate: number; weeklyEmail: number; coverPick: number; venueSearch?: number; ideas?: number };
}
export interface EventIdeaContext {
  enabled: boolean;
  interestDataAvailable: boolean;
  topInterests: AiInterestTag[];
  thinInterestTagIds: string[];
  currentTheme?: AiIdeaTheme;
  usage: AiUsage;
  credits: AiCredits;
}

export type AiGoal = "team_bonding" | "wellness" | "learning" | "give_back" | "celebrate" | "competition";
export type AiGroupSize = "small" | "team" | "company";
export type AiSetting = "indoors" | "outdoors" | "offsite";
export type AiBudget = "free" | "under_15" | "from_15_to_50" | "over_50";
export type AiTiming = "weekday_lunch" | "after_work" | "weekend";
export interface AiEventChoices {
  focusTagIds: string[];
  goal: AiGoal;
  groupSize: AiGroupSize;
  setting: AiSetting;
  budget: AiBudget;
  timing: AiTiming;
}

export type AiDaypart = "weekday_morning" | "weekday_lunch" | "weekday_afternoon" | "after_work" | "weekend_daytime" | "weekend_evening";
export type AiVenueType = "office" | "park_or_outdoors" | "restaurant_or_cafe" | "activity_venue" | "community_site";
export interface GeneratedEventDraft {
  title: string;
  description: string;
  tagIds: string[];
  coverImageURL: string;
  suggestedDaypart: AiDaypart;
  durationMinutes: number;
  venueType: AiVenueType;
  venueSearchHint: string;
  costCents: number;
  costNote: string;
  capacity: number;
  isOutdoor: boolean;
  rationale: string;
}
/** getEventIdeaSuggestionsV1: the option the decision model ranks first for each choice (a hint, never a selection). */
export type AiSuggestionQuestion = "interest" | "goal" | "groupSize" | "setting" | "budget" | "timing";
export type AiSuggestionProvider = "jev" | "openai" | "heuristic" | "none";
/** `reasonBasis`: "company_data" when the company\u2019s own data drove it; "generic" reasons never imply personalization. */
export interface AiStepSuggestion { question: AiSuggestionQuestion; value: string; probability: number; reason: string; reasonBasis: "company_data" | "generic" }
/** fresh: saved answer, inputs unchanged. stale: saved answer shown as is (nothing recomputed). computed: this call ran the model (or the free heuristic). */
export type AiCacheStatus = "fresh" | "stale" | "computed";
/** One consideration chip (catalog id) with its relevance for this company; the list holds every consideration, best first. */
export interface AiConsiderationRank { id: string; probability: number }
export interface EventIdeaSuggestions {
  provider: AiSuggestionProvider; suggestions: AiStepSuggestion[]; credits?: AiCredits;
  cacheStatus: AiCacheStatus; /** ISO time the saved answer was computed. */ computedAt?: string; staleReason?: "data" | "age";
  /** Credits this call charged: 0 for every cached load. */ creditsCharged: number; considerations: AiConsiderationRank[];
}
/** `refresh` recomputes the saved suggestions (1 credit). Only an explicit button press sends it. */
export interface EventIdeaSuggestionsInput { refresh?: boolean; requestId?: string }
export interface GenerateDraftsInput { requestId: string; choices: AiEventChoices; prompt: string; count: number; considerations?: string[] }
export interface GenerateDraftsResult { drafts: GeneratedEventDraft[]; usage: AiUsage; credits: AiCredits; replay: boolean }

// ---------- Ideas for you (docs/design/stretch/dipbot-daily-ideas.md). Mirrors GetDipbotIdeasRequest/Response and DipbotIdea.

export type DipbotIdeaMode = "load" | "auto" | "refresh";
export type DipbotTheme = "fitness" | "outdoors" | "food" | "arts" | "games" | "music" | "learning" | "volunteering" | "wellness";
export type DipbotFitLabel = "perfect" | "great" | "good";
export interface DipbotIdea {
  id: string;
  title: string;
  description: string;
  theme: DipbotTheme;
  tagIds: string[];
  /** One line grounded in the company's own numbers (or generic when `reasonBasis` is "generic"). */
  why: string;
  reasonBasis: "company_data" | "generic";
  fitLabel?: DipbotFitLabel;
  /** 0 to 6 (Sunday = 0). */
  weekday: number;
  daypart: AiDaypart;
  startsAt: string;
  durationMinutes: number;
  costBucket: AiBudget;
  groupSize: AiGroupSize;
  considerationIds: string[];
  coverImageURL: string;
  choices: AiEventChoices;
  draft: GeneratedEventDraft;
  source: "agent" | "catalog";
}
export type DipbotIdeasStatus = "fresh" | "stale" | "computed" | "fallback";
export interface DipbotIdeas {
  enabled: boolean;
  ideas: DipbotIdea[];
  status: DipbotIdeasStatus;
  generatedAt?: string;
  dataLevel: "none" | "some" | "rich";
  autoRefreshDue: boolean;
  refreshesLeftToday: number;
  outcome?: "updated" | "unchanged" | "extended" | "skipped" | "failed";
  credits: AiCredits;
  creditsCharged: number;
}
/** `load` never spends credits; `auto` is the one background call per page load; `refresh` is the button (needs a requestId). */
export interface DipbotIdeasInput { mode: DipbotIdeaMode; requestId?: string }
