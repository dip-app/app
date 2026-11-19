"use client";
// @i18n-migrated

import { useMemo, useState } from "react";
import { IMPORT_FIELDS } from "@/lib/adminTypes";
import type { KeyValueStore } from "@/lib/api";
import { type ParsedImport, type RawFile, fieldLabel } from "@/lib/importFile";
import { t } from "@/lib/i18n";
import {
  type Target, applyMapping, dataRowsOf, forgetMapping, guessHeaderRow, isRetiredHeader, loadSavedMapping, mapRow, mappingFromSaved, mappingIssues,
  columnLetter, saveMapping, suggestMapping,
} from "@/lib/importMapping";
import { TableRegion } from "./TableRegion";
import { Info } from "./Ui";
import { Toggle } from "./Toggle";
import { Button } from "@/components/kit";

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
        <h2 id="map-h">{t("import.map.title")}</h2>
        <p className="muted">{t("import.map.introBefore")} <strong>{raw.fileName}</strong>{t("import.map.introAfter")}</p>
      </div>

      {(raw.sheets.length > 1 || rows.length > 1) && (
        <div className="row">
          {raw.sheets.length > 1 && (
            <div className="field"><label htmlFor="map-sheet">{t("import.map.sheet")}</label>
              <select id="map-sheet" value={sheetIndex} onChange={(e) => reset(Number(e.target.value), guessHeaderRow(raw.sheets[Number(e.target.value)].rows))}>
                {raw.sheets.map((sheet, i) => <option key={sheet.name} value={i}>{sheet.name}</option>)}
              </select></div>
          )}
          <div className="field"><label htmlFor="map-header">{t("import.map.headerRow")}</label>
            <select id="map-header" value={headerRow} onChange={(e) => reset(sheetIndex, Number(e.target.value))}>
              {Array.from({ length: headerChoices }, (_, i) => <option key={i} value={i}>{rows[i]?.some((c) => c.trim()) ? t("import.map.rowOption", { n: i + 1, cells: rows[i].filter((c) => c.trim()).slice(0, 3).join(", ") }) : t("import.map.rowEmpty", { n: i + 1 })}</option>)}
            </select>
            <span className="hint">{t("import.map.headerHint")}</span></div>
        </div>
      )}

      {saved && (
        <p className="notice" role="status">
          {t("import.map.saved")}{" "}
          <Button size="sm" onClick={() => setState({ mapping: suggestMapping(headers), saved: false })}>{t("import.map.suggestions")}</Button>{" "}
          <Button size="sm" onClick={() => { forgetMapping(store, companyId); setState({ mapping: suggestMapping(headers), saved: false }); }}>{t("import.map.forget")}</Button>
        </p>
      )}

      <TableRegion label={t("import.map.table")}>
        <table className="table mapping-table">
          <caption className="sr-only">{t("import.map.caption")}</caption>
          <thead><tr><th scope="col">{t("import.map.colFile")}</th><th scope="col">{t("import.map.colSamples")}</th><th scope="col">{t("import.map.colGoes")}</th></tr></thead>
          <tbody>
            {columns.map((i) => {
              const header = (headers[i] ?? "").trim();
              const values = data.slice(0, SAMPLE_ROWS).map((row) => (row.cells[i] ?? "").trim()).filter(Boolean);
              const target = full[i];
              return (
                <tr key={i}>
                  <th scope="row"><span className="col-letter" aria-hidden>{columnLetter(i)}</span> {header || <span className="muted">{t("import.map.noHeader")}</span>}</th>
                  <td>{values.length ? values.map((v, k) => <span key={k} className={`sample${k > 0 ? " extra" : ""}`}>{v}</span>) : <span className="muted">{t("import.map.empty")}</span>}</td>
                  <td>
                    <label className="sr-only" htmlFor={`map-${i}`}>{t("import.map.fieldFor", { letter: columnLetter(i), header })}</label>
                    <select id={`map-${i}`} value={target} onChange={(e) => change(i, e.target.value as Target)} aria-invalid={target !== "skip" && full.filter((t) => t === target).length > 1}>
                      <option value="skip">{isRetiredHeader(header) ? t("import.map.skipNotUsed") : t("import.map.skip")}</option>
                      {IMPORT_FIELDS.map((field) => <option key={field} value={field}>{field === "email" ? t("import.map.required", { field: fieldLabel(field) }) : fieldLabel(field)}</option>)}
                    </select>                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableRegion>

      {issues.errors.map((message) => <p key={message} className="error" role="alert">{message}</p>)}
      {issues.warnings.map((message) => <p key={message} className="notice" role="status">{message}</p>)}

      <div className="sample-row" aria-live="polite">
        <h3>{t("import.map.firstRow")}</h3>
        {!sample || issues.errors.length ? <p className="muted">{data.length === 0 ? t("import.map.noRows") : t("import.map.fixMatches")}</p> : (
          <dl className="facts">
            {IMPORT_FIELDS.filter((field) => full.includes(field)).map((field) => {
              const value = field === "teams" ? sample.teams.join("; ") : sample[field];
              return <div key={field}><dt>{fieldLabel(field)}</dt><dd>{value || <span className="muted">{t("import.map.empty")}</span>}</dd></div>;
            })}
          </dl>
        )}
        <p className="muted"><Info>{t("import.map.rowsFound", { count: data.length })}</Info> {t("import.map.columnsUsed", { mapped: mappedCount, total: columnCount })}</p>
        <p className="hint">{t("import.map.teamsHint")}</p>
      </div>

      <Toggle checked={remember} onChange={setRemember} label={t("import.map.remember")} hint={t("import.map.rememberHint")} />

      <div className="actions">
        <Button variant="primary" disabled={issues.errors.length > 0 || data.length === 0} onClick={next}>{t("import.map.check")}</Button>
        <Button onClick={onBack}>{t("import.map.otherFile")}</Button>
      </div>
    </section>
  );
}
