"use client";

import { Fragment, Suspense, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { TableRegion } from "@/components/TableRegion";
import { toast } from "@/components/Toast";
import { Avatar, Empty, LoadError, LoadMore, Loading, ResultCount, SearchBox, formatDateTime } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { ROLE_LABEL } from "@/lib/adminTypes";
import { aiFacts, auditAction, auditCategoriesInUse, isAiAction, isAuditCategory } from "@/lib/auditLabels";
import { downloadText } from "@/lib/csv";
import { auditCsv } from "@/lib/exports";
import { useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button } from "@/components/kit";

const PAGE = 40;
/** Plain-language target kind under the summary; null hides the line (the summary already says it, e.g. company-wide settings). IDs live in Details. */
const TARGET_KIND: Record<string, string | null> = {
  company: null, member: "Member", event: "Event", challenge: "Weekly theme", submission: "Submission", cover: "Cover photo",
  photo: "Photo", comment: "Comment", attendee: "Attendee", roster: "Roster", import: "Import", team: "Team", points: "Points",
  bugReport: "Bug report", invite: "Invite",
};
const targetKind = (type: string) => (type in TARGET_KIND ? TARGET_KIND[type] : null);
const DEFAULTS = { q: "", category: "all" };
const CATEGORIES = auditCategoriesInUse();

function Audit() {
  const audit = useLoad((api) => api.listAudit(), "audit");
  const [qs, setQs] = useQueryState(DEFAULTS);
  const search = qs.q;
  const category = isAuditCategory(qs.category) ? qs.category : "all";
  useSlashFocus("audit-search");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (audit.data ?? []).filter((e) => {
      const a = auditAction(e.action);
      return (category === "all" || a.category === category) &&
        (!q || `${a.label} ${e.actorName} ${e.targetId} ${e.summary} ${e.reason ?? ""}`.toLowerCase().includes(q));
    });
  }, [audit.data, search, category]);

  const hold = useSkeletonGate(!audit.data && !audit.error);

  function exportCsv() {
    try {
      downloadText("audit-log.csv", auditCsv(filtered));
      toast(`Exported ${filtered.length} ${filtered.length === 1 ? "entry" : "entries"} to audit-log.csv.`);
    } catch {
      toast("The export didn’t finish. Try again.", { tone: "error" });
    }
  }

  return (
    <Shell title="Audit log" subtitle="Every admin change: who did it, to what, and why. Read-only; the latest 100 entries." requires="audit.view"
      action={filtered.length > 0 ? <Button onClick={() => exportCsv()}>Export CSV</Button> : undefined}>
      {audit.error ? <LoadError error={audit.error} onRetry={audit.reload} />
        : !audit.data || hold ? <Loading label="Loading audit log" layout="audit" />
        : audit.data.length === 0 ? <Empty title="No entries yet" body="Changes made with the admin tools appear here, newest first." />
        : (
          <>
            <div className="filters">
              <SearchBox id="audit-search" value={search} onChange={(v) => { setQs({ q: v }); setShown(PAGE); }} label="Search by person, target or reason" placeholder="Search by person, target or reason (press / to focus)" />
              <div className="field"><label htmlFor="f-category">Category</label>
                <select id="f-category" value={category} onChange={(e) => { setQs({ category: e.target.value }); setShown(PAGE); }}>
                  <option value="all">All categories</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
            </div>
            {filtered.length === 0 ? <Empty title="No matches" body="Try a different search or category." /> : (
              <>
                <ResultCount>{`Showing ${Math.min(shown, filtered.length)} of ${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`}</ResultCount>
                <TableRegion label="Audit log">
                  <table className="table responsive audit-table">
                    <caption className="sr-only">Audit log</caption>
                    <thead><tr><th scope="col">When</th><th scope="col">What happened</th><th scope="col">Who</th><th scope="col">Target</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
                    <tbody>
                      {filtered.slice(0, shown).map((e) => {
                        const a = auditAction(e.action);
                        const ai = isAiAction(e.action);
                        const facts = ai ? aiFacts(e.changes) : [];
                        const shownChanges = ai ? [] : e.changes;
                        return (
                          <Fragment key={e.id}>
                            <tr className="audit-entry">
                              <td className="nowrap" data-label="When"><time dateTime={e.at}>{formatDateTime(e.at)}</time></td>
                              <td data-label="What happened"><span className="audit-what"><span className="audit-label" title={`Action key: ${e.action}`}>{a.label}</span><span className={`audit-chip ${a.category.toLowerCase()}`}>{a.category}</span></span></td>
                              <td data-label="Who"><span className="person"><Avatar name={e.actorName} userId={e.actorId} /><span><strong>{e.actorName}</strong> <span className="muted">({ROLE_LABEL[e.actorRole]})</span></span></span></td>
                              <td data-label="Target"><p>{e.summary}</p>{targetKind(e.targetType) && <p className="muted">{targetKind(e.targetType)}</p>}</td>
                              <td className="right"><Button size="sm" aria-expanded={open === e.id} aria-controls={`audit-detail-${e.id}`} aria-label={`${open === e.id ? "Hide" : "Show"} details for ${a.label}`} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Hide details" : "Details"}</Button></td>
                            </tr>
                            {open === e.id && (
                              <tr className="audit-detail-row" id={`audit-detail-${e.id}`}><td colSpan={5}>
                                <div className="audit-detail">
                                  {e.reason && <p><strong>Reason:</strong> {e.reason}</p>}
                                  {facts.length > 0 && (
                                    <dl className="audit-facts">{facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
                                  )}
                                  {shownChanges.length > 0 && (
                                    <table className="table compact"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                                      <tbody>{shownChanges.map((c) => <tr key={c.field}><th scope="row">{c.field}</th><td>{c.before || <span className="muted">Empty</span>}</td><td>{c.after || <span className="muted">Empty</span>}</td></tr>)}</tbody></table>
                                  )}
                                  <p className="muted audit-key">Action key: <code>{e.action}</code> · Reference: <code>{e.targetType} {e.targetId}</code></p>
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
  return <Suspense fallback={<Loading label="Loading audit log" layout="audit" />}><Audit /></Suspense>;
}
