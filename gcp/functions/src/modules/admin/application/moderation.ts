import type { RemoveEventPhotoCommentResponse, RemoveEventPhotoResponse } from "../../../generated/models";
import { change } from "../domain/audit";
import { AdminError, stored } from "../domain/errors";
import { paths } from "../domain/ops";
import { parseRemoveComment, parseRemovePhoto } from "../domain/requests";
import { authorize, loadEvent, once, requireCaller, writeAudit } from "./context";
import type { AdminDeps, Caller } from "./ports";

const TX_COMMENT_BATCH = 400;
const CLEANUP_BATCH = 400;
const MAX_CLEANUP_PAGES = 250;

/** Storage object for an album photo id `{uploaderUid}_{slot}`; null when the id is not slot-addressed. */
export function photoObjectPath(companyId: string, eventId: string, photoId: string): string | null {
  const match = /^(.+)_(1?[0-9])$/.exec(photoId);
  if (!match || Number(match[2]) >= 20) return null;
  return `companies/${companyId}/events/${eventId}/photos/${match[1]}/${match[2]}`;
}

/**
 * removeEventPhotoV1: authorizes, then in one transaction deletes the photo document and its first comments and
 * writes the audit entry and receipt. After commit, remaining comments and the Storage object (which frees the
 * uploader's create-only slot) are removed by idempotent cleanup that also runs on a replay, so a crash between
 * the two steps converges on the next retry.
 */
export async function removeEventPhoto(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<RemoveEventPhotoResponse> {
  const authenticated = requireCaller(caller);
  const req = parseRemovePhoto(data);
  await deps.limiter?.consume(authenticated.uid);
  const { eventId, photoId } = req;
  const result = await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "album.moderate");
    const payload = { eventId, photoId, reason: req.reason ?? null };
    return once(tx, actor, "removeEventPhotoV1", req.requestId, payload, async () => {
      await loadEvent(tx, actor, eventId);
      const photo = await tx.get(paths.photo(actor.companyId, eventId, photoId));
      if (!photo) return { contractVersion: 1, photoId, removed: false, commentsRemoved: 0, objectRemoved: false } satisfies RemoveEventPhotoResponse;
      stored(photo.companyId === actor.companyId, "photo");
      const comments = await tx.list(paths.comments(actor.companyId, eventId, photoId), { limit: TX_COMMENT_BATCH });
      for (const comment of comments) tx.delete(paths.comment(actor.companyId, eventId, photoId, comment.id));
      tx.delete(paths.photo(actor.companyId, eventId, photoId));
      const caption = typeof photo.caption === "string" ? photo.caption : "";
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "photo.remove", targetType: "photo", targetId: `${eventId}/${photoId}`,
        summary: `Removed photo by ${typeof photo.uploaderName === "string" ? photo.uploaderName : "a member"} from ${typeof photo.eventTitle === "string" ? photo.eventTitle : "an event"}`,
        changes: [change("uploaderId", photo.uploaderId, null), change("caption", caption || null, null), change("comments", comments.length, 0)],
        reason: req.reason, requestId: req.requestId,
      });
      return { contractVersion: 1, photoId, removed: true, commentsRemoved: comments.length, objectRemoved: false } satisfies RemoveEventPhotoResponse;
    }, deps.now());
  });
  // Idempotent cleanup (also on replays): leftover comments beyond the transaction batch, then the object.
  const collection = paths.comments(req.companyId, eventId, photoId);
  let extra = 0;
  for (let page = 0; page < MAX_CLEANUP_PAGES; page++) {
    const deleted = await deps.store.deletePage(collection, CLEANUP_BATCH);
    extra += deleted;
    if (deleted < CLEANUP_BATCH) break;
  }
  const objectPath = photoObjectPath(req.companyId, eventId, photoId);
  const objectRemoved = objectPath ? await deps.objects.remove(objectPath) : false;
  return { ...result.value, commentsRemoved: result.value.commentsRemoved + extra, objectRemoved };
}

/** removeEventPhotoCommentV1: deletes one comment and recounts the photo's server-owned commentCount atomically. */
export async function removeEventPhotoComment(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<RemoveEventPhotoCommentResponse> {
  const authenticated = requireCaller(caller);
  const req = parseRemoveComment(data);
  await deps.limiter?.consume(authenticated.uid);
  const { eventId, photoId, commentId } = req;
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "album.moderate");
    const payload = { eventId, photoId, commentId, reason: req.reason ?? null };
    return once(tx, actor, "removeEventPhotoCommentV1", req.requestId, payload, async () => {
      await loadEvent(tx, actor, eventId);
      const photo = await tx.get(paths.photo(actor.companyId, eventId, photoId));
      if (!photo || photo.companyId !== actor.companyId) throw new AdminError("not-found", "PHOTO_NOT_FOUND", "Photo not found.");
      const comment = await tx.get(paths.comment(actor.companyId, eventId, photoId, commentId));
      const total = await tx.count(paths.comments(actor.companyId, eventId, photoId));
      if (!comment) {
        return { contractVersion: 1, commentId, removed: false, commentCount: total } satisfies RemoveEventPhotoCommentResponse;
      }
      const commentCount = Math.max(0, total - 1);
      tx.delete(paths.comment(actor.companyId, eventId, photoId, commentId));
      tx.update(paths.photo(actor.companyId, eventId, photoId), { commentCount });
      const snippet = typeof comment.text === "string" ? [...comment.text].slice(0, 80).join("") : null;
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "photo.comment.remove", targetType: "comment", targetId: `${eventId}/${photoId}/${commentId}`,
        summary: `Removed a comment by ${typeof comment.authorName === "string" ? comment.authorName : "a member"}`,
        changes: [change("authorId", comment.authorId, null), change("text", snippet, null), change("commentCount", total, commentCount)],
        reason: req.reason, requestId: req.requestId,
      });
      return { contractVersion: 1, commentId, removed: true, commentCount } satisfies RemoveEventPhotoCommentResponse;
    }, deps.now());
  })).value;
}
