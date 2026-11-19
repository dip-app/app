import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { onPhotoAddedPushed, onPhotoCommentPushed } from "../application/socialTriggers";
import { MAX_EVENT_AGE_MS, isStaleEvent } from "../domain/staleness";
import { FirestoreAlbum } from "../infrastructure/firestoreAlbum";
import { routerDependencies } from "./routerDeps";

const REGION = "us-central1";
const options = { region: REGION, retry: true, timeoutSeconds: 120, memory: "256MiB", maxInstances: 10 } as const;

/**
 * A photo comment was created -> push (category `social`, default off) to the photo's uploader, never to the author.
 * Always uses the router. Idempotent: receipt id `photo_comment_{commentId}`; a leased (crashed) attempt is retried by throwing.
 */
export const onPhotoCommentPush = onDocumentCreated(
  { ...options, document: "companies/{companyId}/events/{eventId}/photos/{photoId}/comments/{commentId}" },
  async (event) => {
    if (!event.data) return;
    const { companyId, eventId, photoId, commentId } = event.params;
    if (isStaleEvent(event.time, new Date(), MAX_EVENT_AGE_MS.social)) {
      logger.error("trigger.dropped_stale", { trigger: "onPhotoCommentPush", companyId, eventId });
      return;
    }
    const app = defaultAdminApp();
    const stats = await onPhotoCommentPushed({ ...routerDependencies(app), album: new FirestoreAlbum(getFirestore(app)) },
      companyId, eventId, photoId, commentId, event.data.data());
    logger.info("photo comment push", { companyId, eventId, ...stats });
    if (stats.inProgress) throw new Error("DELIVERY_IN_PROGRESS");
  });

/**
 * A photo was added to an album -> push (category `social`, default off) to the other attendees who went. One
 * notification per uploader, activity and hour (a burst of uploads is one push).
 */
export const onPhotoAddedPush = onDocumentCreated(
  { ...options, document: "companies/{companyId}/events/{eventId}/photos/{photoId}" },
  async (event) => {
    if (!event.data) return;
    const { companyId, eventId, photoId } = event.params;
    if (isStaleEvent(event.time, new Date(), MAX_EVENT_AGE_MS.social)) {
      logger.error("trigger.dropped_stale", { trigger: "onPhotoAddedPush", companyId, eventId });
      return;
    }
    const app = defaultAdminApp();
    const stats = await onPhotoAddedPushed({ ...routerDependencies(app), album: new FirestoreAlbum(getFirestore(app)) },
      companyId, eventId, photoId, event.data.data(), new Date(event.time));
    logger.info("photo added push", { companyId, eventId, ...stats });
    if (stats.inProgress) throw new Error("DELIVERY_IN_PROGRESS");
  });
