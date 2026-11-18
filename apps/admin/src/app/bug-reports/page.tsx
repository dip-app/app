"use client";
// @i18n-migrated

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { toast } from "@/components/Toast";
import { Avatar, Empty, Info, LoadError, LoadMore, Loading, ResultCount, SearchBox, formatDateTime } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { useDebounced, usePaged } from "@/components/usePaged";
import { ApiError } from "@/lib/contract";
import {
  LIST_PAGE_SIZE, type BugCategory, type BugDiagnostics, type BugReport, type BugReportCounts, type BugReportDetail, type BugReportQuery, type BugStatus,
} from "@/lib/adminTypes";
import { setBugBadge } from "@/lib/bugBadge";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { BUG_CATEGORIES, BUG_STATUSES, issueText } from "@/lib/bugReports";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, EmptyState, InlineNotice } from "@/components/kit";
import { formatNumber, t, type MessageKey } from "@/lib/i18n";

type StatusFilter = BugStatus | "all";
const number = (n: number) => formatNumber(n);
const NOTE_MAX = 2000;
const DEFAULTS = { status: "all", category: "all", from: "", to: "", q: "", report: "" };
const STATUS_TONE: Record<BugStatus, "warn" | "ok" | undefined> = { new: "warn", triaged: undefined, resolved: "ok" };
const statusLabel = (s: BugStatus) => t(`bugs.status.${s}` as MessageKey);
const CATEGORY_KEY: Record<BugCategory, MessageKey> = {
  bug: "bugs.category.bug", confusing: "bugs.category.confusing", looksWrong: "bugs.category.looksWrong", idea: "bugs.category.idea", unspecified: "bugs.category.unspecified",
};
const categoryLabel = (c: BugCategory) => t(CATEGORY_KEY[c]);
const SCREEN_KEY: Record<string, MessageKey> = {
  home: "bugs.screen.home", rewards: "bugs.screen.rewards", myEvents: "bugs.screen.myEvents", profile: "bugs.screen.profile", event: "bugs.screen.event",
  participants: "bugs.screen.participants", album: "bugs.screen.album", challenge: "bugs.screen.challenge", other: "bugs.screen.other",
};
/** Known screen ids are translated; an unknown id is shown as sent. */
const screenName = (screen: string) => (Object.hasOwn(SCREEN_KEY, screen) ? t(SCREEN_KEY[screen]) : screen);
/** Diagnostics in display order with translated labels; empty values are left out. */
function diagnosticRows(d: BugDiagnostics | null): { label: string; value: string }[] {
  if (!d) return [];
  const rows: [string, string | undefined][] = [
    [t("bugs.diag.appVersion"), d.appVersion ? `${d.appVersion}${d.appBuild ? ` (${d.appBuild})` : ""}` : d.appBuild], [t("bugs.diag.os"), d.osVersion],
    [t("bugs.diag.device"), d.deviceModel], [t("bugs.diag.language"), d.locale],
    [t("bugs.diag.screen"), d.screen ? screenName(d.screen) : undefined], [t("bugs.diag.install"), d.installId],
  ];
  return rows.filter((row): row is [string, string] => !!row[1]).map(([label, value]) => ({ label, value }));
}
const emptyCopy = (s: StatusFilter) => ({ title: t(`bugs.empty.${s}.title` as MessageKey), body: t(`bugs.empty.${s}.body` as MessageKey) });

/** Screenshot with a lightbox. The link lives 15 minutes; an expired one offers a reload instead of a broken picture. */
function Screenshot({ url, who, onExpired }: { url: string; who: string; onExpired: () => void }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setBroken(false); }, [url]);
  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
    if (!open && el?.open) el.close();
  }, [open]);
  if (broken) {
    return (
      <div className="evidence none" role="alert">
        <p>{t("bugs.shot.expired")}</p>
        <Button type="submit" size="sm" onClick={onExpired}>{t("bugs.shot.reload")}</Button>
      </div>
    );
  }
  return (
    <>
      <button className="evidence shot" onClick={() => setOpen(true)} aria-label={t("bugs.shot.viewLabel", { who })}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={t("bugs.shot.alt", { who })} draggable={false} onError={() => setBroken(true)} />
        <span className="view-full">{t("bugs.shot.viewFull")}</span>
      </button>
      <dialog ref={dialog} className="dialog viewer" aria-label={t("bugs.shot.dialog", { who })} onClose={() => setOpen(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="photo-frame large" src={url} alt={t("bugs.shot.alt", { who })} draggable={false} onError={() => setBroken(true)} />
        <div className="actions"><Button type="submit" onClick={() => setOpen(false)}>{t("bugs.shot.close")}</Button></div>
      </dialog>
    </>
  );
}

interface DetailProps {
  report: BugReport;
  admins: { id: string; name: string }[];
  onSaved: (update: { id: string; status: BugStatus; hasNote: boolean; assigneeId?: string; assigneeName?: string }) => void;
  onBackToList: () => void;
}

function ReportDetail({ report, admins, onSaved, onBackToList }: DetailProps) {
  const { api } = useApp();
  const [detail, setDetail] = useState<BugReportDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<BugStatus>(report.status);
  const [assignee, setAssignee] = useState(report.assigneeId ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; stale?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.getBugReport(report.id).then(
      (value) => {
        if (cancelled) return;
        setDetail(value); setStatus(value.report.status); setAssignee(value.report.assigneeId ?? ""); setNote(value.note);
      },
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("bugs.detail.loadFailed"))),
    );
    return () => { cancelled = true; };
  }, [api, report.id, attempt]);

  const dirty = !!detail && (status !== detail.report.status || assignee !== (detail.report.assigneeId ?? "") || note.trim() !== detail.note);

  async function save() {
    if (!detail) return;
    setSaving(true);
    setMessage(null);
    try {
      const patch = {
        ...(status !== detail.report.status ? { status } : {}), ...(note.trim() !== detail.note ? { note: note.trim() } : {}),
        ...(assignee !== (detail.report.assigneeId ?? "") ? { assigneeId: assignee || null } : {}),
      };
      const result = await api.updateBugReport(report.id, patch, detail.revision);
      const { assigneeId: _a, assigneeName: _n, ...base } = detail.report;
      void _a; void _n;
      const next: BugReportDetail = {
        ...detail, note: result.note, revision: result.revision, updatedAt: result.updatedAt,
        report: { ...base, status: result.status, hasNote: result.note !== "", ...(result.assigneeId ? { assigneeId: result.assigneeId, assigneeName: result.assigneeName ?? "" } : {}) },
      };
      setDetail(next);
      setNote(result.note);
      onSaved({ id: report.id, status: result.status, hasNote: result.note !== "", ...(result.assigneeId ? { assigneeId: result.assigneeId, assigneeName: result.assigneeName ?? "" } : {}) });
      setMessage(null);
      toast(result.changed ? t("bugs.triage.saved") : t("bugs.triage.nothingToChange"));
    } catch (failure) {
      const stale = failure instanceof ApiError && failure.reason === "REVISION_CONFLICT";
      setMessage({ tone: "error", text: stale ? t("bugs.triage.conflict") : describe(failure), stale });
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!detail) return;
    const text = issueText({ ...detail, note: note.trim() });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setMessage({ tone: "error", text: t("bugs.triage.copyFailed") });
    }
  }

  const rows = diagnosticRows(detail?.diagnostics ?? null);
  return (
    <article className="review-detail panel bug-detail" aria-label={t("bugs.detail.label", { name: report.reporterName })}>
      <Button size="sm" className="to-list" onClick={onBackToList}><span aria-hidden>‹ </span>{t("bugs.detail.allReports")}</Button>
      <div className="review-head">
        <div className="person big"><Avatar name={report.reporterName} userId={report.reporterId} photoURL={report.reporterPhotoURL} avatarId={report.reporterAvatarId} /><div><h2>{report.reporterName}</h2><p className="muted">{detail?.reporterEmail || " "}</p></div></div>
        <div className="review-pills">
          <Info>{categoryLabel(report.category)}</Info>
          <Info tone={STATUS_TONE[detail?.report.status ?? report.status]}>{statusLabel(detail?.report.status ?? report.status)}</Info>
        </div>
      </div>
      <p className="muted">{t(report.source === "shake" ? "bugs.detail.sentShake" : "bugs.detail.sentProfile", { when: formatDateTime(report.createdAt), screen: screenName(report.screen) })}</p>

      {error ? <LoadError error={error} onRetry={() => setAttempt((n) => n + 1)} />
        : !detail ? <Loading label={t("bugs.detail.loading")} layout="list" />
        : (
          <>
            <div>
              <h3>{t("bugs.detail.wrote")}</h3>
              {detail.report.description.trim() ? <blockquote className="member-note">{detail.report.description}</blockquote> : <p className="muted">{t("bugs.detail.noDescription")}</p>}
            </div>
            <div>
              <h3>{t("bugs.detail.screenshot")}</h3>
              {detail.screenshotUrl
                ? <Screenshot url={detail.screenshotUrl} who={report.reporterName} onExpired={() => setAttempt((n) => n + 1)} />
                : <div className="evidence none"><p>{detail.report.hasScreenshot ? t("bugs.detail.shotGone") : t("bugs.detail.shotNone")}</p></div>}
            </div>
            <div>
              <h3>{t("bugs.detail.diagnostics")}</h3>
              {rows.length > 0
                ? <dl className="facts diagnostics">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
                : <p className="muted">{t("bugs.detail.noDiagnostics")}</p>}
            </div>

            <form className="triage" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-label={t("bugs.triage.title")}>
              <h3>{t("bugs.triage.title")}</h3>
              <div className="row">
                <div className="field"><label htmlFor="bug-status">{t("bugs.triage.status")}</label>
                  <select id="bug-status" value={status} onChange={(e) => setStatus(e.target.value as BugStatus)}>
                    {BUG_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="bug-assignee">{t("bugs.triage.assignee")}</label>
                  <select id="bug-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">{t("bugs.triage.unassigned")}</option>
                    {detail.report.assigneeId && !admins.some((a) => a.id === detail.report.assigneeId) && <option value={detail.report.assigneeId}>{detail.report.assigneeName ?? t("bugs.triage.formerAdmin")}</option>}
                    {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select></div>
              </div>
              <div className="field"><label htmlFor="bug-note">{t("bugs.triage.note")}</label>
                <textarea id="bug-note" value={note} maxLength={NOTE_MAX} rows={4} onChange={(e) => setNote(e.target.value)} aria-describedby="bug-note-hint" placeholder={t("bugs.triage.notePlaceholder")} />
                <span className="hint" id="bug-note-hint">{detail.updatedAt
                  ? t(detail.updatedByName ? "bugs.triage.hintSavedBy" : "bugs.triage.hintSaved", { length: String(note.length), max: number(NOTE_MAX), when: formatDateTime(detail.updatedAt), name: detail.updatedByName ?? "" })
                  : t("bugs.triage.hint", { length: String(note.length), max: number(NOTE_MAX) })}</span></div>
              {message && <p className={message.tone === "error" ? "error" : "muted"} role={message.tone === "error" ? "alert" : "status"}>{message.text}{message.tone === "error" && message.stale && <> <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>{t("bugs.triage.reload")}</button></>}</p>}
              <div className="actions">
                <Button type="submit" variant="primary" disabled={!dirty || saving}>{saving ? t("bugs.triage.saving") : t("bugs.triage.save")}</Button>

                <Button onClick={() => void copy()}>{copied ? <><span aria-hidden>✓ </span>{t("bugs.triage.copied")}</> : t("bugs.triage.copy")}</Button>
                <span className="sr-only" role="status">{copied ? t("bugs.triage.copiedStatus") : ""}</span>
              </div>
              {!dirty && !saving && <p className="no-changes">{t("bugs.triage.noChanges")}</p>}
            </form>
          </>
        )}
    </article>
  );
}

function BugReports() {
  const { api } = useApp();
  const [qs, setQs] = useQueryState(DEFAULTS);
  const status = oneOf(qs.status, ["all", ...BUG_STATUSES] as const, "all") as StatusFilter;
  const category = oneOf(qs.category, ["all", ...BUG_CATEGORIES] as const, "all") as BugCategory | "all";
  const from = qs.from;
  const to = qs.to;
  const search = qs.q;
  const selectedId = qs.report || null;
  const [autoId, setAutoId] = useState<string | null>(null);
  useSlashFocus("bug-search");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [counts, setCounts] = useState<BugReportCounts | null>(null);
  const query = useDebounced(search.trim());
  const detailTop = useRef<HTMLDivElement>(null);
  const listTop = useRef<HTMLElement>(null);
  const rangeBad = !!from && !!to && from > to;

  const admins = useLoad((a) => a.listMembersPage({ query: "", status: "active", role: "admin", teamId: "all", workLocation: "all" }, null, 100), "bug-admins");
  const adminOptions = useMemo(() => (admins.data?.members ?? []).map((m) => ({ id: m.id, name: m.displayName })), [admins.data]);

  const activeFilters = (category !== "all" ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);
  const filtered = query !== "" || category !== "all" || from !== "" || to !== "";
  const list = usePaged<BugReport, BugReportCounts>(
    async (a, cursor) => {
      const q: BugReportQuery = { query, status, category, from: rangeBad ? "" : from, to: rangeBad ? "" : to };
      const page = await a.listBugReports(q, cursor, LIST_PAGE_SIZE);
      return { items: page.reports, nextCursor: page.nextCursor, extra: page.counts };
    },
    `${status}|${query}|${category}|${from}|${to}|${rangeBad}`,
    LIST_PAGE_SIZE,
  );

  // Counts per status come with the first page; the sidebar badge shows the unfiltered "new" count.
  useEffect(() => {
    if (!list.extra) return;
    setCounts(list.extra);
    if (!filtered) setBugBadge({ count: list.extra.new, capped: list.extra.capped });
  }, [list.extra, filtered]);

  // The report in the URL wins; on wide screens the first one opens by default (not written to the URL).
  const selected = list.items.find((r) => r.id === selectedId) ?? list.items.find((r) => r.id === autoId) ?? null;
  useEffect(() => {
    if (!selected && list.items.length > 0 && typeof window !== "undefined" && window.matchMedia("(min-width: 1001px)").matches) setAutoId(list.items[0].id);
  }, [selected, list.items]);

  const refreshCounts = useCallback(async () => {
    try {
      const page = await api.listBugReports({ query, status: "all", category, from: rangeBad ? "" : from, to: rangeBad ? "" : to }, null, 1);
      if (page.counts) {
        setCounts(page.counts);
        if (!filtered) setBugBadge({ count: page.counts.new, capped: page.counts.capped });
      }
    } catch { /* the counts catch up on the next load */ }
  }, [api, query, category, from, to, rangeBad, filtered]);

  function saved(update: { id: string; status: BugStatus; hasNote: boolean; assigneeId?: string; assigneeName?: string }) {
    list.mutate((items) => items.map((r) => {
      if (r.id !== update.id) return r;
      const { assigneeId: _a, assigneeName: _n, ...rest } = r;
      void _a; void _n;
      return { ...rest, status: update.status, hasNote: update.hasNote, ...(update.assigneeId ? { assigneeId: update.assigneeId, assigneeName: update.assigneeName ?? "" } : {}) };
    }));
    void refreshCounts();
  }

  const total = counts ? counts[status] : null;
  const empty = list.items.length === 0;
  const holdList = useSkeletonGate(list.loading && empty);
  const tabCount = (id: StatusFilter) => `${number(counts?.[id] ?? 0)}${counts?.capped ? "+" : ""}`;

  return (
    <Shell title={t("bugs.title")} subtitle={t("bugs.subtitle")} requires="bugreports.manage">
      <div className="tabs-fade">
        <Tabs idBase="bugs" label={t("bugs.filterByStatus")} value={status} onChange={(id) => setQs({ status: id, report: "" })}
          items={(["all", ...BUG_STATUSES] as StatusFilter[]).map((id) => ({ id, label: id === "all" ? t("bugs.status.all") : statusLabel(id), ...(counts ? { count: tabCount(id) } : {}) }))} />
      </div>
      <div className="filters bug-filters" data-open={filtersOpen ? "true" : undefined}>
        <SearchBox id="bug-search" value={search} onChange={(v) => setQs({ q: v })} label={t("bugs.search.label")} placeholder={t("bugs.search.placeholder")} />
        <Button size="sm" className="filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          {filtersOpen ? t("bugs.filters.hide") : t("bugs.filters.show")}
          {activeFilters > 0 && <span className="filter-count" aria-label={t("bugs.filters.active", { count: activeFilters })}>{activeFilters}</span>}</Button>
        <div className="field wide extra"><label htmlFor="bug-category">{t("bugs.filters.category")}</label>
          <select id="bug-category" value={category} onChange={(e) => setQs({ category: e.target.value })}>
            <option value="all">{t("bugs.filters.allCategories")}</option>
            {BUG_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select></div>
        <div className="field extra"><label htmlFor="bug-from">{t("bugs.filters.from")}</label><input id="bug-from" type="date" value={from} max={to || undefined} onChange={(e) => setQs({ from: e.target.value })} /></div>
        <div className="field extra"><label htmlFor="bug-to">{t("bugs.filters.to")}</label><input id="bug-to" type="date" value={to} min={from || undefined} onChange={(e) => setQs({ to: e.target.value })} aria-invalid={rangeBad || undefined} /></div>
      </div>
      {filtered && !empty && <p className="clear-filters"><button type="button" className="link-btn" onClick={() => setQs({ q: "", category: "all", from: "", to: "" })}>{t("bugs.filters.clear")}</button></p>}
      {rangeBad && <p className="error" role="alert">{t("bugs.filters.rangeBad")}</p>}
      {counts?.capped && <InlineNotice>{t("bugs.counts.capped")}</InlineNotice>}

      {list.error && empty ? <LoadError error={list.error} onRetry={list.reload} />
        : (list.loading && empty) || holdList ? <Loading label={t("bugs.loading")} layout="bugs" />
        : empty ? (
          filtered
            ? <Empty title={t("bugs.empty.noMatches.title")} body={t("bugs.empty.noMatches.body")} action={<Button variant="primary" onClick={() => setQs({ q: "", category: "all", from: "", to: "" })}>{t("bugs.filters.clear")}</Button>} />
            : <Empty title={emptyCopy(status).title} body={emptyCopy(status).body} />
        ) : (
          <>
            <ResultCount>
              {!filtered && total !== null && !counts?.capped
                ? t("bugs.count.showingOf", { shown: number(list.items.length), total })
                : list.hasMore ? t("bugs.count.soFar", { shown: number(list.items.length) }) : t("bugs.count.matches", { shown: list.items.length })}
            </ResultCount>
            <div className="review-layout" {...tabPanelProps("bugs", status)}>
              <section aria-label={t("bugs.list.label")} className="queue-wrap bug-list" ref={listTop} aria-busy={list.loading || undefined}>
                <ul className="queue">
                  {list.items.map((item) => (
                    <li key={item.id}>
                      <button className="queue-item bug-item" aria-current={item.id === selected?.id ? "true" : undefined}
                        onClick={() => { setQs({ report: item.id }); detailTop.current?.scrollIntoView?.({ block: "nearest" }); }}>
                        <Avatar name={item.reporterName} userId={item.reporterId} photoURL={item.reporterPhotoURL} avatarId={item.reporterAvatarId} />
                        <span className="queue-text">
                          <span className="bug-meta"><Info>{categoryLabel(item.category)}</Info><Info tone={STATUS_TONE[item.status]}>{statusLabel(item.status)}</Info></span>
                          <span className="bug-snippet">{item.description.trim() || t("bugs.item.noDescription")}</span>
                          <span className="muted">{item.reporterName} · {formatDateTime(item.createdAt)}</span>
                          {(item.hasScreenshot || item.hasNote || item.assigneeName) && (
                            <span className="queue-chips">
                              {item.hasScreenshot && <Info>{t("bugs.item.screenshot")}</Info>}{item.hasNote && <Info>{t("bugs.item.note")}</Info>}{item.assigneeName && <Info>{item.assigneeName}</Info>}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {list.error && <InlineNotice tone="error" action={<Button variant="plain" onClick={list.loadMore}>{t("bugs.item.tryAgain")}</Button>}>{list.error.message}</InlineNotice>}
                {list.hasMore && <LoadMore shown={list.items.length} total={!filtered && counts && !counts.capped ? counts[status] : undefined} loading={list.loadingMore} onClick={list.loadMore} />}
              </section>
              <div ref={detailTop} className="bug-detail-wrap">
                {selected
                  ? <ReportDetail key={selected.id} report={selected} admins={adminOptions} onSaved={saved} onBackToList={() => listTop.current?.scrollIntoView?.({ block: "start" })} />
                  : <EmptyState title={t("bugs.empty.pick.title")} body={t("bugs.empty.pick.body")} />}
              </div>
            </div>
          </>
        )}
    </Shell>
  );
}

export default function BugReportsPage() {
  return <Suspense fallback={<Loading label={t("bugs.loading")} layout="bugs" />}><BugReports /></Suspense>;
}
