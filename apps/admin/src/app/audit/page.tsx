"use client";

import { useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, Info, LoadError, Loading, SearchBox, formatDateTime } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { AUDIT_ACTIONS } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { auditCsv } from "@/lib/exports";

const PAGE = 40;

export default function AuditPage() {
  const audit = useLoad((api) => api.listAudit(), "audit");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (audit.data ?? []).filter((e) => (action === "all" || e.action === action) &&
      (!q || `${e.actorName} ${e.targetLabel} ${e.summary} ${e.reason ?? ""}`.toLowerCase().includes(q)));
  }, [audit.data, search, action]);

  return (
    <Shell title="Audit log" subtitle="Every admin change: who did it, to what, and why. Read-only." requires="audit.view"
      action={<button className="pill-btn gray" disabled={!filtered.length} onClick={() => downloadText("audit-log.csv", auditCsv(filtered))}>Export CSV</button>}>
      {audit.error ? <LoadError error={audit.error} onRetry={audit.reload} />
        : !audit.data ? <Loading label="Loading audit log" />
        : audit.data.length === 0 ? <Empty title="No entries yet" body="Changes made with the admin tools appear here, newest first." />
        : (
          <>
            <div className="filters">
              <SearchBox value={search} onChange={(v) => { setSearch(v); setShown(PAGE); }} label="Search by person, target or reason" />
              <div className="field"><label htmlFor="f-action">Action</label>
                <select id="f-action" value={action} onChange={(e) => { setAction(e.target.value); setShown(PAGE); }}>
                  <option value="all">All actions</option>
                  {Object.entries(AUDIT_ACTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select></div>
            </div>
            {filtered.length === 0 ? <Empty title="No matches" body="Try a different search or action." /> : (
              <>
                <ol className="audit-list">
                  {filtered.slice(0, shown).map((e) => {
                    const expandable = !!(e.before || e.after || e.reason);
                    return (
                      <li key={e.id} className="audit-row">
                        <div className="audit-main">
                          <Info>{AUDIT_ACTIONS[e.action] ?? e.action}</Info>
                          <p><strong>{e.actorName}</strong> · {e.summary}</p>
                          <p className="muted">{e.targetLabel} · <time dateTime={e.at}>{formatDateTime(e.at)}</time></p>
                        </div>
                        {expandable && <button className="pill-btn gray small" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Hide details" : "Details"}</button>}
                        {open === e.id && (
                          <div className="audit-detail">
                            {e.reason && <p><strong>Reason:</strong> {e.reason}</p>}
                            {(e.before || e.after) && (
                              <table className="table compact"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                                <tbody>{[...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])].map((k) => <tr key={k}><th scope="row">{k}</th><td>{e.before?.[k] || "—"}</td><td>{e.after?.[k] || "—"}</td></tr>)}</tbody></table>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {filtered.length > shown && <div className="actions"><button className="pill-btn gray" onClick={() => setShown((n) => n + PAGE)}>Show more ({filtered.length - shown} left)</button></div>}
              </>
            )}
          </>
        )}
    </Shell>
  );
}
