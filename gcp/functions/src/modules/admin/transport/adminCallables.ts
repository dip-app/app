import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { addEventAttendee, recordAttendance, removeEventAttendee } from "../application/attendees";
import { applyEmployeeImport, getEmployeeImport, importEmployees } from "../application/importEmployees";
import {
  adjustMemberPoints, getMember, listMembers, resetMemberProfile, setMemberStatus, updateMember, upsertTeam,
} from "../application/members";
import { removeEventPhoto, removeEventPhotoComment } from "../application/moderation";
import type { AdminDeps, Caller } from "../application/ports";
import { backfillRosterCallable } from "../application/backfillRoster";
import { listRoster, resendRosterInvite, revokeRosterEntry, upsertRosterEntry } from "../application/roster";
import { AdminError } from "../domain/errors";
import {
  AuthSessions, FirestoreAdminRateLimiter, FirestoreAdminStore, randomId, StorageObjects,
} from "../infrastructure/firestoreAdminStore";

const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/** Maps domain failures to callable errors with `{ reason, fields? }` details and no internals. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof AdminError) {
    const details = error.fields.length > 0 ? { reason: error.reason, fields: [...error.fields] } : { reason: error.reason };
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
      logger.error(`${name} failed`, {
        uid: request.auth?.uid ?? null, reason: error instanceof AdminError ? error.reason : "UNEXPECTED", error: error instanceof Error ? error.name : "unknown",
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
    limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(), newId: randomId,
  };
}

// Production requires App Check; only the official Functions emulator bypasses it.
const base = { region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;
const heavy = { ...base, timeoutSeconds: 300, memory: "512MiB" } as const;
const command = <T>(name: string, run: Command<T>) => (request: CallableRequest) => handleAdminCommand(name, run, defaultDeps(), request);

export const removeEventPhotoV1 = onCall(base, command("removeEventPhotoV1", removeEventPhoto));
export const removeEventPhotoCommentV1 = onCall(base, command("removeEventPhotoCommentV1", removeEventPhotoComment));
export const addEventAttendeeV1 = onCall(base, command("addEventAttendeeV1", addEventAttendee));
export const removeEventAttendeeV1 = onCall(base, command("removeEventAttendeeV1", removeEventAttendee));
export const recordAttendanceV1 = onCall(base, command("recordAttendanceV1", recordAttendance));
export const listMembersV1 = onCall(base, command("listMembersV1", listMembers));
export const getMemberV1 = onCall(base, command("getMemberV1", getMember));
export const updateMemberV1 = onCall(base, command("updateMemberV1", updateMember));
export const resetMemberProfileV1 = onCall(base, command("resetMemberProfileV1", resetMemberProfile));
export const setMemberStatusV1 = onCall(heavy, command("setMemberStatusV1", setMemberStatus));
export const adjustMemberPointsV1 = onCall(base, command("adjustMemberPointsV1", adjustMemberPoints));
export const upsertTeamV1 = onCall(base, command("upsertTeamV1", upsertTeam));
export const upsertRosterEntryV1 = onCall(base, command("upsertRosterEntryV1", upsertRosterEntry));
export const revokeRosterEntryV1 = onCall(base, command("revokeRosterEntryV1", revokeRosterEntry));
export const resendRosterInviteV1 = onCall(base, command("resendRosterInviteV1", resendRosterInvite));
export const listRosterV1 = onCall(base, command("listRosterV1", listRoster));
export const backfillRosterV1 = onCall(heavy, command("backfillRosterV1", backfillRosterCallable));
export const importEmployeesV1 = onCall(heavy, command("importEmployeesV1", importEmployees));
export const applyEmployeeImportV1 = onCall(heavy, command("applyEmployeeImportV1", applyEmployeeImport));
export const getEmployeeImportV1 = onCall(base, command("getEmployeeImportV1", getEmployeeImport));
