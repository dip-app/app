import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import type { PhotoObjects } from "../../photos/application/ports";
import { StoragePhotoObjects } from "../../photos/infrastructure/firebasePhotoAdapters";
import { approveChallenge, listChallengeSubmissions, rejectChallenge, submitChallenge } from "../application/submissionCommands";
import type { SubmissionStore } from "../application/ports";
import { SubmissionError } from "../domain/errors";
import { FirestoreSubmissionStore } from "../infrastructure/firestoreSubmissionStore";

const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/** Maps domain failures to callable errors with `{ reason, fields? }` details and no internals. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof SubmissionError && error.code !== "internal") {
    return new HttpsError(error.code, error.message, {
      reason: error.reason, ...(error.fields.length ? { fields: [...error.fields] } : {}),
    });
  }
  return new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
}

async function run<T>(name: string, request: Pick<CallableRequest, "auth">, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      // Never log payloads, captions, tokens or object contents.
      logger.error(`${name} failed`, {
        uid: request.auth?.uid ?? null,
        reason: error instanceof SubmissionError ? error.reason : "UNEXPECTED",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

type Request = Pick<CallableRequest, "auth" | "data">;

export const handleSubmitChallenge = (store: SubmissionStore, objects: PhotoObjects, request: Request, now?: () => Date) =>
  run("submitChallengeV1", request, () => submitChallenge(store, objects, callerFromRequest(request), request.data, now));
export const handleApproveChallenge = (store: SubmissionStore, request: Request) =>
  run("approveChallengeV1", request, () => approveChallenge(store, callerFromRequest(request), request.data));
export const handleRejectChallenge = (store: SubmissionStore, request: Request) =>
  run("rejectChallengeV1", request, () => rejectChallenge(store, callerFromRequest(request), request.data));
export const handleListChallengeSubmissions = (store: SubmissionStore, request: Request) =>
  run("listChallengeSubmissionsV1", request, () => listChallengeSubmissions(store, callerFromRequest(request), request.data));

const app = () => defaultAdminApp();
const store = () => new FirestoreSubmissionStore(getFirestore(app()));
// Production requires App Check; only the official Functions emulator bypasses it.
const options = { region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;

export const submitChallengeV1 = onCall(options, request =>
  handleSubmitChallenge(store(), new StoragePhotoObjects(getStorage(app())), request));
export const approveChallengeV1 = onCall(options, request => handleApproveChallenge(store(), request));
export const rejectChallengeV1 = onCall(options, request => handleRejectChallenge(store(), request));
export const listChallengeSubmissionsV1 = onCall(options, request => handleListChallengeSubmissions(store(), request));
