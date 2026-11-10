import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { createChallenge, updateChallenge, type ChallengeIdGenerator, type Clock } from "../application/challengeCommands";
import type { ChallengeStore } from "../application/ports";
import { ChallengeError } from "../domain/errors";
import { FirestoreChallengeStore, randomChallengeIds } from "../infrastructure/firestoreChallengeStore";

const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/**
 * Maps domain failures to callable errors with `{ reason, fields?, conflict? }` details and no internals.
 * `conflict` is present only for CHALLENGE_WINDOW_OVERLAP and names a same-company challenge.
 */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof ChallengeError) {
    const details: Record<string, unknown> = { reason: error.reason };
    if (error.fields.length > 0) details.fields = [...error.fields];
    if (error.conflict) details.conflict = { ...error.conflict };
    return new HttpsError(error.code, error.code === "internal" ? GENERIC_INTERNAL_MESSAGE : error.message, details);
  }
  return new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
}

async function run<T>(name: string, request: Pick<CallableRequest, "auth">, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      // Never log tokens or payload contents.
      logger.error(`${name} failed`, {
        uid: request.auth?.uid ?? null,
        reason: error instanceof ChallengeError ? error.reason : "UNEXPECTED",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

export function handleCreateChallenge(store: ChallengeStore, request: Pick<CallableRequest, "auth" | "data">, ids: ChallengeIdGenerator = randomChallengeIds, clock?: Clock) {
  return run("createChallengeV1", request, () => createChallenge(store, callerFromRequest(request), request.data, ids, clock));
}

export function handleUpdateChallenge(store: ChallengeStore, request: Pick<CallableRequest, "auth" | "data">, clock?: Clock) {
  return run("updateChallengeV1", request, () => updateChallenge(store, callerFromRequest(request), request.data, clock));
}

const options = {
  region: "us-central1",
  // Production requires App Check; only the official Functions emulator bypasses it.
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
} as const;

export const createChallengeV1 = onCall(options, (request) =>
  handleCreateChallenge(new FirestoreChallengeStore(getFirestore(defaultAdminApp())), request));

export const updateChallengeV1 = onCall(options, (request) =>
  handleUpdateChallenge(new FirestoreChallengeStore(getFirestore(defaultAdminApp())), request));
