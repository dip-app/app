import type { AdminOpsApi } from "./adminApi";
import type { ApplyStepResponse, PlanRow } from "./adminTypes";
import { type ParsedImport, validRows } from "./importFile";

export interface PlannedImport { jobId: string; planHash: string; chunkCount: number; rows: PlanRow[] }

/**
 * Dry run: rows the browser already rejected become invalid plan rows; the rest go to importEmployeesV1 in one
 * call (the server plans up to 2000 rows and returns create / update / unchanged / invalid with a field-level
 * diff). Nothing is applied. Server row numbers are positions in the submitted rows, mapped back here to
 * spreadsheet lines.
 */
export async function planAll(api: Pick<AdminOpsApi, "planImport">, parsed: ParsedImport, requestId: string, fileName: string): Promise<PlannedImport> {
  const rows: PlanRow[] = [];
  parsed.rows.forEach((row, i) => {
    const line = parsed.lines[i];
    const errors = parsed.localErrors.get(line);
    if (errors) rows.push({ line, email: row.email, action: "invalid", changes: [], errors });
  });
  const valid = validRows(parsed);
  let jobId = "";
  let planHash = "";
  let chunkCount = 0;
  if (valid.rows.length > 0) {
    const plan = await api.planImport({ requestId, fileName, rows: valid.rows });
    ({ jobId, planHash, chunkCount } = plan);
    for (const row of plan.rows) {
      rows.push({ line: valid.lines[row.rowNumber - 1] ?? row.rowNumber, email: row.email, action: row.action, changes: row.changes, errors: row.errors.map((e) => e.message) });
    }
  }
  return { jobId, planHash, chunkCount, rows: rows.sort((a, b) => a.line - b.line) };
}

/**
 * Applies the plan chunk by chunk (applyEmployeeImportV1 processes the next unprocessed chunk per call) until the
 * server reports `done`. Calling it again after a failure continues where the job stopped; a finished job is a no-op.
 */
export async function applyAll(
  api: Pick<AdminOpsApi, "applyImportStep">, jobId: string, planHash: string, onStep: (step: ApplyStepResponse) => void,
): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    const step = await api.applyImportStep(jobId, planHash);
    onStep(step);
    if (step.done) return;
  }
  throw new Error("The import didn’t finish. Run it again to continue.");
}
