import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { refreshRsvpSnapshots } from "../application/refreshProfileSnapshots";
import { FirestoreProfileSnapshotStore } from "../infrastructure/firestoreProfileSnapshotStore";

/** users/{userId} updated: when displayName, avatarId, department or jobTitle change, refresh the attendee
 * snapshot on that user's RSVPs for upcoming and recent events of their company. Never touches counts. */
export const onUserProfileUpdated = onDocumentUpdated({ document: "users/{userId}", region: "us-central1" }, async (event) => {
  if (!event.data) return;
  const app = getApps().find(candidate => candidate.name === "[DEFAULT]") ?? initializeApp();
  const result = await refreshRsvpSnapshots(new FirestoreProfileSnapshotStore(getFirestore(app)), event.params.userId,
    event.data.before.data(), event.data.after.data(), new Date());
  // Counts only: no names, titles or departments in logs.
  if (!result.skipped) logger.info("rsvp snapshots refreshed", { events: result.events, updated: result.updated });
});
