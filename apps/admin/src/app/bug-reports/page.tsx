"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, Info, LoadError, Loading, Notice, formatDateTime } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { useDebounced, usePaged } from "@/components/usePaged";
import { ApiError } from "@/lib/contract";
import {
  LIST_PAGE_SIZE, type BugCategory, type BugReport, type BugReportCounts, type BugReportDetail, type BugReportQuery, type BugStatus,
} from "@/lib/adminTypes";
import { setBugBadge } from "@/lib/bugBadge";
import { BUG_CATEGORIES, BUG_CATEGORY_LABEL, BUG_STATUSES, BUG_STATUS_LABEL, diagnosticRows, issueText, screenLabel } from "@/lib/bugReports";

type StatusFilter = BugStatus | "all";
const number = (n: number) => n.toLocaleString("en-US");
const NOTE_MAX = 2000;
const STATUS_TONE: Record<BugStatus, "warn" | "ok" | undefined> = { new: "warn", triaged: undefined, resolved: "ok" };
const EMPTY_COPY: Record<StatusFilter, { title: string; body: string }> = {
  all: { title: "No reports yet", body: "When someone shakes their phone and sends feedback, it shows up here." },
  new: { title: "Inbox zero", body: "Nothing new to look at. Reports that need triage appear here." },
  triaged: { title: "Nothing triaged", body: "Reports you have looked at but not closed wait here." },
  resolved: { title: "Nothing resolved yet", body: "Closed reports are kept here for reference." },
};

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
        <p>The screenshot link expired or couldn’t be loaded.</p>
        <button className="pill-btn gray small" onClick={onExpired}>Reload report</button>
      </div>
    );
  }
  return (
    <>
      <button className="evidence shot" onClick={() => setOpen(true)} aria-label={`Open ${who}’s screenshot full size`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Screenshot from ${who}`} onError={() => setBroken(true)} />
        <span className="view-full">View full size</span>
      </button>
      <dialog ref={dialog} className="dialog viewer" aria-label={`${who}’s screenshot`} onClose={() => setOpen(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="photo-frame large" src={url} alt={`Screenshot from ${who}`} onError={() => setBroken(true)} />
        <div className="actions"><button className="pill-btn gray" onClick={() => setOpen(false)}>Close</button></div>
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
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.getBugReport(report.id).then(
      (value) => {
        if (cancelled) return;
        setDetail(value); setStatus(value.report.status); setAssignee(value.report.assigneeId ?? ""); setNote(value.note);
      },
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this report. Check your connection and try again.")),
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
      setMessage({ tone: "ok", text: result.changed ? "Saved." : "Nothing to change." });
    } catch (failure) {
      const stale = failure instanceof ApiError && failure.reason === "REVISION_CONFLICT";
      setMessage({ tone: "error", text: stale ? "Someone else updated this report. Reload it to see their changes, then save again." : describe(failure) });
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
      setMessage({ tone: "error", text: "Couldn’t copy. Select the text and copy it yourself." });
    }
  }

  const rows = diagnosticRows(detail?.diagnostics ?? null);
  return (
    <article className="review-detail panel bug-detail" aria-label={`Bug report from ${report.reporterName}`}>
      <button className="pill-btn gray small to-list" onClick={onBackToList}>‹ All reports</button>
      <div className="review-head">
        <div className="person big"><Avatar name={report.reporterName} /><div><h2>{report.reporterName}</h2><p className="muted">{detail?.reporterEmail || " "}</p></div></div>
        <div className="review-pills">
          <Info>{BUG_CATEGORY_LABEL[report.category]}</Info>
          <Info tone={STATUS_TONE[detail?.report.status ?? report.status]}>{BUG_STATUS_LABEL[detail?.report.status ?? report.status]}</Info>
        </div>
      </div>
      <p className="muted">Sent {formatDateTime(report.createdAt)} from {screenLabel(report.screen)} {report.source === "shake" ? "by shaking the phone" : "in Profile"}.</p>

      {error ? <LoadError error={error} onRetry={() => setAttempt((n) => n + 1)} />
        : !detail ? <Loading label="Loading report" />
        : (
          <>
            <div>
              <h3>What they wrote</h3>
              {detail.report.description.trim() ? <blockquote className="member-note">{detail.report.description}</blockquote> : <p className="muted">No description.</p>}
            </div>
            <div>
              <h3>Screenshot</h3>
              {detail.screenshotUrl
                ? <Screenshot url={detail.screenshotUrl} who={report.reporterName} onExpired={() => setAttempt((n) => n + 1)} />
                : <div className="evidence none"><p>{detail.report.hasScreenshot ? "The screenshot is no longer available." : "No screenshot was attached."}</p></div>}
            </div>
            <div>
              <h3>Diagnostics</h3>
              {rows.length > 0
                ? <dl className="facts diagnostics">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
                : <p className="muted">The app didn’t include diagnostics.</p>}
            </div>

            <form className="triage" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-label="Triage">
              <h3>Triage</h3>
              <div className="row">
                <div className="field"><label htmlFor="bug-status">Status</label>
                  <select id="bug-status" value={status} onChange={(e) => setStatus(e.target.value as BugStatus)}>
                    {BUG_STATUSES.map((s) => <option key={s} value={s}>{BUG_STATUS_LABEL[s]}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="bug-assignee">Assigned to</label>
                  <select id="bug-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Unassigned</option>
                    {detail.report.assigneeId && !admins.some((a) => a.id === detail.report.assigneeId) && <option value={detail.report.assigneeId}>{detail.report.assigneeName ?? "Former admin"}</option>}
                    {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select></div>
              </div>
              <div className="field"><label htmlFor="bug-note">Internal note</label>
                <textarea id="bug-note" value={note} maxLength={NOTE_MAX} rows={4} onChange={(e) => setNote(e.target.value)} aria-describedby="bug-note-hint" placeholder="Repro steps, ticket link, decision" />
                <span className="hint" id="bug-note-hint">Only admins see this. {note.length}/{number(NOTE_MAX)}{detail.updatedAt ? ` · Last saved ${formatDateTime(detail.updatedAt)}${detail.updatedByName ? ` by ${detail.updatedByName}` : ""}` : ""}</span></div>
              {message && <p className={message.tone === "error" ? "error" : "muted"} role={message.tone === "error" ? "alert" : "status"}>{message.text}{message.tone === "error" && message.text.startsWith("Someone") && <> <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>Reload report</button></>}</p>}
              <div className="actions">
                <button type="submit" className="pill-btn dark" disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</button>
                {!dirty && !saving && <span className="muted small-note">No changes to save</span>}
                <button type="button" className="pill-btn gray" onClick={() => void copy()}>{copied ? "✓ Copied" : "Copy as issue text"}</button>
                <span className="sr-only" role="status">{copied ? "Issue text copied to the clipboard" : ""}</span>
              </div>
            </form>
          </>
        )}
    </article>
  );
}

export default function BugReportsPage() {
  const { api } = useApp();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<BugCategory | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [counts, setCounts] = useState<BugReportCounts | null>(null);
  const query = useDebounced(search.trim());
  const detailTop = useRef<HTMLDivElement>(null);
  const listTop = useRef<HTMLElement>(null);
  const rangeBad = !!from && !!to && from > to;

  const admins = useLoad((a) => a.listMembersPage({ query: "", status: "active", role: "admin", teamId: "all", workLocation: "all" }, null, 100), "bug-admins");
  const adminOptions = useMemo(() => (admins.data?.members ?? []).map((m) => ({ id: m.id, name: m.displayName })), [admins.data]);

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

  const selected = list.items.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected && list.items.length > 0 && typeof window !== "undefined" && window.matchMedia("(min-width: 1001px)").matches) setSelectedId(list.items[0].id);
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
  const tabCount = (id: StatusFilter) => (counts ? ` (${number(counts[id])}${counts.capped ? "+" : ""})` : "");

  return (
    <Shell title="Bug reports" subtitle="What people send with shake-to-report or from Profile. Only admins can see these, including who sent them." requires="bugreports.manage">
      <div className="tabs" role="group" aria-label="Filter by status">
        {(["all", ...BUG_STATUSES] as StatusFilter[]).map((id) => (
          <button key={id} className="tab" aria-pressed={status === id} onClick={() => setStatus(id)}>{id === "all" ? "All" : BUG_STATUS_LABEL[id]}{tabCount(id)}</button>
        ))}
      </div>
      <div className="filters bug-filters" data-open={filtersOpen ? "true" : undefined}>
        <div className="field search"><label htmlFor="search">Search</label>
          <input id="search" type="search" value={search} placeholder="Text, person or screen" onChange={(e) => setSearch(e.target.value)} autoComplete="off" /></div>
        <button type="button" className="pill-btn gray small filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
          {filtersOpen ? "Hide filters" : `Filters${category !== "all" || from || to ? " (on)" : ""}`}</button>
        <div className="field wide extra"><label htmlFor="bug-category">Category</label>
          <select id="bug-category" value={category} onChange={(e) => setCategory(e.target.value as BugCategory | "all")}>
            <option value="all">All categories</option>
            {BUG_CATEGORIES.map((c) => <option key={c} value={c}>{BUG_CATEGORY_LABEL[c]}</option>)}
          </select></div>
        <div className="field extra"><label htmlFor="bug-from">From</label><input id="bug-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field extra"><label htmlFor="bug-to">To</label><input id="bug-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={rangeBad || undefined} /></div>
      </div>
      {filtered && <p className="clear-filters"><button className="link-btn" onClick={() => { setSearch(""); setCategory("all"); setFrom(""); setTo(""); }}>Clear filters</button></p>}
      {rangeBad && <p className="error" role="alert">The end date is before the start date.</p>}
      {counts?.capped && <Notice>Counts cover the newest 1,000 reports. Older ones are still listed as you load more.</Notice>}

      {list.error && empty ? <LoadError error={list.error} onRetry={list.reload} />
        : list.loading ? <Loading label="Loading bug reports" />
        : empty ? (
          filtered
            ? <Empty title="No matches" body="Try a different search, category or date range." action={<button className="pill-btn dark" onClick={() => { setSearch(""); setCategory("all"); setFrom(""); setTo(""); }}>Clear filters</button>} />
            : <Empty title={EMPTY_COPY[status].title} body={EMPTY_COPY[status].body} />
        ) : (
          <>
            <p className="muted result-count" role="status">
              {!filtered && total !== null && !counts?.capped
                ? `Showing ${number(list.items.length)} of ${number(total)} ${total === 1 ? "report" : "reports"}`
                : `${number(list.items.length)}${list.hasMore ? " reports so far" : list.items.length === 1 ? " report matches" : " reports match"}`}
            </p>
            <div className="review-layout">
              <section aria-label="Reports" className="queue-wrap bug-list" ref={listTop}>
                <ul className="queue">
                  {list.items.map((item) => (
                    <li key={item.id}>
                      <button className="queue-item bug-item" aria-current={item.id === selectedId ? "true" : undefined}
                        onClick={() => { setSelectedId(item.id); detailTop.current?.scrollIntoView?.({ block: "nearest" }); }}>
                        <span className="queue-text">
                          <span className="bug-meta"><Info>{BUG_CATEGORY_LABEL[item.category]}</Info><Info tone={STATUS_TONE[item.status]}>{BUG_STATUS_LABEL[item.status]}</Info></span>
                          <span className="bug-snippet">{item.description.trim() || "No description"}</span>
                          <span className="muted">{item.reporterName} · {formatDateTime(item.createdAt)}</span>
                          {(item.hasScreenshot || item.hasNote || item.assigneeName) && (
                            <span className="queue-chips">
                              {item.hasScreenshot && <Info>Screenshot</Info>}{item.hasNote && <Info>Note</Info>}{item.assigneeName && <Info>{item.assigneeName}</Info>}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {list.error && <div className="banner error" role="alert"><span>{list.error.message}</span><button className="pill-btn" onClick={list.loadMore}>Try again</button></div>}
                {list.hasMore && <div className="actions"><button className="pill-btn gray" disabled={list.loadingMore} onClick={list.loadMore}>{list.loadingMore ? "Loading…" : "Load more"}</button></div>}
              </section>
              <div ref={detailTop} className="bug-detail-wrap">
                {selected
                  ? <ReportDetail key={selected.id} report={selected} admins={adminOptions} onSaved={saved} onBackToList={() => listTop.current?.scrollIntoView?.({ block: "start" })} />
                  : <div className="empty"><h2>Pick a report</h2><p>Choose one from the list to read it and triage it.</p></div>}
              </div>
            </div>
          </>
        )}
    </Shell>
  );
}
