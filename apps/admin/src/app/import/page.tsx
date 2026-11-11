"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Empty, Info, Loading, Notice } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { type ApplyRowResult, IMPORT_LIMITS, type PlanAction, type PlanRow } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { FIELD_LABEL, type ParsedImport, errorCsv, planCounts, readImportFile, templateCsv } from "@/lib/importFile";
import { applyAll, planAll } from "@/lib/importRun";

type Phase = "choose" | "checking" | "preview" | "applying" | "done";
const ACTION_LABEL: Record<PlanAction, string> = { create: "New", update: "Update", unchanged: "No change", invalid: "Invalid" };
const PREVIEW_PAGE = 50;

export default function ImportPage() {
  const { api } = useApp();
  const company = useLoad((a) => a.companyInfo(), "company");
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("choose");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [chunkCount, setChunkCount] = useState(0);
  const [jobId, setJobId] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<PlanAction | "all">("all");
  const [shown, setShown] = useState(PREVIEW_PAGE);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<ApplyRowResult[]>([]);
  const [nextChunk, setNextChunk] = useState(0);
  const [dragging, setDragging] = useState(false);

  const domain = company.data?.emailDomain ?? "";
  const counts = useMemo(() => planCounts(rows), [rows]);
  const visible = useMemo(() => rows.filter((r) => filter === "all" || r.action === filter), [rows, filter]);
  const changes = counts.create + counts.update;

  function startOver() {
    setPhase("choose"); setParsed(null); setRows([]); setResults([]); setError(""); setFilter("all"); setShown(PREVIEW_PAGE); setNextChunk(0); setFileName("");
    if (input.current) input.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setPhase("checking");
    const result = await readImportFile(file, domain);
    if (result.fatal) { setError(result.fatal); setPhase("choose"); return; }
    setParsed(result);
    const id = crypto.randomUUID();
    setJobId(id);
    try {
      const plan = await planAll(api, result, id, (done, total) => setProgress({ done, total }));
      setRows(plan.rows);
      setChunkCount(plan.chunkCount);
      setPhase("preview");
    } catch (failure) {
      setError(describe(failure, "The preview couldn’t be built. Nothing was changed. Try again."));
      setPhase("choose");
    }
  }

  async function apply(from: number) {
    setConfirming(false);
    setPhase("applying");
    setError("");
    setProgress({ done: from, total: chunkCount });
    try {
      await applyAll(api, jobId, chunkCount, from, (index, chunk) => {
        setResults((previous) => [...previous.filter((r) => !chunk.some((c) => c.line === r.line)), ...chunk]);
        setNextChunk(index + 1);
        setProgress({ done: index + 1, total: chunkCount });
      });
      setPhase("done");
    } catch (failure) {
      // Finished chunks are kept; "Continue" retries from the next one and is safe to repeat.
      setError(describe(failure, "The import stopped part-way. Finished rows are saved. Continue to retry the rest."));
    }
  }

  // Rows the preview already called invalid come back "failed" too; count each row once.
  const previewInvalid = new Set(rows.filter((r) => r.action === "invalid").map((r) => r.line));
  const failed = results.filter((r) => r.outcome === "failed" && !previewInvalid.has(r.line));
  const outcome = (name: ApplyRowResult["outcome"]) => results.filter((r) => r.outcome === name).length;

  return (
    <Shell title="Import people" subtitle="Add or update many people from a spreadsheet. You see exactly what changes before anything is saved." requires="import.run"
      action={<Link className="pill-btn gray" href="/roster/">Roster</Link>}>
      {phase === "choose" && (
        <>
          {error && <div className="banner error" role="alert"><span>{error}</span></div>}
          <div className="detail-layout">
            <section className="panel" aria-labelledby="up">
              <h2 id="up">1. Choose a file</h2>
              <div
                className={`dropzone${dragging ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); void choose(e.dataTransfer.files[0]); }}
              >
                <p>Drop a .csv or .xlsx file here, or</p>
                <label className="pill-btn dark file-btn">
                  Choose file
                  <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void choose(e.target.files?.[0])} />
                </label>
                <p className="hint">Up to {IMPORT_LIMITS.maxRows.toLocaleString()} rows and {IMPORT_LIMITS.maxBytes / 1024 / 1024} MB. The file is read in your browser; only the checked rows are sent.</p>
              </div>
            </section>
            <aside className="stack">
              <section className="panel" aria-labelledby="tpl">
                <h2 id="tpl">Need the format?</h2>
                <p className="muted">The template has every column with one example row.</p>
                <button className="pill-btn dark" onClick={() => downloadText("dip-people-template.csv", templateCsv(domain))}>Download template</button>
              </section>
              <section className="panel" aria-labelledby="rules">
                <h2 id="rules">How it works</h2>
                <ul className="plain">
                  <li>Email is the key. People are matched by lowercase email{domain && <> and must end in <strong>@{domain}</strong></>}.</li>
                  <li>Teams are separated by semicolons. Unknown teams are flagged.</li>
                  <li>Blank cells keep the current value. Points and sign-in data are never touched.</li>
                  <li>People who haven’t signed up yet join the roster and get these details when they do.</li>
                  <li>Running the same file twice changes nothing the second time.</li>
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}

      {phase === "checking" && (
        <section className="panel" aria-live="polite">
          <h2>Checking {fileName}</h2>
          <progress className="progress" value={progress.done} max={Math.max(progress.total, 1)} aria-label="Rows checked" />
          <p className="muted">{progress.total ? `${progress.done} of ${progress.total} rows checked` : "Reading the file…"}</p>
          <Loading label="Checking rows" />
        </section>
      )}

      {phase === "preview" && parsed && (
        <>
          <div className="toolbar">
            <Info>{fileName}</Info>
            <span className="muted">Preview only. Nothing has been saved.</span>
            <span className="spacer" />
            <button className="pill-btn gray" onClick={startOver}>Choose a different file</button>
            {counts.invalid > 0 && <button className="pill-btn gray" onClick={() => downloadText("import-errors.csv", errorCsv(rows.filter((r) => r.action === "invalid")))}>Download error CSV</button>}
            <button className="pill-btn purple" disabled={changes === 0} onClick={() => setConfirming(true)}>Apply {changes} {changes === 1 ? "change" : "changes"}</button>
          </div>
          {parsed.unknownColumns.length > 0 && <Notice>Ignored columns: {parsed.unknownColumns.join(", ")}.</Notice>}
          <div className="stats" role="group" aria-label="Preview summary">
            {(["create", "update", "unchanged", "invalid"] as const).map((a) => (
              <button key={a} className="stat" aria-pressed={filter === a} onClick={() => { setFilter(filter === a ? "all" : a); setShown(PREVIEW_PAGE); }}>
                <span className="stat-n">{counts[a]}</span><span>{a === "create" ? "To create" : a === "update" ? "To update" : a === "unchanged" ? "Unchanged" : "Invalid"}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? <Empty title="Nothing in this group" body="Pick another group above or show all rows." action={<button className="pill-btn dark" onClick={() => setFilter("all")}>Show all</button>} /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Import preview</caption>
                  <thead><tr><th scope="col">Line</th><th scope="col">Email</th><th scope="col">Result</th><th scope="col">Changes</th></tr></thead>
                  <tbody>
                    {visible.slice(0, shown).map((r) => (
                      <tr key={r.line}>
                        <td>{r.line}</td>
                        <td>{r.email || <span className="muted">(blank)</span>}</td>
                        <td><Info tone={r.action === "invalid" ? "warn" : r.action === "unchanged" ? undefined : "ok"}>{ACTION_LABEL[r.action]}</Info></td>
                        <td>
                          {r.errors.map((e) => <p key={e} className="error">{e}</p>)}
                          {r.changes.length > 0 && (
                            <ul className="diff">
                              {r.changes.map((c) => (
                                <li key={c.field}><strong>{FIELD_LABEL[c.field]}</strong> <span className="before">{c.before || "empty"}</span> <span aria-label="becomes">→</span> <span className="after">{c.after}</span></li>
                              ))}
                            </ul>
                          )}
                          {r.action === "unchanged" && <span className="muted">Already up to date</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visible.length > shown && <div className="actions"><button className="pill-btn gray" onClick={() => setShown((n) => n + PREVIEW_PAGE)}>Show more ({visible.length - shown} left)</button></div>}
            </>
          )}
        </>
      )}

      {phase === "applying" && (
        <section className="panel" aria-live="polite">
          <h2>Applying changes</h2>
          <progress className="progress" value={progress.done} max={Math.max(progress.total, 1)} aria-label="Import progress" />
          <p className="muted">{progress.done} of {progress.total} batches finished. Keep this page open.</p>
          {error && (
            <>
              <div className="banner error" role="alert"><span>{error}</span></div>
              <div className="actions">
                <button className="pill-btn dark" onClick={() => void apply(nextChunk)}>Continue</button>
                <button className="pill-btn gray" onClick={() => setPhase("done")}>Stop here</button>
              </div>
            </>
          )}
        </section>
      )}

      {phase === "done" && (
        <section className="panel" aria-labelledby="done">
          <h2 id="done">{failed.length || nextChunk < chunkCount ? "Import finished with problems" : "Import complete"}</h2>
          <div className="stats" role="group" aria-label="Import result">
            <div className="stat"><span className="stat-n">{outcome("created")}</span><span>Added to roster</span></div>
            <div className="stat"><span className="stat-n">{outcome("updated")}</span><span>Updated</span></div>
            <div className="stat"><span className="stat-n">{outcome("unchanged")}</span><span>Unchanged</span></div>
            <div className="stat"><span className="stat-n">{failed.length + previewInvalid.size}</span><span>Skipped</span></div>
          </div>
          {nextChunk < chunkCount && <p className="notice">The import stopped after {nextChunk} of {chunkCount} batches. Run it again with the same file: finished rows won’t change.</p>}
          <div className="actions">
            <Link className="pill-btn dark" href="/roster/">See the roster</Link>
            {(failed.length > 0 || counts.invalid > 0) && (
              <button className="pill-btn gray" onClick={() => downloadText("import-errors.csv", errorCsv([
                ...rows.filter((r) => r.action === "invalid"), ...failed.map((f) => ({ line: f.line, email: f.email, errors: [f.error ?? "Failed"] })),
              ]))}>Download error CSV</button>
            )}
            <button className="pill-btn gray" onClick={startOver}>Import another file</button>
          </div>
        </section>
      )}

      {confirming && (
        <Dialog title="Apply this import?" confirmLabel={`Apply ${changes} ${changes === 1 ? "change" : "changes"}`} onClose={() => setConfirming(false)} onConfirm={async () => { void apply(0); }}>
          <p>{counts.create} new {counts.create === 1 ? "person is" : "people are"} added to the roster and {counts.update} existing {counts.update === 1 ? "record is" : "records are"} updated.
            {counts.invalid > 0 && <> {counts.invalid} invalid {counts.invalid === 1 ? "row is" : "rows are"} skipped.</>} The import is recorded in the audit log.</p>
        </Dialog>
      )}
    </Shell>
  );
}
