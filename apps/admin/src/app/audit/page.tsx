"use client";
// @i18n-migrated

import { Fragment, Suspense, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { TableRegion } from "@/components/TableRegion";
import { toast } from "@/components/Toast";
import { Avatar, Empty, LoadError, LoadMore, Loading, ResultCount, SearchBox } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { AUDIT_WINDOW } from "@/lib/adminApi";
import { ROLE_LABEL } from "@/lib/adminTypes";
import { aiFacts, auditAction, auditCategoriesInUse, auditCategoryLabel, auditSummary, isAiAction, isAuditCategory } from "@/lib/auditLabels";
import { formatDate, formatTime, intlLocale, t, type MessageKey } from "@/lib/i18n";
import { downloadText } from "@/lib/csv";
import { auditCsv } from "@/lib/exports";
import { useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, FilterBar, RelativeTime, SortHeader, absoluteTime, sortRows, useMinuteClock, useTableSort } from "@/components/kit";

const PAGE = 40;
/** Plain-language target kind under the summary; null hides the line (the summary already says it, e.g. company-wide settings). IDs live in Details. */
const TARGET_KIND: Record<string, MessageKey | null> = {
  company: null, member: "audit.target.member", event: "audit.target.event", challenge: "audit.target.challenge",
  submission: "audit.target.submission", cover: "audit.target.cover", photo: "audit.target.photo", comment: "audit.target.comment",
  attendee: "audit.target.attendee", roster: "audit.target.roster", import: "audit.target.import", team: "audit.target.team",
  points: "audit.target.points", bugReport: "audit.target.bugReport", invite: "audit.target.invite",
};
const targetKind = (type: string) => {
  const key = Object.prototype.hasOwnProperty.call(TARGET_KIND, type) ? TARGET_KIND[type] : null;
  return key ? t(key) : null;
};
const DEFAULTS = { q: "", category: "all" };
const SORT_KEYS = ["when"] as const;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
/** "Today", "Yesterday", then "Mon, Nov 23" (with the year when it is not this year). */
function dayLabel(at: Date, now: Date): string {
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86_400_000);
  if (days === 0 || days === 1) {
    const word = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" }).format(-days, "day");
    return word.charAt(0).toLocaleUpperCase(intlLocale()) + word.slice(1);
  }
  return formatDate(at, { weekday: "short", month: "short", day: "numeric", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}
const CATEGORIES = auditCategoriesInUse();

function Audit() {
  const audit = useLoad((api) => api.listAudit(), "audit");
  const [qs, setQs] = useQueryState(DEFAULTS);
  const search = qs.q;
  const category = isAuditCategory(qs.category) ? qs.category : "all";
  useSlashFocus("audit-search");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  // The log holds the latest 100 entries, so only time is sortable: sorting by person would look complete and is not.
  const sort = useTableSort("audit", SORT_KEYS, { key: "when", dir: "desc" }, { when: "desc" });
  const now = useMinuteClock();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (audit.data ?? []).filter((e) => {
      const a = auditAction(e.action);
      return (category === "all" || a.category === category) &&
        (!q || `${a.label} ${e.actorName} ${e.targetId} ${e.summary} ${auditSummary(e)} ${e.reason ?? ""}`.toLowerCase().includes(q));
    });
  }, [audit.data, search, category]);
  const ordered = useMemo(() => sortRows(filtered, (e) => Date.parse(e.at), sort.dir), [filtered, sort.dir]);

  const hold = useSkeletonGate(!audit.data && !audit.error);

  function clearFilters() {
    setQs({ q: "", category: "all" });
    setShown(PAGE);
  }

  function exportCsv() {
    try {
      downloadText("audit-log.csv", auditCsv(filtered));
      toast(t("audit.export.done", { count: filtered.length }));
    } catch {
      toast(t("common.exportFailed"), { tone: "error" });
    }
  }

  return (
    <Shell dense title={t("audit.title")} subtitle={t("audit.subtitle")} requires="audit.view"
      more={filtered.length > 0 ? <Button onClick={() => exportCsv()}>{t("common.exportCsv")}</Button> : undefined}>
      {audit.error ? <LoadError error={audit.error} onRetry={audit.reload} />
        : !audit.data || hold ? <Loading label={t("audit.loading")} layout="audit" />
        : audit.data.length === 0 ? <Empty title={t("audit.empty.title")} body={t("audit.empty.body")} />
        : (
          <>
            <FilterBar active={category !== "all" ? 1 : 0}
              search={<SearchBox shortcut id="audit-search" value={search} onChange={(v) => { setQs({ q: v }); setShown(PAGE); }} label={t("audit.search.label")} placeholder={t("audit.search.placeholder")} />}
              onClear={search !== "" || category !== "all" ? clearFilters : undefined} clearLabel={t(category !== "all" ? "ui.filters.clear" : "ui.filters.clearSearch")}>
              <div className="field"><label htmlFor="f-category">{t("audit.filter.category")}</label>
                <select id="f-category" value={category} onChange={(e) => { setQs({ category: e.target.value }); setShown(PAGE); }}>
                  <option value="all">{t("audit.filter.allCategories")}</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{auditCategoryLabel(c)}</option>)}
                </select></div>
            </FilterBar>
            {filtered.length === 0 ? (
              <Empty title={t("audit.noMatches.title")} body={t("audit.noMatches.body")} action={<Button onClick={clearFilters}>{t(category !== "all" ? "ui.filters.clear" : "ui.filters.clearSearch")}</Button>} />
            ) : (
              <>
                <ResultCount>{audit.data.length >= AUDIT_WINDOW
                  ? t("audit.showingOfLatest", { shown: Math.min(shown, filtered.length), total: filtered.length, window: AUDIT_WINDOW })
                  : t("audit.showingOf", { shown: Math.min(shown, filtered.length), total: filtered.length })}</ResultCount>
                <TableRegion label={t("audit.table.label")}>
                  <table className="table responsive audit-table sticky-actions compact-table actions-corner">
                    <caption className="sr-only">{t("audit.table.label")}</caption>
                    <thead><tr><SortHeader column="when" sort={sort}>{t("audit.table.when")}</SortHeader><th scope="col">{t("audit.table.what")}</th><th scope="col" className="mid-hide">{t("audit.table.who")}</th><th scope="col">{t("audit.table.target")}</th><th scope="col"><span className="sr-only">{t("common.details")}</span></th></tr></thead>
                    <tbody>
                      {ordered.slice(0, shown).map((e, index, rows) => {
                        const a = auditAction(e.action);
                        const ai = isAiAction(e.action);
                        const facts = ai ? aiFacts(e.changes) : [];
                        const shownChanges = ai ? [] : e.changes;
                        const at = new Date(e.at);
                        const newDay = index === 0 || dayKey(new Date(rows[index - 1].at)) !== dayKey(at);
                        const summary = auditSummary(e);
                        return (
                          <Fragment key={e.id}>
                            {newDay && <tr className="group-row"><th scope="colgroup" colSpan={5}>{dayLabel(at, now)}</th></tr>}
                            <tr className="audit-entry">
                              <td className="nowrap phone-hide" data-label={t("audit.table.when")}>{dayKey(at) === dayKey(now) ? <RelativeTime iso={e.at} /> : <time dateTime={e.at} title={absoluteTime(at, now)}>{formatTime(at, { hour: "numeric", minute: "2-digit" })}</time>}</td>
                              <td className="phone-lead" data-label={t("audit.table.what")}><span className="person-sub mid-show"><span className="phone-only">{dayKey(at) === dayKey(now) ? <RelativeTime iso={e.at} /> : formatTime(at, { hour: "numeric", minute: "2-digit" })} · </span>{e.actorName}, {ROLE_LABEL[e.actorRole]}</span><span className="audit-what"><span className="audit-label" title={t("audit.actionKeyTitle", { key: e.action })}>{a.label}</span><span className={`audit-chip ${a.category.toLowerCase()}`}>{auditCategoryLabel(a.category)}</span></span></td>
                              <td className="phone-hide mid-hide" data-label={t("audit.table.who")}><span className="person"><Avatar name={e.actorName} userId={e.actorId} /><span><strong className="nowrap">{e.actorName}</strong><span className="line muted">{ROLE_LABEL[e.actorRole]}</span></span></span></td>
                              <td className="phone-lead" data-label={t("audit.table.target")}>{summary !== a.label && <p>{summary}</p>}{targetKind(e.targetType) && <p className="muted">{targetKind(e.targetType)}</p>}</td>
                              <td className="right"><Button size="sm" aria-expanded={open === e.id} aria-controls={`audit-detail-${e.id}`} aria-label={t(open === e.id ? "audit.hideDetailsFor" : "audit.showDetailsFor", { label: a.label })} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t("common.hideDetails") : t("common.details")}</Button></td>
                            </tr>
                            {open === e.id && (
                              <tr className="audit-detail-row" id={`audit-detail-${e.id}`}><td colSpan={5}>
                                <div className="audit-detail">
                                  {e.reason && <p><strong>{t("audit.detail.reason")}</strong> {e.reason}</p>}
                                  {facts.length > 0 && (
                                    <dl className="audit-facts">{facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
                                  )}
                                  {shownChanges.length > 0 && (
                                    <table className="table compact"><thead><tr><th scope="col">{t("audit.detail.field")}</th><th scope="col">{t("audit.detail.before")}</th><th scope="col">{t("audit.detail.after")}</th></tr></thead>
                                      <tbody>{shownChanges.map((c) => <tr key={c.field}><th scope="row">{c.field}</th><td>{c.before || <span className="muted">{t("common.empty")}</span>}</td><td>{c.after || <span className="muted">{t("common.empty")}</span>}</td></tr>)}</tbody></table>
                                  )}
                                  <p className="muted audit-key">{t("audit.detail.actionKey")} <code>{e.action}</code> · {t("audit.detail.reference")} <code>{e.targetType} {e.targetId}</code></p>
                                </div>
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </TableRegion>
                {filtered.length > shown && <LoadMore shown={shown} total={filtered.length} loading={false} onClick={() => setShown((n) => n + PAGE)} />}
              </>
            )}
          </>
        )}
    </Shell>
  );
}

export default function AuditPage() {
  return <Suspense fallback={<Loading label={t("audit.loading")} layout="audit" />}><Audit /></Suspense>;
}
