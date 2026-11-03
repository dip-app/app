import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import type { ParticipationStore } from "../application/ports";
import { setRsvp } from "../application/setRsvp";
import { ParticipationError } from "../domain/errors";
import { FirestoreParticipationStore } from "../infrastructure/firestoreParticipationStore";

export async function handleSetRsvp(store: ParticipationStore, request: Pick<CallableRequest, "auth" | "data">) {
  try {
    const auth = request.auth;
    const provider: unknown = auth?.token.firebase?.sign_in_provider;
    return await setRsvp(store, auth ? {
      uid: auth.uid, emailVerified: auth.token.email_verified === true,
      signInProvider: typeof provider === "string" ? provider : null,
    } : null, request.data);
  } catch (error) {
    if (error instanceof ParticipationError && error.code !== "internal") {
      throw new HttpsError(error.code, error.message, {
        reason: error.reason, ...(error.fields.length ? { fields: [...error.fields] } : {}),
      });
    }
    // Do not log payloads, profiles, tokens or unexpected exception messages.
    logger.error("setRsvpV1 failed", { reason: error instanceof ParticipationError ? error.reason : "UNEXPECTED" });
    throw new HttpsError("internal", "Something went wrong. Try again later.");
  }
}

// Module-local only: the integrator must review and add the deployment export.
export const setRsvpV1 = onCall({ region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" }, request => {
  const app = getApps().find(candidate => candidate.name === "[DEFAULT]") ?? initializeApp();
  return handleSetRsvp(new FirestoreParticipationStore(getFirestore(app)), request);
});
