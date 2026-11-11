import type { AdminOpsApi } from "./adminApi";
import type { ApplyRowResult, PlanRow } from "./adminTypes";
import { type ParsedImport, chunkRows } from "./importFile";

/**
 * Dry run: rows the browser already rejected become invalid plan rows; the rest go to the server in chunks
 * (importEmployeesV1), which returns create/update/unchanged/invalid with a field-level diff. Nothing is written.
 */
export async function planAll(
  api: Pick<AdminOpsApi, "planImportChunk">, parsed: ParsedImport, jobId: string,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<{ rows: PlanRow[]; chunkCount: number }> {
  const chunks = chunkRows(parsed);
  const rows: PlanRow[] = [];
  parsed.rows.forEach((row, i) => {
    const line = parsed.lines[i];
    const errors = parsed.localErrors.get(line);
    if (errors) rows.push({ line, email: row.email, action: "invalid", changes: [], errors });
  });
  let done = parsed.localErrors.size;
  onProgress(done, parsed.rows.length);
  for (const chunk of chunks) {
    const result = await api.planImportChunk({ jobId, chunkIndex: chunk.chunkIndex, chunkCount: chunks.length, rows: chunk.rows, lines: chunk.lines });
    rows.push(...result);
    done += chunk.rows.length;
    onProgress(done, parsed.rows.length);
  }
  return { rows: rows.sort((a, b) => a.line - b.line), chunkCount: chunks.length };
}

/** Applies planned chunks in order. Retrying from `startAt` is safe: the server returns the same result for a finished chunk. */
export async function applyAll(
  api: Pick<AdminOpsApi, "applyImportChunk">, jobId: string, chunkCount: number, startAt: number,
  onChunk: (index: number, results: ApplyRowResult[]) => void,
): Promise<void> {
  for (let index = startAt; index < chunkCount; index += 1) onChunk(index, await api.applyImportChunk(jobId, index));
}
