import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { resolveMembership } from "../application/resolveMembership";
import type { MembershipRateLimiter, MembershipStore } from "../application/ports";
import { AccountsError } from "../domain/errors";
import type { AuthIdentity } from "../domain/membership";
import { FirestoreMembershipRateLimiter } from "../infrastructure/firestoreMembershipRateLimiter";
import { FirestoreMembershipStore } from "../infrastructure/firestoreMembershipStore";

/** Derives identity only from the verified Auth token, never from the payload. */
export function identityFromRequest(request: Pick<CallableRequest, "auth">): AuthIdentity | null {
  const auth = request.auth;
  if (!auth) return null;
  const token = auth.token;
  const provider: unknown = token.firebase?.sign_in_provider;
  return {
    uid: auth.uid,
    email: typeof token.email === "string" ? token.email : null,
    emailVerified: token.email_verified === true,
    signInProvider: typeof provider === "string" ? provider : null,
    name: typeof token.name === "string" ? token.name : null,
  };
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

export async function handleResolveMembership(
  store: MembershipStore,
  request: Pick<CallableRequest, "auth" | "data">,
  limiter?: MembershipRateLimiter,
) {
  try {
    return await resolveMembership(store, identityFromRequest(request), request.data, limiter);
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      // Never log email addresses or tokens.
      logger.error("resolveMembershipV1 failed", {
        uid: request.auth?.uid ?? null,
        reason: error instanceof AccountsError ? error.reason : "UNEXPECTED",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

/**
 * The default Admin app, created on first use. Not `getApps().length === 0`: in production
 * firebase-functions creates its own named app ("__FIREBASE_FUNCTIONS_SDK__") while verifying
 * the callable's Auth/App Check tokens, so the list is non-empty before this handler runs and
 * `getFirestore()` would then find no default app.
 */
export function defaultAdminApp(): App {
  return getApps().find((app) => app.name === "[DEFAULT]") ?? initializeApp();
}

/** Production requires App Check; only the official Functions emulator bypasses it. */
export const resolveMembershipV1 = onCall({
  region: "us-central1",
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
}, (request) => {
  const db = getFirestore(defaultAdminApp());
  return handleResolveMembership(new FirestoreMembershipStore(db), request, new FirestoreMembershipRateLimiter(db));
});
