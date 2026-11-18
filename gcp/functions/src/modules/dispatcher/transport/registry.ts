import type { CallableRequest } from "firebase-functions/v2/https";
import type { AdminHandlers } from "../../admin/transport/adminCallables";

/**
 * Command registry of the `dipApiV1` dispatcher (docs/design/functions-dispatcher.md).
 *
 * One row per command. `handler` is the SAME function the standalone callable of that name passes to `onCall`, so
 * auth, tenant isolation (the handler compares the payload companyId with the caller's server-owned membership),
 * validation, rate limiting, idempotency receipts, audit entries and error mapping are identical by construction.
 * The other fields describe what that handler already enforces; the dispatcher does not re-implement them. Tests
 * check them against the handlers (role) and the contract (request schema).
 *
 * Adding a command: export its handler from the module's transport file, then add one row below. Keep commands
 * that bind secrets, need more than 60 s or 512 MiB, or call a model (Dipbot, covers, email) out of this table.
 */
export type CommandHandler = (request: CallableRequest) => Promise<unknown>;

/** Lowest membership role the handler accepts (`organizer` also admits admins). */
export type MinRole = "organizer" | "admin";

/**
 * The limiter the handler consults. Limits are keyed by uid (and company for places) in Firestore, not by
 * transport, so a dispatched call and a standalone call draw from the same budget.
 */
export type RateLimit =
  | "adminRateLimits/{uid}"
  | "placesRateLimits/{uid} + company daily cap"
  | "none (idempotency receipts only)";

export interface CommandSpec {
  readonly handler: CommandHandler;
  readonly minRole: MinRole;
  readonly rateLimit: RateLimit;
  /** `$defs` entry in contracts/v1/models.schema.json; the handler's own parser validates it. */
  readonly request: string;
  /** Writes state. Mutating admin commands carry a requestId or expectedRevision, so a client retry is safe. */
  readonly mutating: boolean;
}

/** The production handler sets the registry is built from (tests pass fakes with the same shape). */
export interface HandlerSets {
  admin: Pick<AdminHandlers, AdminCommand>;
  organizer: { createEventV1: CommandHandler; updateEventV1: CommandHandler };
  challenges: { createChallengeV1: CommandHandler; updateChallengeV1: CommandHandler };
  submissions: { approveChallengeV1: CommandHandler; rejectChallengeV1: CommandHandler; listChallengeSubmissionsV1: CommandHandler };
  places: { autocompletePlacesV1: CommandHandler; resolvePlaceV1: CommandHandler; setCompanyOfficeV1: CommandHandler };
}

/** Admin commands served by the dispatcher. setMemberStatus, backfill and import stay standalone (300 s timeout). */
export type AdminCommand =
  | "removeEventPhotoV1" | "removeEventPhotoCommentV1" | "addEventAttendeeV1" | "removeEventAttendeeV1" | "recordAttendanceV1"
  | "listMembersV1" | "getMemberV1" | "updateMemberV1" | "resetMemberProfileV1" | "adjustMemberPointsV1"
  | "upsertRosterEntryV1" | "revokeRosterEntryV1" | "resendRosterInviteV1" | "listRosterV1" | "getEmployeeImportV1"
  | "listBugReportsV1" | "getBugReportV1" | "updateBugReportV1" | "getCompanyInsightsV1";

const ADMIN_RL: RateLimit = "adminRateLimits/{uid}";
const PLACES_RL: RateLimit = "placesRateLimits/{uid} + company daily cap";
const NO_RL: RateLimit = "none (idempotency receipts only)";

/** The table. Command names equal the standalone export names, so a client switches transport without renaming. */
export function commandTable(h: HandlerSets) {
  const a = h.admin;
  return {
    // Album moderation and attendees (organizer or admin).
    removeEventPhotoV1: { handler: a.removeEventPhotoV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "RemoveEventPhotoRequest", mutating: true },
    removeEventPhotoCommentV1: { handler: a.removeEventPhotoCommentV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "RemoveEventPhotoCommentRequest", mutating: true },
    addEventAttendeeV1: { handler: a.addEventAttendeeV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "AddEventAttendeeRequest", mutating: true },
    removeEventAttendeeV1: { handler: a.removeEventAttendeeV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "RemoveEventAttendeeRequest", mutating: true },
    recordAttendanceV1: { handler: a.recordAttendanceV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "RecordAttendanceRequest", mutating: true },
    // Members (upsertTeamV1 has no portal caller yet, so it is not registered).
    listMembersV1: { handler: a.listMembersV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "ListMembersRequest", mutating: false },
    getMemberV1: { handler: a.getMemberV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "GetMemberRequest", mutating: false },
    updateMemberV1: { handler: a.updateMemberV1, minRole: "admin", rateLimit: ADMIN_RL, request: "UpdateMemberRequest", mutating: true },
    resetMemberProfileV1: { handler: a.resetMemberProfileV1, minRole: "admin", rateLimit: ADMIN_RL, request: "ResetMemberProfileRequest", mutating: true },
    adjustMemberPointsV1: { handler: a.adjustMemberPointsV1, minRole: "admin", rateLimit: ADMIN_RL, request: "AdjustMemberPointsRequest", mutating: true },
    // Roster and the import job read.
    upsertRosterEntryV1: { handler: a.upsertRosterEntryV1, minRole: "admin", rateLimit: ADMIN_RL, request: "UpsertRosterEntryRequest", mutating: true },
    revokeRosterEntryV1: { handler: a.revokeRosterEntryV1, minRole: "admin", rateLimit: ADMIN_RL, request: "RevokeRosterEntryRequest", mutating: true },
    resendRosterInviteV1: { handler: a.resendRosterInviteV1, minRole: "admin", rateLimit: ADMIN_RL, request: "ResendRosterInviteRequest", mutating: true },
    listRosterV1: { handler: a.listRosterV1, minRole: "admin", rateLimit: ADMIN_RL, request: "ListRosterRequest", mutating: false },
    getEmployeeImportV1: { handler: a.getEmployeeImportV1, minRole: "admin", rateLimit: ADMIN_RL, request: "GetEmployeeImportRequest", mutating: false },
    // Bug reports and insights.
    listBugReportsV1: { handler: a.listBugReportsV1, minRole: "admin", rateLimit: ADMIN_RL, request: "ListBugReportsRequest", mutating: false },
    getBugReportV1: { handler: a.getBugReportV1, minRole: "admin", rateLimit: ADMIN_RL, request: "GetBugReportRequest", mutating: false },
    updateBugReportV1: { handler: a.updateBugReportV1, minRole: "admin", rateLimit: ADMIN_RL, request: "UpdateBugReportRequest", mutating: true },
    getCompanyInsightsV1: { handler: a.getCompanyInsightsV1, minRole: "organizer", rateLimit: ADMIN_RL, request: "GetCompanyInsightsRequest", mutating: false },
    // Events and weekly themes.
    createEventV1: { handler: h.organizer.createEventV1, minRole: "organizer", rateLimit: NO_RL, request: "CreateEventRequest", mutating: true },
    updateEventV1: { handler: h.organizer.updateEventV1, minRole: "organizer", rateLimit: NO_RL, request: "UpdateEventRequest", mutating: true },
    createChallengeV1: { handler: h.challenges.createChallengeV1, minRole: "admin", rateLimit: NO_RL, request: "CreateChallengeRequest", mutating: true },
    updateChallengeV1: { handler: h.challenges.updateChallengeV1, minRole: "admin", rateLimit: NO_RL, request: "UpdateChallengeRequest", mutating: true },
    // Challenge submission review.
    listChallengeSubmissionsV1: { handler: h.submissions.listChallengeSubmissionsV1, minRole: "admin", rateLimit: NO_RL, request: "ListChallengeSubmissionsRequest", mutating: false },
    approveChallengeV1: { handler: h.submissions.approveChallengeV1, minRole: "admin", rateLimit: NO_RL, request: "ApproveChallengeRequest", mutating: true },
    rejectChallengeV1: { handler: h.submissions.rejectChallengeV1, minRole: "admin", rateLimit: NO_RL, request: "RejectChallengeRequest", mutating: true },
    // Cheap place lookups (no secrets, no model).
    autocompletePlacesV1: { handler: h.places.autocompletePlacesV1, minRole: "organizer", rateLimit: PLACES_RL, request: "AutocompletePlacesRequest", mutating: false },
    resolvePlaceV1: { handler: h.places.resolvePlaceV1, minRole: "organizer", rateLimit: PLACES_RL, request: "ResolvePlaceRequest", mutating: false },
    setCompanyOfficeV1: { handler: h.places.setCompanyOfficeV1, minRole: "admin", rateLimit: PLACES_RL, request: "SetCompanyOfficeRequest", mutating: true },
  } as const satisfies Record<string, CommandSpec>;
}

export type CommandName = keyof ReturnType<typeof commandTable>;
export type CommandRegistry = ReadonlyMap<string, CommandSpec>;

/** A Map, so lookups never reach Object.prototype (`toString`, `constructor`). */
export function buildRegistry(h: HandlerSets): CommandRegistry {
  return new Map<string, CommandSpec>(Object.entries(commandTable(h)));
}
