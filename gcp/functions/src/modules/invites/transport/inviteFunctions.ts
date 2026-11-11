import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { ParticipationError } from "../../participation/domain/errors";
import { listCoworkers } from "../application/listCoworkers";
import type { InviteNotifier, InviteStore } from "../application/ports";
import { respondToInvite } from "../application/respondToInvite";
import { sendInvite } from "../application/sendInvite";
import { InviteError } from "../domain/errors";
import { FirestoreInviteStore } from "../infrastructure/firestoreInviteStore";
import { PushInviteNotifier } from "../infrastructure/invitePushNotifier";

const REGION = "us-central1";
const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/** Maps domain failures (including the shared RSVP path's ParticipationError) to callable errors without internals. */
export function toHttpsError(error: unknown): HttpsError {
  if ((error instanceof InviteError || error instanceof ParticipationError) && error.code !== "internal") {
    return new HttpsError(error.code, error.message, {
      reason: error.reason, ...(error.fields.length ? { fields: [...error.fields] } : {}),
    });
  }
  return new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
}

async function guarded<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      // Never log payloads, names, messages, tokens or exception messages.
      logger.error(`${name} failed`, {
        reason: error instanceof InviteError || error instanceof ParticipationError ? error.reason : "UNEXPECTED",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

type Request = Pick<CallableRequest, "auth" | "data">;

export const handleSendInvite = (store: InviteStore, notifier: InviteNotifier | null, request: Request, now?: () => Date) =>
  guarded("sendInviteV1", () => sendInvite(store, notifier, callerFromRequest(request), request.data, now));
export const handleRespondToInvite = (store: InviteStore, request: Request, now?: () => Date) =>
  guarded("respondToInviteV1", () => respondToInvite(store, callerFromRequest(request), request.data, now));
export const handleListCoworkers = (store: InviteStore, request: Request, now?: () => Date) =>
  guarded("listCoworkersV1", () => listCoworkers(store, callerFromRequest(request), request.data, now));

const emulator = () => process.env.FUNCTIONS_EMULATOR === "true";
const options = { region: REGION, enforceAppCheck: !emulator() } as const;
const store = () => new FirestoreInviteStore(getFirestore(defaultAdminApp()));

// Production requires App Check; only the official Functions emulator bypasses it.
export const sendInviteV1 = onCall(options, (request) =>
  handleSendInvite(store(), new PushInviteNotifier(defaultAdminApp(), emulator()), request));
export const respondToInviteV1 = onCall(options, (request) => handleRespondToInvite(store(), request));
export const listCoworkersV1 = onCall(options, (request) => handleListCoworkers(store(), request));
