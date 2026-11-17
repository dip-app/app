"use client";

import { Fragment, Suspense, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { TableRegion } from "@/components/TableRegion";
import { toast } from "@/components/Toast";
import { Empty, Info, LoadError, LoadMore, Loading, ResultCount, SearchBox, formatDateTime } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { AUDIT_ACTIONS, ROLE_LABEL } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { auditCsv } from "@/lib/exports";
import { useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";

const PAGE = 40;
const DEFAULTS = { q: "", action: "all" };

function Audit() {
  const audit = useLoad((api) => api.listAudit(), "audit");
  const [qs, setQs] = useQueryState(DEFAULTS);
  const search = qs.q;
  const action = qs.action;
  useSlashFocus("audit-search");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (audit.data ?? []).filter((e) => (action === "all" || e.action === action) &&
      (!q || `${e.actorName} ${e.targetId} ${e.summary} ${e.reason ?? ""}`.toLowerCase().includes(q)));
  }, [audit.data, search, action]);

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
      action={filtered.length > 0 ? <button type="button" className="pill-btn gray" onClick={() => exportCsv()}>Export CSV</button> : undefined}>
      {audit.error ? <LoadError error={audit.error} onRetry={audit.reload} />
        : !audit.data ? <Loading label="Loading audit log" />
        : audit.data.length === 0 ? <Empty title="No entries yet" body="Changes made with the admin tools appear here, newest first." />
        : (
          <>
            <div className="filters">
              <SearchBox id="audit-search" value={search} onChange={(v) => { setQs({ q: v }); setShown(PAGE); }} label="Search by person, target or reason" placeholder="Search by person, target or reason (press / to focus)" />
              <div className="field"><label htmlFor="f-action">Action</label>
                <select id="f-action" value={action} onChange={(e) => { setQs({ action: e.target.value }); setShown(PAGE); }}>
                  <option value="all">All actions</option>
                  {Object.entries(AUDIT_ACTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select></div>
            </div>
            {filtered.length === 0 ? <Empty title="No matches" body="Try a different search or action." /> : (
              <>
                <ResultCount>{`Showing ${Math.min(shown, filtered.length)} of ${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`}</ResultCount>
                <TableRegion label="Audit log">
                  <table className="table responsive audit-table">
                    <caption className="sr-only">Audit log</caption>
                    <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Who</th><th scope="col">What</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
                    <tbody>
                      {filtered.slice(0, shown).map((e) => {
                        const expandable = e.changes.length > 0 || !!e.reason;
                        return (
                          <Fragment key={e.id}>
                            <tr className="audit-entry">
                              <td className="nowrap" data-label="When"><time dateTime={e.at}>{formatDateTime(e.at)}</time></td>
                              <td data-label="Action"><Info>{AUDIT_ACTIONS[e.action] ?? e.action}</Info></td>
                              <td data-label="Who"><strong>{e.actorName}</strong> <span className="muted">({ROLE_LABEL[e.actorRole]})</span></td>
                              <td data-label="What"><p>{e.summary}</p><p className="muted">{e.targetType} {e.targetId}</p></td>
                              <td className="right">{expandable && <button className="pill-btn gray small" aria-expanded={open === e.id} aria-controls={`audit-detail-${e.id}`} aria-label={`${open === e.id ? "Hide" : "Show"} details for ${e.summary}`} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Hide details" : "Details"}</button>}</td>
                            </tr>
                            {open === e.id && (
                              <tr className="audit-detail-row" id={`audit-detail-${e.id}`}><td colSpan={5}>
                                <div className="audit-detail">
                                  {e.reason && <p><strong>Reason:</strong> {e.reason}</p>}
                                  {e.changes.length > 0 && (
                                    <table className="table compact"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                                      <tbody>{e.changes.map((c) => <tr key={c.field}><th scope="row">{c.field}</th><td>{c.before || <span className="muted">Empty</span>}</td><td>{c.after || <span className="muted">Empty</span>}</td></tr>)}</tbody></table>
                                  )}
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
  return <Suspense fallback={<Loading label="Loading audit log" />}><Audit /></Suspense>;
}
