"use client";
// @i18n-migrated

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Empty, Info, LoadError, Loading, formatDateTime } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import type { AlbumComment, AlbumPhoto } from "@/lib/adminTypes";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, InlineNotice } from "@/components/kit";
import { t } from "@/lib/i18n";

function PhotoImage({ photo, large }: { photo: AlbumPhoto; large?: boolean }) {
  const { api } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    api.photoImage(photo).then(
      (value) => { made = value; if (!cancelled) setUrl(value); },
      () => !cancelled && setFailed(true),
    );
    return () => { cancelled = true; if (made?.startsWith("blob:")) URL.revokeObjectURL(made); };
  }, [api, photo]);
  if (failed) return <div className={`photo-frame missing${large ? " large" : ""}`}>{t("album.photoUnavailable")}</div>;
  if (!url) return <div className={`photo-frame loading${large ? " large" : ""}`} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`photo-frame${large ? " large" : ""}`} src={url} alt={photo.caption || t("album.photoBy", { name: photo.uploaderName })} draggable={false} />;
}

type Pending =
  | { kind: "photo"; photo: AlbumPhoto }
  | { kind: "comment"; photo: AlbumPhoto; comment: AlbumComment };

function Viewer({ eventId, photo, onClose, onChanged }: { eventId: string; photo: AlbumPhoto; onClose: () => void; onChanged: (message: string, closeViewer: boolean) => void }) {
  const { api } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const comments = useLoad((a) => a.listPhotoComments(eventId, photo.id), photo.id);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <>
      <dialog ref={ref} className="dialog viewer" aria-label={t("album.photoBy", { name: photo.uploaderName })} onCancel={(e) => { e.preventDefault(); if (!pending) onClose(); }}>
        <div className="viewer-grid">
          <PhotoImage photo={photo} large />
          <div className="viewer-side">
            <div className="viewer-head">
              <div>
                <h2>{photo.uploaderName}</h2>
                <p className="subtitle">{formatDateTime(photo.createdAt)}</p>
              </div>
              <Button onClick={onClose}>{t("album.viewer.close")}</Button>
            </div>
            {photo.caption && <p>{photo.caption}</p>}
            <h3>{t("album.viewer.comments", { count: photo.commentCount })}</h3>
            {comments.error ? <LoadError error={comments.error} onRetry={comments.reload} />
              : !comments.data ? <Loading label={t("album.loadingComments")} />
              : comments.data.length === 0 ? <p className="muted">{t("album.viewer.noComments")}</p>
              : (
                <ul className="comment-list">
                  {comments.data.map((comment) => (
                    <li key={comment.id}>
                      <div>
                        <strong>{comment.authorName}</strong> <span className="muted">{formatDateTime(comment.createdAt)}</span>
                        <p>{comment.text}</p>
                      </div>
                      <Button size="sm" onClick={() => setPending({ kind: "comment", photo, comment })} aria-label={t("album.viewer.removeCommentBy", { name: comment.authorName })}>{t("album.viewer.remove")}</Button>
                    </li>
                  ))}
                </ul>
              )}
            <div className="actions">
              <Button variant="danger" onClick={() => setPending({ kind: "photo", photo })}>{t("album.viewer.removePhoto")}</Button>
            </div>
          </div>
        </div>
      </dialog>
      {pending && (
        <Dialog
          danger
          title={pending.kind === "photo" ? t("album.remove.photoTitle") : t("album.remove.commentTitle")}
          confirmLabel={pending.kind === "photo" ? t("album.remove.photoConfirm") : t("album.remove.commentConfirm")}
          reasonLabel={t("album.remove.reason")}
          onClose={() => setPending(null)}
          onConfirm={async (reason) => {
            if (pending.kind === "photo") {
              await api.removePhoto(eventId, photo.id, reason);
              setPending(null);
              onChanged(t("album.remove.photoDone"), true);
            } else {
              await api.removePhotoComment(eventId, photo.id, pending.comment.id, reason);
              setPending(null);
              comments.reload();
              onChanged(t("album.remove.commentDone"), false);
            }
          }}
        >
          {pending.kind === "photo"
            ? <p>{t("album.remove.photoBody", { count: photo.commentCount })}</p>
            : <p>{t("album.remove.commentBody", { name: pending.comment.authorName })}</p>}
        </Dialog>
      )}
    </>
  );
}

function Album() {
  const eventId = useSearchParams().get("id") ?? "";
  const event = useLoad((a) => a.getEvent(eventId), `e-${eventId}`);
  const photos = useLoad((a) => a.listPhotos(eventId), `p-${eventId}`);
  const [open, setOpen] = useState<AlbumPhoto | null>(null);
  const [message, setMessage] = useState("");

  const hold = useSkeletonGate(!photos.data && !photos.error);
  if (photos.error) return <LoadError error={photos.error} onRetry={photos.reload} backHref="/events/" backLabel={t("attendees.backToEvents")} />;
  if (!photos.data || hold) return <Loading label={t("album.loading")} layout="album" />;
  return (
    <>
      <div className="toolbar">
        <Button href="/events/">{t("album.allEvents")}</Button>
        <Info>{t("album.count.photos", { count: photos.data.length })}</Info>
        {event.data && <span className="muted">{event.data.title}</span>}
      </div>
      {message && <InlineNotice>{message}</InlineNotice>}
      {photos.data.length === 0 ? (
        <Empty title={t("album.empty.title")} body={t("album.empty.body")} />
      ) : (
        <ul className="photo-grid" aria-label={t("album.grid.label")}>
          {photos.data.map((photo) => (
            <li key={photo.id}>
              <button className="photo-tile" onClick={() => setOpen(photo)} aria-label={t("album.tile.label", { name: photo.uploaderName, date: formatDateTime(photo.createdAt), count: photo.commentCount })}>
                <PhotoImage photo={photo} />
                <span className="photo-meta">
                  <strong>{photo.uploaderName}</strong>
                  <span className="muted">{formatDateTime(photo.createdAt)}</span>
                </span>
                <Info>{t("album.count.comments", { count: photo.commentCount })}</Info>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Viewer
          eventId={eventId}
          photo={open}
          onClose={() => setOpen(null)}
          onChanged={(text, closeViewer) => { setMessage(text); photos.reload(); if (closeViewer) setOpen(null); }}
        />
      )}
    </>
  );
}

export default function AlbumPage() {
  return (
    <Shell title={t("album.title")} subtitle={t("album.subtitle")} requires="albums.moderate">
      <Suspense fallback={<Loading label={t("album.loading")} layout="album" />}><Album /></Suspense>
    </Shell>
  );
}
