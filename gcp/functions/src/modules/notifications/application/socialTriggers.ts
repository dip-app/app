import { createHash } from "node:crypto";
import type { Locale } from "../../i18n";
import { photoAddedPush, photoCommentPush, shorten } from "../domain/push";
import { deliverNotification, type DeliveryStats, type NotificationRequest, type RouterDependencies } from "./router";

/**
 * Album triggers (category `social`, push default off): a comment on the recipient's photo, and a new photo in the
 * album of an activity the recipient attended. Both go through the router (category switch, caps, receipts, locale).
 * Recipients come from stored documents under the trigger's own company path, never from the payload.
 */

type Doc = Record<string, unknown>;

export interface AlbumPhoto { companyId: string; uploaderId: string; uploaderName: string; eventTitle: string }

/** Admin-side reads for the album triggers. */
export interface AlbumReader {
  /** The photo document, or null when it is gone. */
  photo(companyId: string, eventId: string, photoId: string): Promise<AlbumPhoto | null>;
  /** Uids with a `going` RSVP of this company for the event, at most `limit`. */
  goingAttendees(companyId: string, eventId: string, limit: number): Promise<string[]>;
}

/** Albums of very large events notify at most this many attendees per photo burst (events are capacity-bound well below it). */
export const ALBUM_RECIPIENT_LIMIT = 1000;
const TITLE_MAX_FOR_INAPP = 60;

const empty = (): DeliveryStats => ({
  recipients: 0, tokens: 0, sent: 0, failed: 0, removed: 0, duplicate: false, inApp: 0, emailsEnqueued: 0,
  blocked: { category_off: 0, event_level: 0, no_destination: 0, rate_limited: 0, inactive: 0 },
});

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function photoCommentRequest(input: {
  companyId: string; eventId: string; photoId: string; commentId: string; eventTitle: string; uploaderId: string; authorName: string; text: string;
}): NotificationRequest {
  const build = (locale: Locale) => photoCommentPush(input.companyId, input.eventId, input.photoId, input.commentId, input.authorName, input.text, locale);
  const push = build("en");
  return {
    id: `photo_comment_${input.commentId}`, kind: "photo_comment", companyId: input.companyId,
    recipients: [{ uid: input.uploaderId }], push, pushFor: build,
    inApp: { title: push.title, body: push.body, targetType: "event", targetId: input.eventId },
  };
}

/**
 * A comment was created. Notifies the photo's uploader unless they wrote it. The photo must belong to the same
 * company as the trigger path and the comment; anything else is dropped silently.
 */
export async function onPhotoCommentPushed(
  deps: RouterDependencies & { album: AlbumReader },
  companyId: string, eventId: string, photoId: string, commentId: string, comment: Doc,
): Promise<DeliveryStats> {
  const { authorId, authorName, text } = comment;
  if (!isText(authorId) || !isText(text) || comment.companyId !== companyId || comment.photoId !== photoId) return empty();
  const photo = await deps.album.photo(companyId, eventId, photoId);
  if (!photo || photo.companyId !== companyId || photo.uploaderId === authorId) return empty();
  return deliverNotification(deps, photoCommentRequest({
    companyId, eventId, photoId, commentId, eventTitle: photo.eventTitle, uploaderId: photo.uploaderId,
    authorName: typeof authorName === "string" ? authorName : "", text,
  }));
}

/** Receipt id: one notification per uploader, activity and UTC hour, so a burst of uploads is one push. */
export function photoAddedId(eventId: string, uploaderId: string, at: Date): string {
  const hash = createHash("sha256").update(`${eventId}/${uploaderId}/${at.toISOString().slice(0, 13)}`, "utf8").digest("hex").slice(0, 40);
  return `photo_added_${hash}`;
}

export function photoAddedRequest(input: {
  companyId: string; eventId: string; photoId: string; eventTitle: string; uploaderId: string; uploaderName: string; createdAt: Date; recipients: readonly string[];
}): NotificationRequest {
  const build = (locale: Locale) => photoAddedPush(input.companyId, input.eventId, input.eventTitle, input.photoId, input.uploaderName, locale);
  const push = build("en");
  return {
    id: photoAddedId(input.eventId, input.uploaderId, input.createdAt), kind: "photo_added", companyId: input.companyId,
    recipients: input.recipients.filter((uid) => uid !== input.uploaderId).map((uid) => ({ uid })), push, pushFor: build,
    inApp: { title: shorten(input.eventTitle, TITLE_MAX_FOR_INAPP), body: push.body, targetType: "event", targetId: input.eventId },
  };
}

/**
 * A photo document was created (only finalizeEventPhotoV1 writes them, after the event ended): notifies the other
 * attendees who went. The first photo of an uploader's burst sends; later ones in the same hour are receipt duplicates.
 */
export async function onPhotoAddedPushed(
  deps: RouterDependencies & { album: AlbumReader },
  companyId: string, eventId: string, photoId: string, photo: Doc, createdAt: Date,
): Promise<DeliveryStats> {
  const { uploaderId, uploaderName, eventTitle } = photo;
  if (!isText(uploaderId) || photo.companyId !== companyId) return empty();
  const attendees = await deps.album.goingAttendees(companyId, eventId, ALBUM_RECIPIENT_LIMIT);
  const request = photoAddedRequest({
    companyId, eventId, photoId, eventTitle: typeof eventTitle === "string" ? eventTitle : "", uploaderId,
    uploaderName: typeof uploaderName === "string" ? uploaderName : "", createdAt, recipients: attendees,
  });
  if (request.recipients.length === 0) return empty();
  return deliverNotification(deps, request);
}
