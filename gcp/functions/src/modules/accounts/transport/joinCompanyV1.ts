import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { joinCompany } from "../application/joinCompany";
import type { MembershipStore } from "../application/ports";
import { AccountsError } from "../domain/errors";
import { parseJoinCompanyRequest } from "../domain/joinCompanyRequest";
import { assertCanRequestMembership } from "../domain/membership";
import { FirestoreJoinRateLimiter } from "../infrastructure/firestoreJoinRateLimiter";
import type { AuthIdentity } from "../domain/membership";
import { FirestoreMembershipStore } from "../infrastructure/firestoreMembershipStore";

/** Derives identity only from the verified Auth token, never from the payload. */
export function identityFromRequest(request: Pick<CallableRequest, "auth">): AuthIdentity | null {
  const auth = request.auth;
  if (!auth) return null;
  const email = typeof auth.token.email === "string" ? auth.token.email : null;
  return { uid: auth.uid, email, emailVerified: auth.token.email_verified === true };
}

const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/** Maps domain failures to callable errors with `{ reason, fields? }` details and no internals. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof AccountsError) {
    const details = error.fields.length > 0 ? { reason: error.reason, fields: [...error.fields] } : { reason: error.reason };
    // Internal failures keep their stable reason but never expose server-side detail.
    const message = error.code === "internal" ? GENERIC_INTERNAL_MESSAGE : error.message;
    return new HttpsError(error.code, message, details);
  }
  return new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
}

export async function handleJoinCompany(store: MembershipStore, request: Pick<CallableRequest, "auth" | "data">, limiter?: { consume(uid: string): Promise<void> }) {
  try {
    const identity = identityFromRequest(request);
    if (identity) {
      parseJoinCompanyRequest(request.data);
      assertCanRequestMembership(identity);
      await limiter?.consume(identity.uid);
    }
    return await joinCompany(store, identity, request.data);
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

/** Production requires App Check; only the official Functions emulator bypasses it. */
export const joinCompanyV1 = onCall({
  region: "us-central1",
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
}, (request) => {
  if (getApps().length === 0) initializeApp();
  const db = getFirestore();
  return handleJoinCompany(new FirestoreMembershipStore(db), request, new FirestoreJoinRateLimiter(db));
});
