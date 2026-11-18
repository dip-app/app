"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { ThemeArt } from "@/components/ThemeArt";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { toast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { Avatar, Empty, Info, LoadError, LoadMore, Loading, formatDateTime } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import type { Submission, SubmissionStatus } from "@/lib/adminTypes";
import { formatGoal } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";
import { formatWindow } from "@/lib/weeks";
import { isTypingTarget } from "@/lib/useSlashFocus";
import { oneOf, useQueryState } from "@/lib/useQueryState";

const TABS: SubmissionStatus[] = ["submitted", "rejected", "approved"];
const STATUS_LABEL: Record<SubmissionStatus, string> = { submitted: "Pending", rejected: "Changes requested", approved: "Approved" };
const DEFAULTS = { status: "submitted" };
const KEYS_STORAGE = "dip-admin-review-keys";
const NO_THEME = new ApiError("not-found", "No weekly theme was selected. Pick one from the challenges list.");

/** Single-key shortcuts can be switched off (WCAG 2.1.4). The choice is remembered in this browser; storage may be blocked. */
function useShortcutsSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try { if (window.localStorage.getItem(KEYS_STORAGE) === "off") setOn(false); } catch { /* storage blocked: keep the default */ }
  }, []);
  return [on, (next) => {
    setOn(next);
    try { window.localStorage.setItem(KEYS_STORAGE, next ? "on" : "off"); } catch { /* the choice just won't be remembered */ }
  }];
}
const EMPTY: Record<SubmissionStatus, { title: string; body: string }> = {
  submitted: { title: "Nothing waiting for review", body: "New submissions show up here as people send them in." },
  rejected: { title: "No changes requested", body: "Entries you ask to change wait here until the member resubmits." },
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
      (value) => {
        made = value;
        if (cancelled) { if (value.startsWith("blob:")) URL.revokeObjectURL(value); return; }
        setUrl(value);
      },
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
      <button className="evidence" onClick={() => setOpen(true)} aria-label={`View full size: photo from ${submission.userName}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Evidence from ${submission.userName}`} />
        <span className="view-full">View full size</span>
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
  const [qs, setQs] = useQueryState(DEFAULTS);
  const status = oneOf(qs.status, TABS, "submitted");
  const [shortcuts, setShortcuts] = useShortcutsSetting();
  const [items, setItems] = useState<Submission[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const detail = useRef<HTMLElement>(null);
  const queueTop = useRef<HTMLElement>(null);
  const idRef = useRef(id);
  const statusRef = useRef(status);
  idRef.current = id;
  statusRef.current = status;

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

  // Keyboard flow: J next, K previous, A approve, R request changes. Off when the reviewer turns it off; ignored while typing or in a dialog.
  useEffect(() => {
    if (!shortcuts) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      if (key === "j") go(1);
      else if (key === "k") go(-1);
      else if ((key === "a" || key === "r") && selected?.status === "submitted") { event.preventDefault(); setDialog(key === "a" ? "approve" : "reject"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, selected, shortcuts]);

  /** After a review the entry leaves the pending list; the next one opens so reviewing can keep going. */
  function removeAndAdvance(done: Submission) {
    if (!items) return;
    const at = items.findIndex((s) => s.id === done.id);
    const rest = items.filter((s) => s.id !== done.id);
    setItems(rest);
    setSelectedId(rest[Math.min(at, rest.length - 1)]?.id ?? null);
    // The visible page is used up but the server has more: fetch the next ones instead of showing an empty queue.
    if (rest.length === 0 && cursor) void loadMore(rest);
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
        setBanner(null);
        toast(`Approved ${item.userName}. ${result.pointsAwarded} points awarded.`);
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
        setBanner({ tone: "warn", text: `You already requested changes from ${item.userName}.` });
        reload();
      } else {
        setBanner(null);
        toast(`Requested changes from ${item.userName}. They can resubmit while the week is open.`);
        removeAndAdvance(item);
      }
    } catch (failure) {
      if (explain(failure, item.userName)) { setDialog(null); return; }
      throw failure;
    }
  }

  async function loadMore(base?: Submission[]) {
    if (!cursor || more) return;
    const asked = { id, status };
    setMore(true);
    try {
      const page = await api.listSubmissions(id, status, cursor);
      // The reviewer may have switched tab or theme meanwhile; a late page belongs to the old list.
      if (asked.id !== idRef.current || asked.status !== statusRef.current) return;
      setItems((list) => [...(base ?? list ?? []), ...page.submissions]);
      setCursor(page.nextCursor);
      setSelectedId((current) => current ?? page.submissions[0]?.id ?? null);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure : null);
    } finally {
      setMore(false);
    }
  }

  function chooseStatus(next: SubmissionStatus) {
    setQs({ status: next }); setItems(null); setSelectedId(null); setBanner(null); setError(null);
  }

  if (!id) return <LoadError error={NO_THEME} onRetry={themes.reload} backHref="/challenges/" backLabel="Back to challenges" />;
  if (themes.error) return <LoadError error={themes.error} onRetry={themes.reload} backHref="/challenges/" backLabel="Back to challenges" />;
  if (themes.data && !theme) {
    return <LoadError error={new ApiError("not-found", "That weekly theme doesn’t exist.")} onRetry={themes.reload} backHref="/challenges/" backLabel="Back to challenges" />;
  }

  return (
    <>
      <div className="toolbar">
        <Link className="pill-btn gray" href="/challenges/">All themes</Link>
        {theme && <><ThemeArt url={theme.coverImageURL} title={theme.title} className="thumb art tile" /><strong className="theme-name">{theme.title}</strong><span className="muted">{formatWindow(theme.startDate, theme.endDate)} · {formatGoal(theme.goal, theme.goalUnit)}</span></>}
      </div>
      <Tabs idBase="review" label="Filter submissions" value={status} onChange={(id) => chooseStatus(id as SubmissionStatus)} items={TABS.map((tab) => ({ id: tab, label: STATUS_LABEL[tab] }))} />
      {banner && <div className={`review-banner ${banner.tone}`} role="status"><span>{banner.text}</span><button type="button" className="pill-btn gray small" onClick={() => setBanner(null)}>Dismiss</button></div>}

      {error ? <LoadError error={error} onRetry={reload} backHref="/challenges/" backLabel="Back to challenges" />
        : !items ? <Loading label="Loading submissions" />
        : items.length === 0 ? (
          cursor ? <Loading label="Loading more submissions" /> : <Empty title={EMPTY[status].title} body={EMPTY[status].body} />
        )
        : (
          <div className="review-layout" {...tabPanelProps("review", status)}>
            <section aria-label="Submissions" className="queue-wrap" ref={queueTop}>
              <ul className="queue">
                {items.map((item) => (
                  <li key={item.id}>
                    <button className="queue-item" aria-current={item.id === selectedId ? "true" : undefined} onClick={() => { setSelectedId(item.id); detail.current?.scrollIntoView?.({ block: "nearest" }); }}>
                      <Avatar name={item.userName} userId={item.userId} photoURL={item.photoURL} avatarId={item.avatarId} />
                      <span className="queue-text">
                        <strong>{item.userName}</strong>
                        <span className="muted">{item.progress} of {theme?.goal ?? "?"} {theme?.goalUnit ?? ""} · {formatDateTime(item.updatedAt)}</span>
                        {(item.attempt > 1 || !item.storagePath) && <span className="queue-chips">{item.attempt > 1 && <Info>Attempt {item.attempt}</Info>}{!item.storagePath && <Info>No photo</Info>}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {cursor && <LoadMore shown={items.length} loading={more} onClick={() => void loadMore()} />}
            </section>

            {selected && theme && (
              <article className="review-detail panel" ref={detail} aria-label={`Submission from ${selected.userName}`}>
                <div className="review-head">
                  <div className="person big"><Avatar name={selected.userName} userId={selected.userId} photoURL={selected.photoURL} avatarId={selected.avatarId} /><div><h2>{selected.userName}</h2><p className="muted">Submitted {formatDateTime(selected.createdAt)}{selected.updatedAt !== selected.createdAt ? `, updated ${formatDateTime(selected.updatedAt)}` : ""}</p></div></div>
                  <div className="review-pills">
                    <Info tone={selected.status === "approved" ? "ok" : selected.status === "rejected" ? "warn" : undefined}>{STATUS_LABEL[selected.status]}</Info>
                    {selected.attempt > 1 && <Info>Attempt {selected.attempt}</Info>}
                  </div>
                </div>
                <div className="review-actions">
                  {selected.status === "submitted" && (
                    <div className="actions">
                      <button type="button" className="pill-btn dark" onClick={() => setDialog("approve")}>Approve · {points} points</button>
                      <button className="pill-btn gray" onClick={() => setDialog("reject")}>Request changes</button>
                    </div>
                  )}
                  <div className="review-nav">
                    <button className="pill-btn gray small" onClick={() => go(-1)} disabled={index <= 0}>Previous</button>
                    <span className="muted" aria-live="polite">{index + 1} of {items.length}{cursor ? "+" : ""}</span>
                    <button className="pill-btn gray small" onClick={() => go(1)} disabled={index >= items.length - 1}>Next</button>
                    <button className="pill-btn gray small to-list" onClick={() => queueTop.current?.scrollIntoView?.({ block: "start" })}>Back to list</button>
                  </div>
                  <div className="keys-toggle">
                    {shortcuts && (
                      <ul className="key-hints" aria-label="Keyboard shortcuts">
                        {[["J", "Next"], ["K", "Previous"], ...(selected.status === "submitted" ? [["A", "Approve"], ["R", "Request changes"]] : [])].map(([key, action]) => (
                          <li key={key} aria-label={`Press ${key} for ${action.toLowerCase()}`}><kbd aria-hidden>{key}</kbd><span aria-hidden>{action}</span></li>
                        ))}
                      </ul>
                    )}
                    <Toggle checked={shortcuts} onChange={setShortcuts} label="Keyboard shortcuts" hint="Single-key shortcuts for this page. Turn them off if they get in the way." />
                  </div>
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
                    <p>Changes requested{selected.reviewedAt ? ` on ${formatDateTime(selected.reviewedAt)}` : ""}. It stays here until the member resubmits.</p>
                    {selected.reviewNote && <blockquote className="member-note">{selected.reviewNote}</blockquote>}
                  </div>
                )}

              </article>
            )}
          </div>
        )}

      {dialog === "approve" && selected && (
        <Dialog title={`Approve ${selected.userName}?`} confirmLabel={`Approve and award ${points} points`} focusCancel busyLabel="Approving…" onClose={() => setDialog(null)} onConfirm={() => approve(selected)}>
          <p className="muted">{selected.progress} of {formatGoal(theme?.goal ?? 0, theme?.goalUnit ?? "")}{selected.storagePath ? ", with a photo" : ", no photo"}.</p>
          <p><strong>{points} points</strong> are added to {selected.userName}’s balance now. Approvals are final and can’t be undone.</p>
          {selected.caption && <p className="muted">“{selected.caption}”</p>}
        </Dialog>
      )}
      {dialog === "reject" && selected && (
        <Dialog title={`Request changes from ${selected.userName}?`} confirmLabel="Request changes" busyLabel="Requesting changes…" reasonLabel="What should they change?" reasonMax={280} reasonHint="The member sees this note." onClose={() => setDialog(null)} onConfirm={(note) => reject(selected, note)}>
          <p>{selected.userName} gets your note and the submission goes back to them. They can edit and resubmit while the week is open.</p>
        </Dialog>
      )}
    </>
  );
}

export default function ChallengeReviewPage() {
  return (
    <Shell title="Review submissions" subtitle="Approve to award the points, or request changes with a note. Use J and K to move between entries, or turn the shortcuts off." requires="challenges.review">
      <Suspense fallback={<Loading label="Loading submissions" />}><Review /></Suspense>
    </Shell>
  );
}
