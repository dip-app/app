"use client";
// @i18n-migrated

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell, useShellHeader } from "@/components/Shell";
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
import { ignoredKey, isGoPending, useShortcutsEnabled } from "@/lib/shortcuts";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { Button } from "@/components/kit";
import { t, type MessageKey } from "@/lib/i18n";

const TABS: SubmissionStatus[] = ["submitted", "rejected", "approved"];
const STATUS_KEY: Record<SubmissionStatus, MessageKey> = { submitted: "review.status.submitted", rejected: "review.status.rejected", approved: "review.status.approved" };
const statusLabel = (status: SubmissionStatus) => t(STATUS_KEY[status]);
const DEFAULTS = { status: "submitted" };
// Single-key shortcuts can be switched off (WCAG 2.1.4): one portal-wide setting (lib/shortcuts.ts), so this page's
// switch and the shortcut list ("?") always agree.
const EMPTY_KEYS: Record<SubmissionStatus, { title: MessageKey; body: MessageKey }> = {
  submitted: { title: "review.empty.submitted.title", body: "review.empty.submitted.body" },
  rejected: { title: "review.empty.rejected.title", body: "review.empty.rejected.body" },
  approved: { title: "review.empty.approved.title", body: "review.empty.approved.body" },
};

/** Single-key shortcuts shown next to the buttons; the labels are translated at render. */
function keyHints(canReview: boolean): { key: string; label: string; press: string }[] {
  const hints = [
    { key: "J", label: t("review.keys.next"), press: t("review.keys.pressNext") },
    { key: "K", label: t("review.keys.previous"), press: t("review.keys.pressPrevious") },
  ];
  if (canReview) hints.push({ key: "A", label: t("review.keys.approve"), press: t("review.keys.pressApprove") }, { key: "R", label: t("review.keys.requestChanges"), press: t("review.keys.pressRequestChanges") });
  return hints;
}

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

  if (!path) return <div className="evidence none"><p>{t("review.photo.none")}</p></div>;
  if (failed) return <div className="evidence none" role="alert"><p>{t("review.photo.failed")}</p></div>;
  if (!url) return <div className="evidence loading" role="status" aria-label={t("review.photo.loading")} />;
  return (
    <>
      <button className="evidence" onClick={() => setOpen(true)} aria-label={t("review.photo.viewAria", { who: submission.userName })}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={t("review.photo.alt", { who: submission.userName })} draggable={false} />
        <span className="view-full">{t("review.photo.viewFull")}</span>
      </button>
      <dialog ref={dialog} className="dialog viewer" aria-label={t("review.photo.dialogLabel", { who: submission.userName })} onClose={() => setOpen(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="photo-frame large" src={url} alt={t("review.photo.alt", { who: submission.userName })} draggable={false} />
        <div className="actions"><Button onClick={() => setOpen(false)}>{t("review.photo.close")}</Button></div>
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
  useShellHeader(theme ? {
    title: theme.title, metaKey: theme.id,
    meta: <><ThemeArt url={theme.coverImageURL} title={theme.title} className="thumb art tile meta-art" /><span>{t("review.themeMeta", { window: formatWindow(theme.startDate, theme.endDate), goal: formatGoal(theme.goal, theme.goalUnit) })}</span></>,
  } : null);
  const [qs, setQs] = useQueryState(DEFAULTS);
  const status = oneOf(qs.status, TABS, "submitted");
  const [shortcuts, setShortcuts] = useShortcutsEnabled();
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
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("review.error.loadFailed"))),
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
      // Typing, composing text, or the letter after "g" (go to a page) is not a review shortcut.
      if (isTypingTarget(event.target) || ignoredKey(event) || isGoPending()) return;
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      if (key === "j") go(1);
      else if (key === "k") go(-1);
      else if ((key === "a" || key === "r") && selected?.status === "submitted") { event.preventDefault(); setDialog(key === "a" ? "approve" : "reject"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, selected, shortcuts]);

  // Runs after the dialog has closed and returned focus to its opener, so this wins: the next person's name, or the
  // empty state's heading, gets focus and the change is announced.
  const [advanced, setAdvanced] = useState<{ name: string | null; n: number } | null>(null);
  useEffect(() => {
    if (!advanced) return;
    const heading = document.querySelector<HTMLElement>("#main .review-detail h2, #main .empty h2");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus();
  }, [advanced]);

  /** After a review the entry leaves the pending list; the next one opens so reviewing can keep going. */
  function removeAndAdvance(done: Submission) {
    if (!items) return;
    const at = items.findIndex((s) => s.id === done.id);
    const rest = items.filter((s) => s.id !== done.id);
    setItems(rest);
    const nextUp = rest[Math.min(at, rest.length - 1)];
    setSelectedId(nextUp?.id ?? null);
    // Focus follows to the next person (or the empty queue), not the old Approve button, which now acts on someone else.
    setAdvanced({ name: nextUp?.userName ?? null, n: (advanced?.n ?? 0) + 1 });
    // The visible page is used up but the server has more: fetch the next ones instead of showing an empty queue.
    if (rest.length === 0 && cursor) void loadMore(rest);
  }

  /** The server's answers that mean "someone else got there first" are explained, not shown as failures. */
  function explain(failure: unknown, who: string): boolean {
    if (!(failure instanceof ApiError)) return false;
    if (failure.reason === "SUBMISSION_CHANGED") {
      setBanner({ tone: "warn", text: t("review.banner.changed", { who }) });
    } else if (failure.reason === "SUBMISSION_NOT_PENDING" || failure.reason === "SUBMISSION_LOCKED") {
      setBanner({ tone: "warn", text: t("review.banner.alreadyReviewed", { who }) });
    } else return false;
    reload();
    return true;
  }

  async function approve(item: Submission) {
    try {
      const result = await api.approveSubmission(item);
      setDialog(null);
      if (result.replayed) {
        setBanner({ tone: "warn", text: t("review.banner.alreadyApproved", { who: item.userName }) });
        reload();
      } else {
        setBanner(null);
        toast(t("review.toast.approved", { who: item.userName, points: result.pointsAwarded }));
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
        setBanner({ tone: "warn", text: t("review.banner.alreadyRejected", { who: item.userName }) });
        reload();
      } else {
        setBanner(null);
        toast(t("review.toast.rejected", { who: item.userName }));
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

  const backLabel = t("review.backToChallenges");
  if (!id) return <LoadError error={new ApiError("not-found", t("review.error.noTheme"))} onRetry={themes.reload} backHref="/challenges/?tab=review" backLabel={backLabel} />;
  if (themes.error) return <LoadError error={themes.error} onRetry={themes.reload} backHref="/challenges/?tab=review" backLabel={backLabel} />;
  if (themes.data && !theme) {
    return <LoadError error={new ApiError("not-found", t("review.error.themeMissing"))} onRetry={themes.reload} backHref="/challenges/?tab=review" backLabel={backLabel} />;
  }

  return (
    <>
      <span className="sr-only" role="status">{advanced?.name ? t("review.nowShowing", { who: advanced.name }) : ""}</span>
      <Tabs idBase="review" label={t("review.filterLabel")} value={status} onChange={(id) => chooseStatus(id as SubmissionStatus)} items={TABS.map((tab) => ({ id: tab, label: statusLabel(tab) }))} />
      {banner && <div className={`review-banner ${banner.tone}`} role="status"><span>{banner.text}</span><Button size="sm" onClick={() => setBanner(null)}>{t("review.banner.dismiss")}</Button></div>}

      {error ? <LoadError error={error} onRetry={reload} backHref="/challenges/?tab=review" backLabel={backLabel} />
        : !items ? <Loading label={t("review.loading")} layout="review" />
        : items.length === 0 ? (
          cursor ? <Loading label={t("review.loadingMore")} /> : <Empty title={t(EMPTY_KEYS[status].title)} body={t(EMPTY_KEYS[status].body)} />
        )
        : (
          <div className="review-layout" {...tabPanelProps("review", status)}>
            <section aria-label={t("review.queueLabel")} className="queue-wrap" ref={queueTop}>
              <ul className="queue">
                {items.map((item) => (
                  <li key={item.id}>
                    <button className="queue-item" aria-current={item.id === selectedId ? "true" : undefined} onClick={() => { setSelectedId(item.id); detail.current?.scrollIntoView?.({ block: "nearest" }); }}>
                      <Avatar name={item.userName} userId={item.userId} photoURL={item.photoURL} avatarId={item.avatarId} />
                      <span className="queue-text">
                        <strong>{item.userName}</strong>
                        <span className="muted">{t("review.queue.progress", { progress: item.progress, goal: theme?.goal ?? "?", unit: theme?.goalUnit ?? "", when: formatDateTime(item.updatedAt) })}</span>
                        {(item.attempt > 1 || !item.storagePath) && <span className="queue-chips">{item.attempt > 1 && <Info>{t("review.attempt", { n: item.attempt })}</Info>}{!item.storagePath && <Info>{t("review.noPhotoChip")}</Info>}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {cursor && <LoadMore shown={items.length} loading={more} onClick={() => void loadMore()} />}
            </section>

            {selected && theme && (
              <article className="review-detail panel" ref={detail} aria-label={t("review.detail.label", { who: selected.userName })}>
                <div className="review-head">
                  <div className="person big"><Avatar name={selected.userName} userId={selected.userId} photoURL={selected.photoURL} avatarId={selected.avatarId} /><div><h2 tabIndex={-1}>{selected.userName}</h2><p className="muted">{selected.updatedAt !== selected.createdAt ? t("review.detail.submittedUpdated", { created: formatDateTime(selected.createdAt), updated: formatDateTime(selected.updatedAt) }) : t("review.detail.submitted", { created: formatDateTime(selected.createdAt) })}</p></div></div>
                  <div className="review-pills">
                    <Info tone={selected.status === "approved" ? "ok" : selected.status === "rejected" ? "warn" : undefined}>{statusLabel(selected.status)}</Info>
                    {selected.attempt > 1 && <Info>{t("review.attempt", { n: selected.attempt })}</Info>}
                  </div>
                </div>
                <div className="review-actions">
                  {selected.status === "submitted" && (
                    <div className="actions">
                      <Button variant="primary" onClick={() => setDialog("approve")}>{t("review.action.approve", { points })}</Button>
                      <Button onClick={() => setDialog("reject")}>{t("review.action.requestChanges")}</Button>
                    </div>
                  )}
                  <div className="review-nav">
                    <Button size="sm" onClick={() => go(-1)} disabled={index <= 0}>{t("review.nav.previous")}</Button>
                    <span className="muted" aria-live="polite">{t("review.nav.position", { current: index + 1, total: items.length, more: cursor ? "+" : "" })}</span>
                    <Button size="sm" onClick={() => go(1)} disabled={index >= items.length - 1}>{t("review.nav.next")}</Button>
                    <Button size="sm" className="to-list" onClick={() => queueTop.current?.scrollIntoView?.({ block: "start" })}>{t("review.nav.backToList")}</Button>
                  </div>
                  <div className="keys-toggle">
                    {shortcuts && (
                      <ul className="key-hints" aria-label={t("review.keys.label")}>
                        {keyHints(selected.status === "submitted").map(({ key, label, press }) => (
                          <li key={key} aria-label={t("review.keys.press", { key, action: press })}><kbd aria-hidden>{key}</kbd><span aria-hidden>{label}</span></li>
                        ))}
                      </ul>
                    )}
                    <Toggle checked={shortcuts} onChange={setShortcuts} label={t("review.keys.label")} hint={t("review.keys.hint")} />
                  </div>
                </div>
                <dl className="facts">
                  <div><dt>{t("review.facts.progress")}</dt><dd>{t("review.facts.progressValue", { progress: selected.progress, goal: formatGoal(theme.goal, theme.goalUnit) })}</dd></div>
                  <div><dt>{t("review.facts.reward")}</dt><dd>{t("review.facts.rewardValue", { points: theme.pointsReward })}</dd></div>
                </dl>
                <div>
                  <h3>{t("review.note.heading")}</h3>
                  {selected.caption ? <blockquote className="member-note">{selected.caption}</blockquote> : <p className="muted">{t("review.note.none")}</p>}
                </div>
                <div><h3>{t("review.evidence.heading")}</h3><Evidence submission={selected} /></div>

                {selected.status === "approved" && <p className="review-result ok" role="status">{selected.reviewedAt ? t("review.result.approvedOn", { when: formatDateTime(selected.reviewedAt), points: selected.pointsAwarded }) : t("review.result.approved", { points: selected.pointsAwarded })}</p>}
                {selected.status === "rejected" && (
                  <div className="review-result warn" role="status">
                    <p>{selected.reviewedAt ? t("review.result.rejectedOn", { when: formatDateTime(selected.reviewedAt) }) : t("review.result.rejected")}</p>
                    {selected.reviewNote && <blockquote className="member-note">{selected.reviewNote}</blockquote>}
                  </div>
                )}

              </article>
            )}
          </div>
        )}

      {dialog === "approve" && selected && (
        <Dialog title={t("review.approve.title", { who: selected.userName })} confirmLabel={t("review.approve.confirm", { points })} focusCancel busyLabel={t("review.approve.busy")} onClose={() => setDialog(null)} onConfirm={() => approve(selected)}>
          <p className="muted">{t(selected.storagePath ? "review.approve.summaryPhoto" : "review.approve.summaryNoPhoto", { progress: selected.progress, goal: formatGoal(theme?.goal ?? 0, theme?.goalUnit ?? "") })}</p>
          <p><strong>{t("review.approve.pointsBold", { points })}</strong>{" "}{t("review.approve.addedNow", { who: selected.userName })}</p>
          {selected.caption && <p className="muted">“{selected.caption}”</p>}
        </Dialog>
      )}
      {dialog === "reject" && selected && (
        <Dialog title={t("review.reject.title", { who: selected.userName })} confirmLabel={t("review.reject.confirm")} busyLabel={t("review.reject.busy")} reasonLabel={t("review.reject.reasonLabel")} reasonMax={280} reasonHint={t("review.reject.reasonHint")} onClose={() => setDialog(null)} onConfirm={(note) => reject(selected, note)}>
          <p>{t("review.reject.body", { who: selected.userName })}</p>
        </Dialog>
      )}
    </>
  );
}

export default function ChallengeReviewPage() {
  return (
    <Shell title={t("review.title")} subtitle={t("review.subtitle")} requires="challenges.review" back={{ href: "/challenges/?tab=review", label: t("shell.nav.challenges") }}>
      <Suspense fallback={<Loading label={t("review.loading")} layout="review" />}><Review /></Suspense>
    </Shell>
  );
}
