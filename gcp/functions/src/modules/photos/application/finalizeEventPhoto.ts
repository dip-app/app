import type { FinalizeEventPhotoResponse } from "../../../generated/models";
import { PhotoError } from "../domain/errors";
import { parseFinalizeRequest, validWireId, validateUpload, type PhotoContentType } from "../domain/photoPolicy";
import type { Document, PhotoCaller, PhotoObjects, PhotoStore } from "./ports";

const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
function stored(condition: boolean): asserts condition {
  if (!condition) throw new PhotoError("internal", "INVALID_STORED_DATA", "Invalid stored album data.");
}

/**
 * finalizeEventPhotoV1: publishes an uploaded object as an album photo.
 *
 * Authorization (membership, going RSVP, ended scheduled event) and the idempotency read run in one
 * transaction before the object is inspected, so an outsider learns nothing about another tenant's
 * objects. A replay of an already-finalized photoId returns `created: false` without writing.
 * An object that fails validation is deleted after the transaction, which frees the member's slot.
 */
export async function finalizeEventPhoto(store: PhotoStore, objects: PhotoObjects, caller: PhotoCaller | null,
  data: unknown, now: () => Date = () => new Date()): Promise<FinalizeEventPhotoResponse> {
  if (!caller || !validWireId(caller.uid)) throw new PhotoError("unauthenticated", "UNAUTHENTICATED", "Sign in again.");
  if (!caller.emailVerified) throw new PhotoError("permission-denied", "EMAIL_NOT_VERIFIED", "Verified email required.");
  if (caller.signInProvider !== "google.com") throw new PhotoError("permission-denied", "PROVIDER_NOT_ALLOWED", "Google sign-in required.");
  const request = parseFinalizeRequest(data, caller.uid);
  const { companyId, eventId, photoId, storagePath, caption } = request;
  const uid = caller.uid;
  let invalidObject = false;
  try {
    return await store.runTransaction(async tx => {
      invalidObject = false;
      // Membership first: never reveal whether another company's event exists.
      const member = await tx.getMember(uid);
      if (!member || member.companyId !== companyId || (member.role !== "member" && member.role !== "admin")) {
        throw new PhotoError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
      }
      const event = await tx.getEvent(companyId, eventId);
      if (!event) throw new PhotoError("not-found", "EVENT_NOT_FOUND", "Event not found.");
      stored(event.companyId === companyId && date(event.startTime) && date(event.endTime) && typeof event.title === "string");
      const existing = await tx.getPhoto(companyId, eventId, photoId);
      if (existing) {
        // Replay: the same member and object already published this slot.
        if (existing.uploaderId === uid && existing.storagePath === storagePath && existing.companyId === companyId) {
          return { contractVersion: 1, photoId, created: false } satisfies FinalizeEventPhotoResponse;
        }
        throw new PhotoError("failed-precondition", "PHOTO_CONFLICT", "This photo slot is already used.");
      }
      const rsvp = await tx.getRsvp(companyId, eventId, uid);
      if (!rsvp || rsvp.companyId !== companyId || rsvp.eventId !== eventId || rsvp.userId !== uid || rsvp.status !== "going") {
        throw new PhotoError("permission-denied", "NOT_ATTENDEE", "Only members who went to this event can add photos.");
      }
      if (event.status !== "scheduled") throw new PhotoError("failed-precondition", "EVENT_CANCELLED", "This event was cancelled.");
      if ((event.endTime as Date).getTime() > now().getTime()) {
        throw new PhotoError("failed-precondition", "EVENT_NOT_ENDED", "Photos can be added after the event ends.");
      }
      const object = await objects.inspect(storagePath);
      if (!object) throw new PhotoError("failed-precondition", "UPLOAD_NOT_FOUND", "Upload the photo before finalizing it.");
      let contentType: PhotoContentType;
      try { contentType = validateUpload(object); } catch (error) { invalidObject = true; throw error; }
      stored(typeof member.displayName === "string" && typeof member.avatarId === "string");
      const photo: Document = {
        companyId, eventId, eventTitle: event.title, eventDate: event.startTime,
        uploaderId: uid, uploaderName: member.displayName, uploaderAvatarId: member.avatarId,
        storagePath, downloadURL: "", caption, commentCount: 0, sizeBytes: object.size, contentType,
      };
      tx.createPhoto(companyId, eventId, photoId, photo);
      return { contractVersion: 1, photoId, created: true } satisfies FinalizeEventPhotoResponse;
    });
  } catch (error) {
    if (invalidObject) await objects.remove(storagePath).catch(() => undefined);
    throw error;
  }
}
