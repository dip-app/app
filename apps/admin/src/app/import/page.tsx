"use client";
// @i18n-migrated

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { ImportMapping } from "@/components/ImportMapping";
import { Shell } from "@/components/Shell";
import { TableRegion } from "@/components/TableRegion";
import { Empty, Info, LoadMore, Loading } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import { IMPORT_LIMITS, type ImportJobInfo, type PlanAction, type PlanRow } from "@/lib/adminTypes";
import { browserStore } from "@/lib/api";
import { ApiError } from "@/lib/contract";
import { downloadText } from "@/lib/csv";
import { type ParsedImport, fieldLabel, type RawFile, errorCsv, planCounts, readRawFile, templateCsv, validRows } from "@/lib/importFile";
import { applyAll, planAll } from "@/lib/importRun";
import { formatNumber, t, type MessageKey } from "@/lib/i18n";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { presentable } from "@/lib/userError";
import { Button, InlineNotice, Panel } from "@/components/kit";

type Phase = "choose" | "map" | "checking" | "preview" | "applying" | "done";
const STEPS: { id: string; labelKey: MessageKey; phases: Phase[] }[] = [
  { id: "file", labelKey: "import.step.file", phases: ["choose"] }, { id: "map", labelKey: "import.step.map", phases: ["map"] },
  { id: "review", labelKey: "import.step.review", phases: ["checking", "preview"] }, { id: "apply", labelKey: "import.step.apply", phases: ["applying", "done"] },
];
/**
 * An import that was started survives a reload, a closed tab and a new session in this browser: the server keeps the cursor, so only
 * the job id and plan hash are saved (localStorage). On return the portal asks the server where the job stands (getEmployeeImportV1).
 */
interface SavedJob { jobId: string; planHash: string; lines: number[]; fileName: string }
const jobKey = (companyId: string) => `dip-admin-import-job-v1:${companyId}`;
const ACTION_KEY: Record<PlanAction, MessageKey> = { create: "import.action.create", update: "import.action.update", unchanged: "import.action.unchanged", invalid: "import.action.invalid" };
const STAT_KEY = { create: "import.stat.create", update: "import.stat.update", unchanged: "import.stat.unchanged", invalid: "import.stat.invalid" } as const;
const PREVIEW_PAGE = 50;
interface ResultRow { line: number; email: string; outcome: "created" | "updated" | "unchanged" | "failed"; message?: string }

export default function ImportPage() {
  const { api, session } = useApp();
  const company = useLoad((a) => a.companyInfo(), "company");
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("choose");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [raw, setRaw] = useState<RawFile | null>(null);
  const [lines, setLines] = useState<number[]>([]);
  const [unfinished, setUnfinished] = useState<(SavedJob & { info?: ImportJobInfo }) | null>(null);
  const [resumeNote, setResumeNote] = useState("");
  const store = useMemo(() => (typeof window === "undefined" ? null : browserStore()), []);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [jobId, setJobId] = useState("");
  const [planHash, setPlanHash] = useState("");
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // The server's own counters from the last step: exact even when this page resumed a job or a batch was retried.
  const [serverCounts, setServerCounts] = useState<{ created: number; updated: number; unchanged: number } | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<PlanAction | "all">("all");
  const [shown, setShown] = useState(PREVIEW_PAGE);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [dragging, setDragging] = useState(false);

  // Leaving mid-import is safe (it can be continued), but the reviewer should know the tab is busy.
  useUnsavedGuard(phase === "applying");

  const domain = company.data?.emailDomain ?? "";
  const companyId = session?.companyId ?? "";
  const sessionJobs = () => { try { return window.localStorage; } catch { return null; } };

  useEffect(() => {
    // An import that was applying when the page closed can be continued; the server remembers how far it got.
    let cancelled = false;
    let saved: SavedJob | null = null;
    try {
      const raw = sessionJobs()?.getItem(jobKey(companyId));
      if (raw) saved = JSON.parse(raw) as SavedJob;
    } catch { /* nothing saved */ }
    if (!saved || !companyId) return;
    const job = saved;
    const forget = () => { try { sessionJobs()?.removeItem(jobKey(companyId)); } catch { /* ignore */ } };
    api.getImport(job.jobId).then(
      (info) => {
        if (cancelled) return;
        if (info.nextChunk >= info.chunkCount) {
          // It finished (this tab or another): nothing to continue, say what happened instead.
          forget();
          const { created, updated, unchanged, failed } = info.progress;
          setResumeNote(t(failed ? "import.resume.finishedFailed" : "import.resume.finished", { file: job.fileName || t("import.resume.lastImport"), created, updated, unchanged, failed }));
        } else {
          setUnfinished({ ...job, info });
        }
      },
      (failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.code === "not-found") forget(); // the job is gone: nothing to continue
        else setUnfinished(job); // can't reach the server right now: still offer to continue
      },
    );
    return () => { cancelled = true; };
  }, [api, companyId]);
  const counts = useMemo(() => planCounts(rows), [rows]);
  const visible = useMemo(() => rows.filter((r) => filter === "all" || r.action === filter), [rows, filter]);
  const changes = counts.create + counts.update;

  function startOver() {
    setPhase("choose"); setParsed(null); setRaw(null); setRows([]); setResults([]); setFinished(false); setError(""); setFilter("all"); setShown(PREVIEW_PAGE); setFileName("");
    if (input.current) input.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setPhase("checking");
    setProgress({ done: 0, total: 0 });
    const result = await readRawFile(file);
    if (result.fatal) { setError(result.fatal); setPhase("choose"); return; }
    setRaw(result);
    setPhase("map");
  }

  async function plan(result: ParsedImport) {
    setError("");
    setParsed(result);
    setPhase("checking");
    setProgress({ done: 0, total: result.rows.length });
    try {
      // One requestId per attempt: a retry with the same rows returns the same job.
      const planned = await planAll(api, result, crypto.randomUUID(), fileName);
      setRows(planned.rows);
      setJobId(planned.jobId);
      setPlanHash(planned.planHash);
      setLines(validRows(result).lines);
      setPhase("preview");
    } catch (failure) {
      setError(describe(failure, t("import.preview.failed")));
      setPhase("map");
    }
  }

  async function apply(resume: boolean, job: SavedJob = { jobId, planHash, lines, fileName }) {
    setConfirming(false);
    setPhase("applying");
    setError("");
    if (!resume) { setResults([]); setServerCounts(null); setProgress({ done: 0, total: counts.create + counts.update + counts.unchanged }); }
    try {
      sessionJobs()?.setItem(jobKey(companyId), JSON.stringify(job satisfies SavedJob));
    } catch { /* resume after reload just won't be offered */ }
    try {
      await applyAll(api, job.jobId, job.planHash, (step) => {
        setResults((previous) => [...previous, ...step.results.map((r) => ({ line: job.lines[r.rowNumber - 1] ?? r.rowNumber, email: r.email, outcome: r.outcome, message: r.message && presentable(r.message) ? r.message : undefined }))]);
        setProgress({ done: step.progress.processed, total: step.progress.total });
        setServerCounts({ created: step.progress.created, updated: step.progress.updated, unchanged: step.progress.unchanged });
      });
      setFinished(true);
      try { sessionJobs()?.removeItem(jobKey(companyId)); } catch { /* ignore */ }
      setPhase("done");
    } catch (failure) {
      // Finished chunks are kept; "Continue" asks the server for the next one and is safe to repeat.
      setError(describe(failure, t("import.applying.stopped")));
    }
  }

  function resumeSaved(job: SavedJob) {
    setJobId(job.jobId); setPlanHash(job.planHash); setLines(job.lines); setFileName(job.fileName); setUnfinished(null);
    setRows([]);
    void apply(true, job);
  }
  function discardSaved() {
    try { sessionJobs()?.removeItem(jobKey(companyId)); } catch { /* ignore */ }
    setUnfinished(null);
  }

  // Rows the preview already called invalid come back "failed" too; count each row once.
  const previewInvalid = new Set(rows.filter((r) => r.action === "invalid").map((r) => r.line));
  const failed = results.filter((r) => r.outcome === "failed" && !previewInvalid.has(r.line));
  const outcome = (name: ResultRow["outcome"]) => results.filter((r) => r.outcome === name).length;

  return (
    <Shell title={t("import.title")} subtitle={t("import.subtitle")} requires="import.run"
      action={<Button href="/roster/">{t("import.roster")}</Button>}>
      <ol className="steps" aria-label={t("import.steps.label")}>
        {STEPS.map((step, i) => (
          <li key={step.id} aria-current={step.phases.includes(phase) ? "step" : undefined} className={step.phases.includes(phase) ? "current" : undefined}>
            <span className="step-n">{i + 1}</span><span className="step-label">{t(step.labelKey)}</span>
          </li>
        ))}
      </ol>
      {phase === "choose" && (
        <>
          {resumeNote && <InlineNotice>{resumeNote}</InlineNotice>}
          {unfinished && (
            <Panel id="resume-h" title={t("import.unfinished.title")}>
              <p className="muted">
                {[
                  t("import.unfinished.closed", { file: unfinished.fileName || t("import.unfinished.anImport") }),
                  unfinished.info && t("import.unfinished.progress", { processed: formatNumber(unfinished.info.progress.processed), total: formatNumber(unfinished.info.progress.total), chunk: unfinished.info.nextChunk, chunks: unfinished.info.chunkCount }),
                  t("import.unfinished.remembers"),
                ].filter(Boolean).join(" ")}
              </p>
              <div className="actions"><Button variant="primary" onClick={() => resumeSaved(unfinished)}>{t("import.unfinished.continue")}</Button><Button onClick={() => setDismissing(true)}>{t("import.unfinished.dismiss")}</Button></div>
</Panel>
          )}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <div className="detail-layout">
            <Panel id="up" title={t("import.choose.title")}>
              <div
                className={`dropzone${dragging ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); void choose(e.dataTransfer.files[0]); }}
              >
                <p>{t("import.choose.drop")}</p>
                <label className="pill-btn dark file-btn">
                  {t("import.choose.button")}
                  <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void choose(e.target.files?.[0])} />
                </label>
                <p className="hint">{t("import.choose.limits", { rows: formatNumber(IMPORT_LIMITS.maxRows), mb: IMPORT_LIMITS.maxBytes / 1024 / 1024 })}</p>
              </div>
</Panel>
            <aside className="stack">
              <Panel id="tpl" title={t("import.template.title")}>
                <p className="muted">{t("import.template.body")}</p>
                <Button variant="primary" onClick={() => downloadText("dip-people-template.csv", templateCsv(domain))}>{t("import.template.download")}</Button>
</Panel>
              <Panel id="rules" title={t("import.rules.title")}>
                <ul className="plain">
                  <li>{t("import.rules.match")}{domain && <> {t("import.rules.matchDomain")} <strong>@{domain}</strong></>}.</li>
                  <li>{t("import.rules.teams")}</li>
                  <li>{t("import.rules.blank")}</li>
                  <li>{t("import.rules.invited")}</li>
                  <li>{t("import.rules.twice")}</li>
                </ul>
</Panel>
            </aside>
          </div>
        </>
      )}

      {phase === "map" && raw && store && (
        <>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <ImportMapping raw={raw} domain={domain} companyId={companyId} store={store} onBack={startOver} onContinue={(result) => void plan(result)} />
        </>
      )}

      {phase === "checking" && (
        <section className="panel" aria-live="polite">
          <h2>{t("import.checking.title", { file: fileName })}</h2>
          <progress className="progress" aria-label={t("import.checking.label")} />
          <p className="muted">{progress.total ? t("import.checking.rows", { count: progress.total }) : t("import.checking.reading")}</p>
          <Loading label={t("import.checking.label")} layout="importPreview" />
        </section>
      )}

      {phase === "preview" && parsed && (
        <>
          <div className="toolbar">
            <Info>{fileName}</Info>
            <span className="muted">{t("import.preview.only")}</span>
            <span className="spacer" />
            <Button onClick={() => setPhase("map")}>{t("import.preview.back")}</Button>
            {counts.invalid > 0 && <Button onClick={() => downloadText("import-errors.csv", errorCsv(rows.filter((r) => r.action === "invalid")))}>{t("import.preview.errorCsv")}</Button>}
            <Button variant="primary" disabled={changes === 0} onClick={() => setConfirming(true)}>{t("import.apply", { count: changes })}</Button>
          </div>
          {parsed.unknownColumns.length > 0 && <InlineNotice>{t("import.preview.ignored", { columns: parsed.unknownColumns.join(", ") })}</InlineNotice>}
          <div className="stats" role="group" aria-label={t("import.preview.summary")}>
            {(["create", "update", "unchanged", "invalid"] as const).map((a) => (
              <button key={a} className="stat" aria-pressed={filter === a} onClick={() => { setFilter(filter === a ? "all" : a); setShown(PREVIEW_PAGE); }}>
                <span className="stat-n">{counts[a]}</span><span>{t(STAT_KEY[a])}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? <Empty title={t("import.preview.emptyTitle")} body={t("import.preview.emptyBody")} action={<Button variant="primary" onClick={() => setFilter("all")}>{t("import.preview.showAll")}</Button>} /> : (
            <>
              <TableRegion label={t("import.preview.table")}>
                <table className="table responsive">
                  <caption className="sr-only">{t("import.preview.table")}</caption>
                  <thead><tr><th scope="col">{t("import.preview.line")}</th><th scope="col">{t("import.preview.email")}</th><th scope="col">{t("import.preview.result")}</th><th scope="col">{t("import.preview.changes")}</th></tr></thead>
                  <tbody>
                    {visible.slice(0, shown).map((r) => (
                      <tr key={r.line}>
                        <td data-label={t("import.preview.line")}>{r.line}</td>
                        <td data-label={t("import.preview.email")}>{r.email || <span className="muted">{t("import.preview.blank")}</span>}</td>
                        <td data-label={t("import.preview.result")}><Info tone={r.action === "invalid" ? "warn" : r.action === "unchanged" ? undefined : "ok"}>{t(ACTION_KEY[r.action])}</Info></td>
                        <td data-label={t("import.preview.changes")}>
                          {r.errors.map((e) => <p key={e} className="error">{e}</p>)}
                          {r.changes.length > 0 && (
                            <ul className="diff">
                              {r.changes.map((c) => (
                                <li key={c.field}><strong>{fieldLabel(c.field)}</strong> <span className="before">{c.before || t("import.preview.empty")}</span> <span aria-label={t("import.preview.becomes")}>→</span> <span className="after">{c.after}</span></li>
                              ))}
                            </ul>
                          )}
                          {r.action === "unchanged" && <span className="muted">{t("import.preview.upToDate")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableRegion>
              {visible.length > shown && <LoadMore shown={shown} total={visible.length} loading={false} label={t("import.preview.more")} onClick={() => setShown((n) => n + PREVIEW_PAGE)} />}
            </>
          )}
        </>
      )}

      {phase === "applying" && (
        <section className="panel" aria-live="polite">
          <h2>{t("import.applying.title")}</h2>
          <progress className="progress" value={progress.done} max={Math.max(progress.total, 1)} aria-label={t("import.applying.progress")} />
          <p className="muted">{t("import.applying.status", { done: progress.done, total: progress.total })}</p>
          {error && (
            <>
              <InlineNotice tone="error">{error}</InlineNotice>
              <div className="actions">
                <Button variant="primary" onClick={() => void apply(true)}>{t("import.applying.continue")}</Button>
                <Button onClick={() => setStopping(true)}>{t("import.applying.stop")}</Button>
              </div>
            </>
          )}
        </section>
      )}

      {phase === "done" && (
        <Panel id="done" title={<>{failed.length || !finished ? t("import.done.problems") : t("import.done.complete")}</>}>
          <div className="stats" role="group" aria-label={t("import.done.result")}>
            <div className="stat"><span className="stat-n">{serverCounts?.created ?? outcome("created")}</span><span>{t("import.done.added")}</span></div>
            <div className="stat"><span className="stat-n">{serverCounts?.updated ?? outcome("updated")}</span><span>{t("import.done.updated")}</span></div>
            <div className="stat"><span className="stat-n">{serverCounts?.unchanged ?? outcome("unchanged")}</span><span>{t("import.stat.unchanged")}</span></div>
            <div className="stat"><span className="stat-n">{failed.length + previewInvalid.size}</span><span>{t("import.done.skipped")}</span></div>
          </div>
          {!finished && <InlineNotice>{t("import.done.stoppedEarly")}</InlineNotice>}
          <div className="actions">
            <Button variant="primary" href="/roster/">{t("import.done.seeRoster")}</Button>
            {(failed.length > 0 || counts.invalid > 0) && (
              <Button onClick={() => downloadText("import-errors.csv", errorCsv([
        ...rows.filter((r) => r.action === "invalid"), ...failed.map((f) => ({ line: f.line, email: f.email, errors: [f.message ?? t("import.done.failed")] })),
       ]))}>{t("import.preview.errorCsv")}</Button>
            )}
            <Button onClick={startOver}>{t("import.done.another")}</Button>
          </div>
</Panel>
      )}

      {stopping && (
        <Dialog danger title={t("import.stop.title")} confirmLabel={t("import.stop.confirm")} busyLabel={t("import.stop.busy")} onClose={() => setStopping(false)}
          onConfirm={async () => { setStopping(false); setPhase("done"); }}>
          <p>{t("import.stop.body")}</p>
        </Dialog>
      )}
      {dismissing && (
        <Dialog danger title={t("import.dismiss.title")} confirmLabel={t("import.dismiss.confirm")} busyLabel={t("import.dismiss.busy")} onClose={() => setDismissing(false)}
          onConfirm={async () => { discardSaved(); setDismissing(false); }}>
          <p>{t("import.dismiss.body")}</p>
        </Dialog>
      )}
      {confirming && (
        <Dialog title={t("import.confirm.title")} confirmLabel={t("import.apply", { count: changes })} busyLabel={t("import.confirm.busy")} onClose={() => setConfirming(false)} onConfirm={async () => { void apply(false); }}>
          <p>{[
            t("import.confirm.added", { create: counts.create, update: counts.update }),
            counts.invalid > 0 && t("import.confirm.skipped", { count: counts.invalid }),
            t("import.confirm.audit"),
          ].filter(Boolean).join(" ")}</p>
        </Dialog>
      )}
    </Shell>
  );
}
