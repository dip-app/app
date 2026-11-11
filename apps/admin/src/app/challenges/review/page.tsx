"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, Info, LoadError, Loading, formatDateTime } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { SUBMISSION_STATUS_LABEL, type Submission, type SubmissionStatus } from "@/lib/adminTypes";
import { formatGoal } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";
import { formatWindow } from "@/lib/weeks";

const TABS: SubmissionStatus[] = ["submitted", "rejected", "approved"];
const EMPTY: Record<SubmissionStatus, { title: string; body: string }> = {
  submitted: { title: "Nothing waiting for review", body: "New submissions show up here as people send them in." },
  rejected: { title: "Nothing sent back", body: "Entries you ask to change wait here until the member resubmits." },
  approved: { title: "Nothing approved yet", body: "Approved entries, with the points they earned, are listed here." },
};

/** Evidence picture; opens larger on click. Live mode reads the bytes through the signed-in admin's Storage access. */
function Evidence({ submission }: { submission: Submission }) {
  const { api } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const path = submission.storagePath;

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!path) return;
    let cancelled = false;
    let made: string | null = null;
    api.submissionEvidence(submission).then(
      (value) => { made = value; if (!cancelled) setUrl(value); },
      () => !cancelled && setFailed(true),
    );
    return () => { cancelled = true; if (made?.startsWith("blob:")) URL.revokeObjectURL(made); };
    // The path identifies the picture; a new caption or status keeps the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path]);

  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
    if (!open && el?.open) el.close();
  }, [open]);

  if (!path) return <div className="evidence none"><p>No photo. This is a note-only entry.</p></div>;
  if (failed) return <div className="evidence none" role="alert"><p>The photo couldn’t be loaded.</p></div>;
  if (!url) return <div className="evidence loading" role="status" aria-label="Loading photo" />;
  return (
    <>
      <button className="evidence" onClick={() => setOpen(true)} aria-label={`Open ${submission.userName}’s photo full size`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Evidence from ${submission.userName}`} />
        <span className="info-pill">View full size</span>
      </button>
      <dialog ref={dialog} className="dialog viewer" aria-label={`${submission.userName}’s photo`} onClose={() => setOpen(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="photo-frame large" src={url} alt={`Evidence from ${submission.userName}`} />
        <div className="actions"><button className="pill-btn gray" onClick={() => setOpen(false)}>Close</button></div>
      </dialog>
    </>
  );
}

type Banner = { tone: "ok" | "warn"; text: string } | null;

function Review() {
  const id = useSearchParams().get("id") ?? "";
  const { api } = useApp();
  const themes = useLoad((a) => a.listThemes(), "themes");
  const theme = themes.data?.find((t) => t.id === id);
  const [status, setStatus] = useState<SubmissionStatus>("submitted");
  const [items, setItems] = useState<Submission[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const detail = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api.listSubmissions(id, status).then(
      (page) => {
        if (cancelled) return;
        setItems(page.submissions);
        setCursor(page.nextCursor);
        setError(null);
        // Keep the open entry through a reload; otherwise start at the first.
        setSelectedId((current) => (page.submissions.some((s) => s.id === current) ? current : (page.submissions[0]?.id ?? null)));
      },
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load submissions. Check your connection and try again.")),
    );
    return () => { cancelled = true; };
  }, [api, id, status, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const index = items?.findIndex((s) => s.id === selectedId) ?? -1;
  const selected = items && index >= 0 ? items[index] : null;
  const points = theme?.pointsReward ?? 0;

  const go = useCallback((delta: number) => {
    if (!items || items.length === 0) return;
    const next = items[Math.min(items.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))];
    setSelectedId(next.id);
    detail.current?.scrollIntoView?.({ block: "nearest" });
  }, [items, index]);

  // Keyboard flow: J next, K previous, A approve, R request changes. Ignored while typing or in a dialog.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      if (key === "j") go(1);
      else if (key === "k") go(-1);
      else if ((key === "a" || key === "r") && selected?.status === "submitted") { event.preventDefault(); setDialog(key === "a" ? "approve" : "reject"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, selected]);

  /** After a review the entry leaves the pending list; the next one opens so reviewing can keep going. */
  function removeAndAdvance(done: Submission) {
    if (!items) return;
    const at = items.findIndex((s) => s.id === done.id);
    const rest = items.filter((s) => s.id !== done.id);
    setItems(rest);
    setSelectedId(rest[Math.min(at, rest.length - 1)]?.id ?? null);
  }

  /** The server's answers that mean "someone else got there first" are explained, not shown as failures. */
  function explain(failure: unknown, who: string): boolean {
    if (!(failure instanceof ApiError)) return false;
    if (failure.reason === "SUBMISSION_CHANGED") {
      setBanner({ tone: "warn", text: `${who} changed this submission while you were reviewing it. It is reloaded below: check the update, then review again.` });
    } else if (failure.reason === "SUBMISSION_NOT_PENDING" || failure.reason === "SUBMISSION_LOCKED") {
      setBanner({ tone: "warn", text: `${who}’s submission was already reviewed, so nothing changed. The list is up to date.` });
    } else return false;
    reload();
    return true;
  }

  async function approve(item: Submission) {
    try {
      const result = await api.approveSubmission(item);
      setDialog(null);
      if (result.replayed) {
        setBanner({ tone: "warn", text: `${item.userName}’s submission was already approved, so no points were awarded again.` });
        reload();
      } else {
        setBanner({ tone: "ok", text: `Approved ${item.userName}. ${result.pointsAwarded} points awarded.` });
        removeAndAdvance(item);
      }
    } catch (failure) {
      if (explain(failure, item.userName)) { setDialog(null); return; }
      throw failure;
    }
  }
  async function reject(item: Submission, note: string) {
    try {
      const result = await api.rejectSubmission(item, note);
      setDialog(null);
      if (result.replayed) {
        setBanner({ tone: "warn", text: `${item.userName}’s submission was already sent back.` });
        reload();
      } else {
        setBanner({ tone: "ok", text: `Sent ${item.userName}’s submission back with your note. They can resubmit while the week is open.` });
        removeAndAdvance(item);
      }
    } catch (failure) {
      if (explain(failure, item.userName)) { setDialog(null); return; }
      throw failure;
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const page = await api.listSubmissions(id, status, cursor);
      setItems((list) => [...(list ?? []), ...page.submissions]);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure : null);
    } finally {
      setMore(false);
    }
  }

  function chooseStatus(next: SubmissionStatus) {
    setStatus(next); setItems(null); setSelectedId(null); setBanner(null); setError(null);
  }

  if (themes.error) return <LoadError error={themes.error} onRetry={themes.reload} />;
  if (themes.data && !theme) {
    return <LoadError error={new ApiError("not-found", "That weekly theme doesn’t exist.")} onRetry={themes.reload} backHref="/challenges/" backLabel="Back to challenges" />;
  }

  return (
    <>
      <div className="toolbar">
        <Link className="pill-btn gray" href="/challenges/">All themes</Link>
        {theme && <><strong className="theme-name">{theme.title}</strong><span className="muted">{formatWindow(theme.startDate, theme.endDate)} · {formatGoal(theme.goal, theme.goalUnit)}</span></>}
      </div>
      <div className="tabs" role="group" aria-label="Filter submissions">
        {TABS.map((tab) => <button key={tab} className="tab" aria-pressed={status === tab} onClick={() => chooseStatus(tab)}>{SUBMISSION_STATUS_LABEL[tab]}</button>)}
      </div>
      {banner && <div className={`review-banner ${banner.tone}`} role="status"><span>{banner.text}</span><button className="pill-btn gray small" onClick={() => setBanner(null)}>Dismiss</button></div>}

      {error ? <LoadError error={error} onRetry={reload} backHref="/challenges/" backLabel="Back to challenges" />
        : !items ? <Loading label="Loading submissions" />
        : items.length === 0 ? <Empty title={EMPTY[status].title} body={EMPTY[status].body} />
        : (
          <div className="review-layout">
            <section aria-label="Submissions" className="queue-wrap">
              <ul className="queue">
                {items.map((item) => (
                  <li key={item.id}>
                    <button className="queue-item" aria-current={item.id === selectedId ? "true" : undefined} onClick={() => { setSelectedId(item.id); detail.current?.scrollIntoView?.({ block: "nearest" }); }}>
                      <Avatar name={item.userName} />
                      <span className="queue-text">
                        <strong>{item.userName}</strong>
                        <span className="muted">{item.progress} of {theme?.goal ?? "?"} {theme?.goalUnit ?? ""} · {formatDateTime(item.updatedAt)}</span>
                      </span>
                      {item.attempt > 1 && <Info>Attempt {item.attempt}</Info>}
                      {!item.storagePath && <Info>No photo</Info>}
                    </button>
                  </li>
                ))}
              </ul>
              {cursor && <div className="actions"><button className="pill-btn gray" disabled={more} onClick={() => void loadMore()}>{more ? "Loading…" : "Show more"}</button></div>}
            </section>

            {selected && theme && (
              <article className="review-detail panel" ref={detail} aria-label={`Submission from ${selected.userName}`}>
                <div className="review-head">
                  <div className="person big"><Avatar name={selected.userName} /><div><h2>{selected.userName}</h2><p className="muted">Submitted {formatDateTime(selected.createdAt)}{selected.updatedAt !== selected.createdAt ? `, updated ${formatDateTime(selected.updatedAt)}` : ""}</p></div></div>
                  <div className="review-pills">
                    <Info tone={selected.status === "approved" ? "ok" : selected.status === "rejected" ? "warn" : undefined}>{SUBMISSION_STATUS_LABEL[selected.status]}</Info>
                    {selected.attempt > 1 && <Info>Attempt {selected.attempt}</Info>}
                  </div>
                </div>
                <div className="review-actions">
                  {selected.status === "submitted" && (
                    <div className="actions">
                      <button className="pill-btn dark" onClick={() => setDialog("approve")}>Approve · {points} points</button>
                      <button className="pill-btn gray" onClick={() => setDialog("reject")}>Request changes</button>
                    </div>
                  )}
                  <div className="review-nav">
                    <button className="pill-btn gray small" onClick={() => go(-1)} disabled={index <= 0}>Previous</button>
                    <span className="muted" aria-live="polite">{index + 1} of {items.length}{cursor ? "+" : ""}</span>
                    <button className="pill-btn gray small" onClick={() => go(1)} disabled={index >= items.length - 1}>Next</button>
                  </div>
                  <p className="hint keys">Keys: <kbd>J</kbd> next, <kbd>K</kbd> previous{selected.status === "submitted" && <>, <kbd>A</kbd> approve, <kbd>R</kbd> request changes</>}.</p>
                </div>
                <dl className="facts">
                  <div><dt>Progress</dt><dd>{selected.progress} of {formatGoal(theme.goal, theme.goalUnit)}</dd></div>
                  <div><dt>Reward</dt><dd>{theme.pointsReward} points</dd></div>
                </dl>
                <div>
                  <h3>Member’s note</h3>
                  {selected.caption ? <blockquote className="member-note">{selected.caption}</blockquote> : <p className="muted">No note.</p>}
                </div>
                <div><h3>Evidence</h3><Evidence submission={selected} /></div>

                {selected.status === "approved" && <p className="review-result ok" role="status">Approved{selected.reviewedAt ? ` on ${formatDateTime(selected.reviewedAt)}` : ""}. {selected.pointsAwarded} points awarded. Approvals are final.</p>}
                {selected.status === "rejected" && (
                  <div className="review-result warn" role="status">
                    <p>Sent back{selected.reviewedAt ? ` on ${formatDateTime(selected.reviewedAt)}` : ""}. It stays here until the member resubmits.</p>
                    {selected.reviewNote && <blockquote className="member-note">{selected.reviewNote}</blockquote>}
                  </div>
                )}

              </article>
            )}
          </div>
        )}

      {dialog === "approve" && selected && (
        <Dialog title={`Approve ${selected.userName}?`} confirmLabel={`Approve and award ${points} points`} onClose={() => setDialog(null)} onConfirm={() => approve(selected)}>
          <p><strong>{points} points</strong> are added to {selected.userName}’s balance now. Approvals are final and can’t be undone.</p>
          {selected.caption && <p className="muted">“{selected.caption}”</p>}
        </Dialog>
      )}
      {dialog === "reject" && selected && (
        <Dialog title={`Request changes from ${selected.userName}?`} confirmLabel="Send back" reasonLabel="What should they change?" reasonMax={280} reasonHint="The member sees this note." onClose={() => setDialog(null)} onConfirm={(note) => reject(selected, note)}>
          <p>The submission goes back to {selected.userName}. They can edit and resubmit while the week is open.</p>
        </Dialog>
      )}
    </>
  );
}

export default function ChallengeReviewPage() {
  return (
    <Shell title="Review submissions" subtitle="Approve to award the points, or send it back with a note. Use J and K to move between entries." requires="challenges.review">
      <Suspense fallback={<Loading label="Loading submissions" />}><Review /></Suspense>
    </Shell>
  );
}
