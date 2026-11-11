import type {
  ApplyEmployeeImportResponse, GetEmployeeImportResponse, ImportEmployeesResponse, ImportRowPlan, ImportRowResult,
} from "../../../generated/models";
import { change } from "../domain/audit";
import { emailHash, newEntryFields } from "../domain/employee";
import { AdminError } from "../domain/errors";
import { revisionOf } from "../domain/member";
import { DELETE_FIELD, paths, SERVER_TIME } from "../domain/ops";
import { parseApplyImport, parseGetImport, parseImportEmployees } from "../domain/requests";
import { payloadHash } from "../domain/reader";
import {
  chunkRows, decideRow, IMPORT_CHUNK_SIZE, IMPORT_MAX_ERRORS, planHashOf, planImport, totalsOf, type PlannedRow,
} from "../domain/importPlan";
import { authorize, requireCaller, writeAudit, type Actor } from "./context";
import { findMemberByEmail, loadEmployeeContext } from "./roster";
import type { AdminDeps, AdminTransaction, Caller, Doc } from "./ports";

const LEASE_MS = 120_000;
const SCAN_PAGE = 500;
const MAX_SCAN_PAGES = 100;

async function scanAll(tx: AdminTransaction, collection: string, where: ReadonlyArray<readonly [string, unknown]>) {
  const all: Array<{ id: string; data: Doc }> = [];
  let afterId: string | undefined;
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const batch = await tx.list(collection, { where, limit: SCAN_PAGE, ...(afterId ? { afterId } : {}) });
    all.push(...batch);
    if (batch.length < SCAN_PAGE) break;
    afterId = batch[batch.length - 1]!.id;
  }
  return all;
}

const iso = (value: unknown) => (value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : new Date(0).toISOString());
const wirePlanRow = (row: PlannedRow): ImportRowPlan => ({
  rowNumber: row.rowNumber, email: row.email, action: row.action, target: row.target, changes: row.changes, errors: row.errors,
});

function responseFrom(jobId: string, job: Doc, rows: PlannedRow[]): ImportEmployeesResponse {
  return {
    contractVersion: 1, jobId, status: "planned", totals: job.totals as ImportEmployeesResponse["totals"], rows: rows.map(wirePlanRow),
    planHash: job.planHash as string, chunkCount: job.chunkCount as number,
  };
}

async function loadPlanRows(tx: AdminTransaction, actor: Actor, jobId: string, chunkCount: number): Promise<PlannedRow[]> {
  const rows: PlannedRow[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await tx.get(paths.importChunk(actor.companyId, jobId, i));
    if (!chunk || !Array.isArray(chunk.rows)) throw new AdminError("internal", "INVALID_STORED_DATA", "Invalid stored import.");
    rows.push(...(chunk.rows as PlannedRow[]));
  }
  return rows;
}

/**
 * importEmployeesV1 (dry run): validates every row, resolves teams, diffs against current members and roster entries and
 * stores the plan (job + chunks). Planning reads through a read-only snapshot; applying re-evaluates each row live, so a stale
 * plan converges safely. The same requestId with the same rows returns the same job.
 */
export async function importEmployees(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ImportEmployeesResponse> {
  const authenticated = requireCaller(caller);
  const req = parseImportEmployees(data);
  await deps.limiter?.consume(authenticated.uid);
  const hash = payloadHash({ fileName: req.fileName ?? null, rows: req.rows });
  const receiptPath = (actor: Actor) => paths.receipt(actor.companyId, actor.uid, req.requestId);

  const planned = await deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "import.run");
    const receipt = await tx.get(receiptPath(actor));
    if (receipt) return { actor, receipt };
    const ctx = await loadEmployeeContext(tx, actor);
    const members = new Map<string, Doc>();
    for (const m of await scanAll(tx, "users", [["companyId", actor.companyId]])) {
      if (typeof m.data.email === "string") members.set(m.data.email.toLowerCase(), m.data);
    }
    const roster = new Map<string, Doc>();
    for (const e of await scanAll(tx, paths.roster(actor.companyId), [])) roster.set(e.id, e.data);
    return { actor, rows: planImport(req.rows, { ...ctx, members, roster }) };
  });

  const replay = async (actor: Actor, receipt: Doc): Promise<ImportEmployeesResponse> => {
    if (receipt.command !== "importEmployeesV1" || receipt.hash !== hash || typeof receipt.jobId !== "string") {
      throw new AdminError("failed-precondition", "REQUEST_REUSED", "This request ID was already used with different details.", ["requestId"]);
    }
    const jobId = receipt.jobId;
    return deps.store.runReadOnly(async tx => {
      const job = await tx.get(paths.importJob(actor.companyId, jobId));
      if (!job) throw new AdminError("not-found", "IMPORT_JOB_NOT_FOUND", "Import not found.");
      return responseFrom(jobId, job, await loadPlanRows(tx, actor, jobId, job.chunkCount as number));
    });
  };
  if ("receipt" in planned) return replay(planned.actor, planned.receipt);

  const { rows } = planned;
  const now = deps.now();
  const jobId = deps.newId();
  const totals = totalsOf(rows);
  const planHash = planHashOf(rows);
  const chunks = chunkRows(rows, IMPORT_CHUNK_SIZE);
  return deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "import.run");
    const receipt = await tx.get(receiptPath(actor));
    if (receipt) return replay(actor, receipt); // a concurrent identical request won the race
    tx.create(paths.importJob(actor.companyId, jobId), {
      companyId: actor.companyId, status: "planned", ...(req.fileName ? { fileName: req.fileName } : {}), totals,
      progress: { processed: 0, total: rows.length, created: 0, updated: 0, unchanged: 0, failed: 0 },
      planHash, chunkCount: chunks.length, nextChunk: 0, errors: [], errorsTruncated: false, createdBy: actor.uid, createdAt: SERVER_TIME, updatedAt: SERVER_TIME,
    });
    chunks.forEach((chunk, index) => tx.create(paths.importChunk(actor.companyId, jobId, index), { index, rows: chunk }));
    tx.create(receiptPath(actor), { command: "importEmployeesV1", hash, jobId, createdAt: now, expireAt: new Date(now.getTime() + 30 * 86_400_000) });
    writeAudit(tx, actor, {
      id: `${actor.uid}_${req.requestId}`, action: "import.plan", targetType: "import", targetId: jobId,
      summary: `Planned an employee import of ${rows.length} rows (${totals.create} new, ${totals.update} updates, ${totals.invalid} invalid)`,
      changes: [change("rows", null, rows.length), change("invalid", null, totals.invalid)], requestId: req.requestId,
    });
    return { contractVersion: 1, jobId, status: "planned", totals, rows: rows.map(wirePlanRow), planHash, chunkCount: chunks.length } satisfies ImportEmployeesResponse;
  });
}

type RowOutcome = ImportRowResult;

/** Applies one planned row in its own transaction against live data; every failure is contained to the row. */
async function applyRow(deps: AdminDeps, actor: Actor, jobId: string, row: PlannedRow): Promise<RowOutcome> {
  const fail = (code: string, message: string): RowOutcome => ({ rowNumber: row.rowNumber, email: row.email, outcome: "failed", errorCode: code, message });
  if (row.action === "invalid" || !row.record) {
    const first = row.errors[0];
    return fail(first?.code ?? "INVALID_ROW", first?.message ?? "Row is invalid.");
  }
  const record = row.record;
  try {
    return await deps.store.runTransaction(async tx => {
      for (const teamId of record.teamIds ?? []) {
        const team = await tx.get(paths.team(actor.companyId, teamId));
        if (!team || team.archived === true) return fail("TEAM_NOT_FOUND", "A team in this row no longer exists.");
      }
      const member = await findMemberByEmail(tx, actor, record.email);
      const hash = emailHash(record.email);
      const entry = await tx.get(paths.rosterEntry(actor.companyId, hash));
      const decision = decideRow(record, member?.data, entry ?? undefined);
      const base = { rowNumber: row.rowNumber, email: row.email };
      const auditId = `${actor.uid}_${jobId}_${row.rowNumber}`;
      if (decision.kind === "error") return fail(decision.issue.code, decision.issue.message);
      if (decision.action === "unchanged") return { ...base, outcome: "unchanged" as const };
      if (decision.kind === "member" && member) {
        tx.update(paths.user(member.id), { ...decision.patch, revision: revisionOf(member.data) + 1 });
        if (entry) tx.update(paths.rosterEntry(actor.companyId, hash), { ...decision.patch, updatedAt: SERVER_TIME }); // roster lists everyone
        writeAudit(tx, actor, { id: auditId, action: "import.apply", targetType: "member", targetId: member.id,
          summary: `Import updated ${record.email}`, changes: decision.changes, requestId: jobId });
        return { ...base, outcome: "updated" as const };
      }
      if (decision.kind === "roster" && decision.action === "create") {
        tx.create(paths.rosterEntry(actor.companyId, hash), {
          companyId: actor.companyId, ...newEntryFields(record), status: "invited", source: "import", importJobId: jobId, invitedBy: actor.uid,
          createdAt: SERVER_TIME, updatedAt: SERVER_TIME, revision: 1,
        });
        writeAudit(tx, actor, { id: auditId, action: "import.apply", targetType: "roster", targetId: hash,
          summary: `Import invited ${record.email}`, changes: decision.changes, requestId: jobId });
        return { ...base, outcome: "created" as const };
      }
      if (decision.kind === "roster") {
        tx.update(paths.rosterEntry(actor.companyId, hash), { ...decision.patch, importJobId: jobId, updatedAt: SERVER_TIME, revision: (entry && typeof entry.revision === "number" ? entry.revision : 1) + 1 });
        writeAudit(tx, actor, { id: auditId, action: "import.apply", targetType: "roster", targetId: hash,
          summary: `Import updated the invitation for ${record.email}`, changes: decision.changes, requestId: jobId });
        return { ...base, outcome: "updated" as const };
      }
      return fail("INVALID_ROW", "Row could not be applied.");
    });
  } catch (error) {
    if (error instanceof AdminError) return fail(error.reason, error.message);
    return fail("APPLY_FAILED", "The row could not be saved. Apply the import again to retry.");
  }
}

function progressOf(job: Doc): ApplyEmployeeImportResponse["progress"] {
  return job.progress as ApplyEmployeeImportResponse["progress"];
}

/**
 * applyEmployeeImportV1: processes the next unprocessed chunk (<= 100 rows). A lease on the job serializes callers
 * (IMPORT_JOB_BUSY); a crashed run is picked up after the lease expires and re-applies the same chunk, which is
 * convergent (unchanged rows report as unchanged, so counters may be approximate after an interruption).
 */
export async function applyEmployeeImport(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ApplyEmployeeImportResponse> {
  const authenticated = requireCaller(caller);
  const req = parseApplyImport(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  const leaseId = deps.newId();
  const claimed = await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "import.run");
    const job = await tx.get(paths.importJob(actor.companyId, req.jobId));
    if (!job) throw new AdminError("not-found", "IMPORT_JOB_NOT_FOUND", "Import not found.");
    if (job.planHash !== req.planHash) throw new AdminError("failed-precondition", "IMPORT_PLAN_MISMATCH", "The plan changed. Review it again.");
    const nextChunk = job.nextChunk as number;
    if (nextChunk >= (job.chunkCount as number)) return { actor, job, finished: true as const };
    if (job.leaseUntil instanceof Date && job.leaseUntil.getTime() > now.getTime()) {
      throw new AdminError("aborted", "IMPORT_JOB_BUSY", "This import is already being applied.");
    }
    const chunk = await tx.get(paths.importChunk(actor.companyId, req.jobId, nextChunk));
    if (!chunk || !Array.isArray(chunk.rows)) throw new AdminError("internal", "INVALID_STORED_DATA", "Invalid stored import.");
    tx.update(paths.importJob(actor.companyId, req.jobId), { status: "running", leaseId, leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: SERVER_TIME });
    return { actor, job, finished: false as const, chunkIndex: nextChunk, rows: chunk.rows as PlannedRow[] };
  });
  if (claimed.finished) {
    return { contractVersion: 1, jobId: req.jobId, status: claimed.job.status as ApplyEmployeeImportResponse["status"], done: true, progress: progressOf(claimed.job), results: [] };
  }
  const { actor, chunkIndex, rows } = claimed;
  const results: RowOutcome[] = [];
  for (const row of rows) results.push(await applyRow(deps, actor, req.jobId, row));

  return deps.store.runTransaction(async tx => {
    const job = await tx.get(paths.importJob(actor.companyId, req.jobId));
    if (!job || job.leaseId !== leaseId || job.nextChunk !== chunkIndex) throw new AdminError("aborted", "IMPORT_JOB_BUSY", "This import is already being applied.");
    const progress = { ...progressOf(job) };
    progress.processed += results.length;
    for (const r of results) {
      if (r.outcome === "created") progress.created += 1;
      else if (r.outcome === "updated") progress.updated += 1;
      else if (r.outcome === "unchanged") progress.unchanged += 1;
      else progress.failed += 1;
    }
    const failed = results.filter(r => r.outcome === "failed");
    const previous = Array.isArray(job.errors) ? (job.errors as ImportRowResult[]) : [];
    const errors = [...previous, ...failed].slice(0, IMPORT_MAX_ERRORS);
    const next = chunkIndex + 1;
    const done = next >= (job.chunkCount as number);
    const status = done ? (progress.failed > 0 ? "completed_with_errors" : "completed") : "running";
    tx.update(paths.importJob(actor.companyId, req.jobId), {
      status, progress, errors, errorsTruncated: job.errorsTruncated === true || previous.length + failed.length > IMPORT_MAX_ERRORS,
      nextChunk: next, leaseUntil: DELETE_FIELD, leaseId: DELETE_FIELD, updatedAt: SERVER_TIME,
    });
    if (done) {
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.jobId}_done`, action: "import.apply", targetType: "import", targetId: req.jobId,
        summary: `Applied an employee import: ${progress.created} invited, ${progress.updated} updated, ${progress.failed} failed`,
        changes: [change("created", null, progress.created), change("updated", null, progress.updated), change("failed", null, progress.failed)], requestId: req.jobId,
      });
    }
    return { contractVersion: 1, jobId: req.jobId, status, done, progress, results } satisfies ApplyEmployeeImportResponse;
  });
}

/** getEmployeeImportV1: job summary and error-report data for the downloadable error CSV. */
export async function getEmployeeImport(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<GetEmployeeImportResponse> {
  const authenticated = requireCaller(caller);
  const req = parseGetImport(data);
  await deps.limiter?.consume(authenticated.uid);
  return deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "import.run");
    const job = await tx.get(paths.importJob(actor.companyId, req.jobId));
    if (!job) throw new AdminError("not-found", "IMPORT_JOB_NOT_FOUND", "Import not found.");
    return {
      contractVersion: 1,
      job: {
        id: req.jobId, companyId: actor.companyId, status: job.status as GetEmployeeImportResponse["job"]["status"], ...(typeof job.fileName === "string" ? { fileName: job.fileName } : {}),
        totals: job.totals as GetEmployeeImportResponse["job"]["totals"], progress: progressOf(job), planHash: job.planHash as string,
        chunkCount: job.chunkCount as number, nextChunk: job.nextChunk as number, errors: (job.errors as ImportRowResult[]) ?? [],
        errorsTruncated: job.errorsTruncated === true, createdBy: job.createdBy as string, createdAt: iso(job.createdAt), updatedAt: iso(job.updatedAt),
      },
    } satisfies GetEmployeeImportResponse;
  });
}
