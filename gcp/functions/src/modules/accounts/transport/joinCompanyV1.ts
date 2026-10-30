import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { joinCompany } from "../application/joinCompany";
import type { MembershipStore } from "../application/ports";
import { AccountsError } from "../domain/errors";
import type { AuthIdentity } from "../domain/membership";
import { FirestoreMembershipStore } from "../infrastructure/firestoreMembershipStore";

/** Derives identity only from the verified Auth token, never from the payload. */
export function identityFromRequest(request: Pick<CallableRequest, "auth">): AuthIdentity | null {
  const auth = request.auth;
  if (!auth) return null;
  const email = typeof auth.token.email === "string" ? auth.token.email : null;
  return { uid: auth.uid, email, emailVerified: auth.token.email_verified === true };
}

/** Maps domain failures to callable errors with `{ reason, fields? }` details and no internals. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof AccountsError) {
    const details = error.fields.length > 0 ? { reason: error.reason, fields: [...error.fields] } : { reason: error.reason };
    return new HttpsError(error.code, error.message, details);
  }
  return new HttpsError("internal", "Something went wrong. Try again later.");
}

export async function handleJoinCompany(store: MembershipStore, request: Pick<CallableRequest, "auth" | "data">) {
  try {
    return await joinCompany(store, identityFromRequest(request), request.data);
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      // Never log the payload: it contains the join code.
      logger.error("joinCompanyV1 failed", {
        uid: request.auth?.uid ?? null,
        reason: error instanceof AccountsError ? error.reason : "UNEXPECTED",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

/**
 * Callable export. Region follows the proposed contract (us-central1) pending the
 * team's location decision. The integrator wires this into src/index.ts after review.
 */
export const joinCompanyV1 = onCall({ region: "us-central1" }, (request) => {
  if (getApps().length === 0) initializeApp();
  return handleJoinCompany(new FirestoreMembershipStore(getFirestore()), request);
});
