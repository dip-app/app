import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { createEvent, updateEvent, type Caller, type Clock, type IdGenerator } from "../application/organizerCommands";
import type { OrganizerStore } from "../application/ports";
import { OrganizerError } from "../domain/errors";
import { FirestoreOrganizerStore, randomIds } from "../infrastructure/firestoreOrganizerStore";

/** Derives the caller only from the verified Auth token, never from the payload. */
export function callerFromRequest(request: Pick<CallableRequest, "auth">): Caller | null {
  const auth = request.auth;
  if (!auth) return null;
  const provider: unknown = auth.token.firebase?.sign_in_provider;
  return {
    uid: auth.uid,
    emailVerified: auth.token.email_verified === true,
    signInProvider: typeof provider === "string" ? provider : null,
  };
}

const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/** Maps domain failures to callable errors with `{ reason, fields? }` details and no internals. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof OrganizerError) {
    const details = error.fields.length > 0 ? { reason: error.reason, fields: [...error.fields] } : { reason: error.reason };
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
        reason: error instanceof OrganizerError ? error.reason : "UNEXPECTED",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

export function handleCreateEvent(store: OrganizerStore, request: Pick<CallableRequest, "auth" | "data">, ids: IdGenerator = randomIds, clock?: Clock) {
  return run("createEventV1", request, () => createEvent(store, callerFromRequest(request), request.data, ids, clock));
}

export function handleUpdateEvent(store: OrganizerStore, request: Pick<CallableRequest, "auth" | "data">) {
  return run("updateEventV1", request, () => updateEvent(store, callerFromRequest(request), request.data));
}

const options = {
  region: "us-central1",
  // Production requires App Check; only the official Functions emulator bypasses it.
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
} as const;

export const createEventV1 = onCall(options, (request) =>
  handleCreateEvent(new FirestoreOrganizerStore(getFirestore(defaultAdminApp())), request));

export const updateEventV1 = onCall(options, (request) =>
  handleUpdateEvent(new FirestoreOrganizerStore(getFirestore(defaultAdminApp())), request));
