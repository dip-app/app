import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { errorMessageDetails } from "../../i18n";
import { setMyLocale, type LocaleCaller, type LocaleStore } from "../application/setMyLocale";
import { AccountsError } from "../domain/errors";
import { FirestoreLocaleStore } from "../infrastructure/firestoreLocaleStore";
import { defaultAdminApp } from "./resolveMembershipV1";

const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

export function localeCallerFromRequest(request: Pick<CallableRequest, "auth">): LocaleCaller | null {
  const auth = request.auth;
  if (!auth) return null;
  const provider: unknown = auth.token.firebase?.sign_in_provider;
  return { uid: auth.uid, emailVerified: auth.token.email_verified === true, signInProvider: typeof provider === "string" ? provider : null };
}

/** Domain failures become callable errors with `{ reason, fields?, messageKey }` details; internals stay generic. */
export async function handleSetMyLocale(store: LocaleStore, request: Pick<CallableRequest, "auth" | "data">) {
  try {
    return await setMyLocale(store, localeCallerFromRequest(request), request.data);
  } catch (error) {
    if (error instanceof AccountsError && error.code !== "internal") {
      throw new HttpsError(error.code, error.message, {
        reason: error.reason, ...(error.fields.length ? { fields: [...error.fields] } : {}), ...errorMessageDetails(error.message),
      });
    }
    // Never log payloads, tokens or exception messages.
    logger.error("setMyLocaleV1 failed", { uid: request.auth?.uid ?? null, error: error instanceof Error ? error.name : "unknown" });
    throw new HttpsError("internal", GENERIC_INTERNAL_MESSAGE, { messageKey: "errors.generic" });
  }
}

/** Production requires App Check; only the official Functions emulator bypasses it. */
export const setMyLocaleV1 = onCall({
  region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true", timeoutSeconds: 30, memory: "256MiB", maxInstances: 10,
}, (request) => handleSetMyLocale(new FirestoreLocaleStore(getFirestore(defaultAdminApp())), request));
