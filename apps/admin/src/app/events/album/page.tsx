"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Empty, Info, LoadError, Loading, Notice, formatDateTime } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import type { AlbumComment, AlbumPhoto } from "@/lib/adminTypes";

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
  if (failed) return <div className={`photo-frame missing${large ? " large" : ""}`}>Photo unavailable</div>;
  if (!url) return <div className={`photo-frame loading${large ? " large" : ""}`} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`photo-frame${large ? " large" : ""}`} src={url} alt={photo.caption || `Photo by ${photo.uploaderName}`} />;
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
      <dialog ref={ref} className="dialog viewer" aria-label={`Photo by ${photo.uploaderName}`} onCancel={(e) => { e.preventDefault(); if (!pending) onClose(); }}>
        <div className="viewer-grid">
          <PhotoImage photo={photo} large />
          <div className="viewer-side">
            <div className="viewer-head">
              <div>
                <h2>{photo.uploaderName}</h2>
                <p className="subtitle">{formatDateTime(photo.createdAt)}</p>
              </div>
              <button className="pill-btn gray" onClick={onClose}>Close</button>
            </div>
            {photo.caption && <p>{photo.caption}</p>}
            <h3>Comments ({photo.commentCount})</h3>
            {comments.error ? <LoadError error={comments.error} onRetry={comments.reload} />
              : !comments.data ? <Loading label="Loading comments" />
              : comments.data.length === 0 ? <p className="muted">No comments on this photo.</p>
              : (
                <ul className="comment-list">
                  {comments.data.map((comment) => (
                    <li key={comment.id}>
                      <div>
                        <strong>{comment.authorName}</strong> <span className="muted">{formatDateTime(comment.createdAt)}</span>
                        <p>{comment.text}</p>
                      </div>
                      <button className="pill-btn gray small" onClick={() => setPending({ kind: "comment", photo, comment })} aria-label={`Remove comment by ${comment.authorName}`}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            <div className="actions">
              <button className="pill-btn danger" onClick={() => setPending({ kind: "photo", photo })}>Remove photo</button>
            </div>
          </div>
        </div>
      </dialog>
      {pending && (
        <Dialog
          danger
          title={pending.kind === "photo" ? "Remove this photo?" : "Remove this comment?"}
          confirmLabel={pending.kind === "photo" ? "Remove photo" : "Remove comment"}
          reasonLabel="Why is it being removed?"
          onClose={() => setPending(null)}
          onConfirm={async (reason) => {
            if (pending.kind === "photo") {
              await api.removePhoto(eventId, photo.id, reason);
              setPending(null);
              onChanged("Photo removed. Its comments went with it and the member’s upload slot is free again.", true);
            } else {
              await api.removePhotoComment(eventId, photo.id, pending.comment.id, reason);
              setPending(null);
              comments.reload();
              onChanged("Comment removed.", false);
            }
          }}
        >
          {pending.kind === "photo"
            ? <p>The photo, its file and all {photo.commentCount} comments are deleted for everyone. This can’t be undone. The removal is recorded in the audit log.</p>
            : <p>The comment by {pending.comment.authorName} is deleted for everyone. This can’t be undone. The removal is recorded in the audit log.</p>}
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

  if (photos.error) return <LoadError error={photos.error} onRetry={photos.reload} backHref="/events/" backLabel="Back to events" />;
  if (!photos.data) return <Loading label="Loading album" />;
  return (
    <>
      <div className="toolbar">
        <Link className="pill-btn gray" href="/events/">All events</Link>
        <Info>{photos.data.length} {photos.data.length === 1 ? "photo" : "photos"}</Info>
        {event.data && <span className="muted">{event.data.title}</span>}
      </div>
      {message && <Notice>{message}</Notice>}
      {photos.data.length === 0 ? (
        <Empty title="No photos yet" body="Members who went can add photos after the event ends. They show up here." />
      ) : (
        <ul className="photo-grid" aria-label="Album photos">
          {photos.data.map((photo) => (
            <li key={photo.id}>
              <button className="photo-tile" onClick={() => setOpen(photo)} aria-label={`Open photo by ${photo.uploaderName}, ${photo.commentCount} comments`}>
                <PhotoImage photo={photo} />
                <span className="photo-meta">
                  <strong>{photo.uploaderName}</strong>
                  <span className="muted">{formatDateTime(photo.createdAt)}</span>
                </span>
                <Info>{photo.commentCount} {photo.commentCount === 1 ? "comment" : "comments"}</Info>
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
    <Shell title="Event album" subtitle="Photos members shared after the event. Remove anything that doesn’t belong." requires="albums.moderate">
      <Suspense fallback={<Loading label="Loading album" />}><Album /></Suspense>
    </Shell>
  );
}
