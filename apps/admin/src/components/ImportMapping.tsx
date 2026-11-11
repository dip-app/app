"use client";

import { useMemo, useState } from "react";
import { IMPORT_FIELDS } from "@/lib/adminTypes";
import type { KeyValueStore } from "@/lib/api";
import { type ParsedImport, type RawFile, FIELD_LABEL } from "@/lib/importFile";
import {
  type Target, TARGET_LABEL, applyMapping, dataRowsOf, forgetMapping, guessHeaderRow, loadSavedMapping, mapRow, mappingFromSaved, mappingIssues,
  columnLetter, saveMapping, suggestMapping,
} from "@/lib/importMapping";
import { Info } from "./Ui";
import { Toggle } from "./Toggle";

interface Props {
  raw: RawFile;
  domain: string;
  companyId: string;
  store: KeyValueStore;
  onBack: () => void;
  onContinue: (parsed: ParsedImport) => void;
}

const SAMPLE_ROWS = 3;
const HEADER_CHOICES = 10;

/** First guess for a sheet: the remembered mapping when it recognises the headers, otherwise a match by header name. */
function initialMapping(headers: string[], store: KeyValueStore, companyId: string): { mapping: Target[]; saved: boolean } {
  const saved = loadSavedMapping(store, companyId);
  const fromSaved = saved ? mappingFromSaved(headers, saved) : null;
  return fromSaved ? { mapping: fromSaved, saved: true } : { mapping: suggestMapping(headers), saved: false };
}

/** Step 2 of the import: say which spreadsheet column feeds which field before anything is checked or sent. */
export function ImportMapping({ raw, domain, companyId, store, onBack, onContinue }: Props) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const rows = raw.sheets[sheetIndex].rows;
  const [headerRow, setHeaderRow] = useState(() => guessHeaderRow(raw.sheets[0].rows));
  const headers = rows[headerRow] ?? [];
  const [state, setState] = useState(() => initialMapping(raw.sheets[0].rows[guessHeaderRow(raw.sheets[0].rows)] ?? [], store, companyId));
  const [remember, setRemember] = useState(true);
  const { mapping, saved } = state;

  const data = useMemo(() => dataRowsOf(rows, headerRow), [rows, headerRow]);
  const columnCount = Math.max(headers.length, ...data.slice(0, 20).map((row) => row.cells.length), 1);
  const columns = Array.from({ length: columnCount }, (_, i) => i);
  const issues = useMemo(() => mappingIssues(columns.map((i) => mapping[i] ?? "skip")), [columns, mapping]);
  const full = columns.map((i): Target => mapping[i] ?? "skip");
  const sample = data[0] ? mapRow(data[0].cells, full) : null;
  const mappedCount = full.filter((target) => target !== "skip").length;

  function reset(nextSheet: number, nextHeader: number) {
    setSheetIndex(nextSheet);
    setHeaderRow(nextHeader);
    setState(initialMapping(raw.sheets[nextSheet].rows[nextHeader] ?? [], store, companyId));
  }
  const change = (column: number, target: Target) => setState((previous) => {
    const next = [...previous.mapping];
    for (let i = 0; i < columnCount; i += 1) next[i] ??= "skip";
    next[column] = target;
    return { mapping: next, saved: false };
  });

  function next() {
    const parsed = applyMapping(rows, headerRow, full, domain);
    if (parsed.fatal) return;
    if (remember) saveMapping(store, companyId, columns.map((i) => headers[i] ?? ""), full);
    onContinue(parsed);
  }

  const headerChoices = Math.min(rows.length, HEADER_CHOICES);
  return (
    <section className="panel mapping" aria-labelledby="map-h">
      <div>
        <h2 id="map-h">2. Match your columns</h2>
        <p className="muted">Tell us what each column of <strong>{raw.fileName}</strong> holds. We guessed from the headers; change anything that’s off. Email is required.</p>
      </div>

      {(raw.sheets.length > 1 || rows.length > 1) && (
        <div className="row">
          {raw.sheets.length > 1 && (
            <div className="field"><label htmlFor="map-sheet">Sheet</label>
              <select id="map-sheet" value={sheetIndex} onChange={(e) => reset(Number(e.target.value), guessHeaderRow(raw.sheets[Number(e.target.value)].rows))}>
                {raw.sheets.map((sheet, i) => <option key={sheet.name} value={i}>{sheet.name}</option>)}
              </select></div>
          )}
          <div className="field"><label htmlFor="map-header">Header row</label>
            <select id="map-header" value={headerRow} onChange={(e) => reset(sheetIndex, Number(e.target.value))}>
              {Array.from({ length: headerChoices }, (_, i) => <option key={i} value={i}>Row {i + 1}{rows[i]?.some((c) => c.trim()) ? `: ${rows[i].filter((c) => c.trim()).slice(0, 3).join(", ")}` : " (empty)"}</option>)}
            </select>
            <span className="hint">The row with column names. Rows above it are ignored.</span></div>
        </div>
      )}

      {saved && (
        <p className="notice" role="status">
          Using the mapping you saved for this company. <button className="link-btn" onClick={() => setState({ mapping: suggestMapping(headers), saved: false })}>Start from suggestions</button>
          {" · "}<button className="link-btn" onClick={() => { forgetMapping(store, companyId); setState({ mapping: suggestMapping(headers), saved: false }); }}>Forget it</button>
        </p>
      )}

      <div className="table-wrap">
        <table className="table mapping-table">
          <caption className="sr-only">Map each spreadsheet column to a field</caption>
          <thead><tr><th scope="col">Column in your file</th><th scope="col">Sample values</th><th scope="col">Goes into</th></tr></thead>
          <tbody>
            {columns.map((i) => {
              const header = (headers[i] ?? "").trim();
              const values = data.slice(0, SAMPLE_ROWS).map((row) => (row.cells[i] ?? "").trim()).filter(Boolean);
              const target = full[i];
              return (
                <tr key={i}>
                  <th scope="row"><span className="col-letter" aria-hidden>{columnLetter(i)}</span> {header || <span className="muted">(no header)</span>}</th>
                  <td>{values.length ? values.map((v, k) => <span key={k} className="sample">{v}</span>) : <span className="muted">Empty</span>}</td>
                  <td>
                    <label className="sr-only" htmlFor={`map-${i}`}>Field for column {columnLetter(i)} {header}</label>
                    <select id={`map-${i}`} value={target} onChange={(e) => change(i, e.target.value as Target)} aria-invalid={target !== "skip" && full.filter((t) => t === target).length > 1}>
                      <option value="skip">{TARGET_LABEL.skip}</option>
                      {IMPORT_FIELDS.map((field) => <option key={field} value={field}>{FIELD_LABEL[field]}{field === "email" ? " (required)" : ""}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issues.errors.map((message) => <p key={message} className="error" role="alert">{message}</p>)}
      {issues.warnings.map((message) => <p key={message} className="notice" role="status">{message}</p>)}

      <div className="sample-row" aria-live="polite">
        <h3>First row, as it will be imported</h3>
        {!sample || issues.errors.length ? <p className="muted">{data.length === 0 ? "There are no rows under the header row." : "Fix the matches above to see a preview."}</p> : (
          <dl className="facts">
            {IMPORT_FIELDS.filter((field) => full.includes(field)).map((field) => {
              const value = field === "teams" ? sample.teams.join("; ") : sample[field];
              return <div key={field}><dt>{FIELD_LABEL[field]}</dt><dd>{value || <span className="muted">Empty</span>}</dd></div>;
            })}
          </dl>
        )}
        <p className="muted"><Info>{data.length} {data.length === 1 ? "row" : "rows"}</Info> {mappedCount} of {columnCount} columns used. Skipped columns are ignored. Dates should look like 2026-01-31.</p>
      </div>

      <Toggle checked={remember} onChange={setRemember} label="Remember this mapping" hint="Used next time a file has the same column names. Saved in this browser for your company." />

      <div className="actions">
        <button className="pill-btn purple" disabled={issues.errors.length > 0 || data.length === 0} onClick={next}>Check the rows</button>
        <button className="pill-btn gray" onClick={onBack}>Choose a different file</button>
      </div>
    </section>
  );
}
