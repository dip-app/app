import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { routedPushNotifier } from "../../notifications/transport/routedPush";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { addEventAttendee, recordAttendance, removeEventAttendee } from "../application/attendees";
import { applyEmployeeImport, getEmployeeImport, importEmployees } from "../application/importEmployees";
import {
  adjustMemberPoints, getMember, listMembers, resetMemberProfile, setMemberStatus, updateMember, upsertTeam,
} from "../application/members";
import { getBugReport, listBugReports, updateBugReport } from "../application/bugReports";
import { getCompanyInsights } from "../application/insights";
import { removeEventPhoto, removeEventPhotoComment } from "../application/moderation";
import type { AdminDeps, Caller } from "../application/ports";
import { backfillRosterCallable } from "../application/backfillRoster";
import { listRoster, resendRosterInvite, revokeRosterEntry, upsertRosterEntry } from "../application/roster";
import { AdminError, errorDiagnostics } from "../domain/errors";
import {
  AuthSessions, FirestoreAdminRateLimiter, FirestoreAdminStore, randomId, StorageObjects,
} from "../infrastructure/firestoreAdminStore";

const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/** Maps domain failures to callable errors with `{ reason, fields? }` details and no internals. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof AdminError) {
    const details = { reason: error.reason, ...(error.fields.length > 0 ? { fields: [...error.fields] } : {}), ...error.details };
    return new HttpsError(error.code, error.code === "internal" ? GENERIC_INTERNAL_MESSAGE : error.message, details);
  }
  return new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
}

type Command<T> = (deps: AdminDeps, caller: Caller | null, data: unknown) => Promise<T>;

/** Runs one command and maps failures; payloads, tokens and profiles are never logged. */
export async function handleAdminCommand<T>(name: string, command: Command<T>, deps: AdminDeps, request: Pick<CallableRequest, "auth" | "data">): Promise<T> {
  try {
    return await command(deps, callerFromRequest(request), request.data);
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      // The caller sees a generic message; the log carries the underlying code, message and any index link.
      logger.error(`${name} failed`, {
        uid: request.auth?.uid ?? null, reason: error instanceof AdminError ? error.reason : "UNEXPECTED", ...errorDiagnostics(error),
      });
    }
    throw httpsError;
  }
}

function defaultDeps(): AdminDeps {
  const app = defaultAdminApp();
  const db = getFirestore(app);
  return {
    store: new FirestoreAdminStore(db), objects: new StorageObjects(getStorage(app)), sessions: new AuthSessions(app),
    limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(), newId: randomId, pushes: routedPushNotifier(app),
  };
}

// Production requires App Check; only the official Functions emulator bypasses it.
// Instance caps bound cost and Firestore fan-out from a compromised or abusive admin account.
const base = {
  region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true", maxInstances: 10, timeoutSeconds: 60, memory: "256MiB",
} as const;
const heavy = { ...base, maxInstances: 3, timeoutSeconds: 300, memory: "512MiB" } as const;
type Handler<T> = (request: CallableRequest) => Promise<T>;

/**
 * The callable handlers, one per command. Each standalone export below and the `dipApiV1` dispatcher
 * (modules/dispatcher) reference the same function, so there is no second copy of auth, validation or error mapping.
 * Tests pass fake deps through `adminHandlers(() => deps)`.
 */
export function adminHandlers(deps: () => AdminDeps = defaultDeps) {
  const command = <T>(name: string, run: Command<T>): Handler<T> => (request) => handleAdminCommand(name, run, deps(), request);
  return {
    removeEventPhotoV1: command("removeEventPhotoV1", removeEventPhoto),
    removeEventPhotoCommentV1: command("removeEventPhotoCommentV1", removeEventPhotoComment),
    addEventAttendeeV1: command("addEventAttendeeV1", addEventAttendee),
    removeEventAttendeeV1: command("removeEventAttendeeV1", removeEventAttendee),
    recordAttendanceV1: command("recordAttendanceV1", recordAttendance),
    listMembersV1: command("listMembersV1", listMembers),
    getMemberV1: command("getMemberV1", getMember),
    updateMemberV1: command("updateMemberV1", updateMember),
    resetMemberProfileV1: command("resetMemberProfileV1", resetMemberProfile),
    setMemberStatusV1: command("setMemberStatusV1", setMemberStatus),
    adjustMemberPointsV1: command("adjustMemberPointsV1", adjustMemberPoints),
    upsertTeamV1: command("upsertTeamV1", upsertTeam),
    upsertRosterEntryV1: command("upsertRosterEntryV1", upsertRosterEntry),
    revokeRosterEntryV1: command("revokeRosterEntryV1", revokeRosterEntry),
    resendRosterInviteV1: command("resendRosterInviteV1", resendRosterInvite),
    listRosterV1: command("listRosterV1", listRoster),
    backfillRosterV1: command("backfillRosterV1", backfillRosterCallable),
    importEmployeesV1: command("importEmployeesV1", importEmployees),
    applyEmployeeImportV1: command("applyEmployeeImportV1", applyEmployeeImport),
    getEmployeeImportV1: command("getEmployeeImportV1", getEmployeeImport),
    listBugReportsV1: command("listBugReportsV1", listBugReports),
    getBugReportV1: command("getBugReportV1", getBugReport),
    updateBugReportV1: command("updateBugReportV1", updateBugReport),
    getCompanyInsightsV1: command("getCompanyInsightsV1", getCompanyInsights),
  } as const;
}
export type AdminHandlers = ReturnType<typeof adminHandlers>;

/** Production handlers (real Firestore/Storage/Auth deps, built per request as before). */
export const adminCommands: AdminHandlers = adminHandlers();

export const removeEventPhotoV1 = onCall(base, adminCommands.removeEventPhotoV1);
export const removeEventPhotoCommentV1 = onCall(base, adminCommands.removeEventPhotoCommentV1);
export const addEventAttendeeV1 = onCall(base, adminCommands.addEventAttendeeV1);
export const removeEventAttendeeV1 = onCall(base, adminCommands.removeEventAttendeeV1);
export const recordAttendanceV1 = onCall(base, adminCommands.recordAttendanceV1);
export const listMembersV1 = onCall(base, adminCommands.listMembersV1);
export const getMemberV1 = onCall(base, adminCommands.getMemberV1);
export const updateMemberV1 = onCall(base, adminCommands.updateMemberV1);
export const resetMemberProfileV1 = onCall(base, adminCommands.resetMemberProfileV1);
export const setMemberStatusV1 = onCall(heavy, adminCommands.setMemberStatusV1);
export const adjustMemberPointsV1 = onCall(base, adminCommands.adjustMemberPointsV1);
export const upsertTeamV1 = onCall(base, adminCommands.upsertTeamV1);
export const upsertRosterEntryV1 = onCall(base, adminCommands.upsertRosterEntryV1);
export const revokeRosterEntryV1 = onCall(base, adminCommands.revokeRosterEntryV1);
export const resendRosterInviteV1 = onCall(base, adminCommands.resendRosterInviteV1);
export const listRosterV1 = onCall(base, adminCommands.listRosterV1);
export const backfillRosterV1 = onCall(heavy, adminCommands.backfillRosterV1);
export const importEmployeesV1 = onCall(heavy, adminCommands.importEmployeesV1);
export const applyEmployeeImportV1 = onCall(heavy, adminCommands.applyEmployeeImportV1);
export const getEmployeeImportV1 = onCall(base, adminCommands.getEmployeeImportV1);
export const listBugReportsV1 = onCall(base, adminCommands.listBugReportsV1);
export const getBugReportV1 = onCall(base, adminCommands.getBugReportV1);
export const updateBugReportV1 = onCall(base, adminCommands.updateBugReportV1);
export const getCompanyInsightsV1 = onCall(base, adminCommands.getCompanyInsightsV1);
