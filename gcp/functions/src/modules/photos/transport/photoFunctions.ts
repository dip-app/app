import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { finalizeEventPhoto } from "../application/finalizeEventPhoto";
import type { CommentCounter, PhotoObjects, PhotoStore } from "../application/ports";
import { PhotoError } from "../domain/errors";
import { FirestorePhotoStore, StoragePhotoObjects } from "../infrastructure/firebasePhotoAdapters";

const REGION = "us-central1";
const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

/** Maps domain failures to callable errors with `{ reason, fields? }` details and no internals. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof PhotoError && error.code !== "internal") {
    return new HttpsError(error.code, error.message, {
      reason: error.reason, ...(error.fields.length ? { fields: [...error.fields] } : {}),
    });
  }
  return new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
}

export async function handleFinalizeEventPhoto(store: PhotoStore, objects: PhotoObjects,
  request: Pick<CallableRequest, "auth" | "data">, now?: () => Date) {
  try {
    return await finalizeEventPhoto(store, objects, callerFromRequest(request), request.data, now);
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      // Never log payloads, tokens, profiles or object contents.
      logger.error("finalizeEventPhotoV1 failed", {
        reason: error instanceof PhotoError ? error.reason : "UNEXPECTED",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

/** Keeps `commentCount` server-owned: recounted from the comment documents on every new comment. */
export async function handlePhotoCommentCreated(counter: CommentCounter, params: Record<string, string>) {
  const { companyId, eventId, photoId } = params;
  if (!companyId || !eventId || !photoId) return;
  await counter.recount(companyId, eventId, photoId);
}

const app = () => defaultAdminApp();

// Production requires App Check; only the official Functions emulator bypasses it.
export const finalizeEventPhotoV1 = onCall(
  { region: REGION, enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" },
  request => handleFinalizeEventPhoto(new FirestorePhotoStore(getFirestore(app())), new StoragePhotoObjects(getStorage(app())), request));

export const onPhotoCommentCreated = onDocumentCreated(
  // The recount is idempotent, so a failed attempt is safely retried by the platform.
  { document: "companies/{companyId}/events/{eventId}/photos/{photoId}/comments/{commentId}", region: REGION, retry: true },
  async event => {
    try {
      await handlePhotoCommentCreated(new FirestorePhotoStore(getFirestore(app())), event.params);
    } catch (error) {
      logger.error("onPhotoCommentCreated recount failed", { error: error instanceof Error ? error.name : "unknown" });
      throw error;
    }
  });
