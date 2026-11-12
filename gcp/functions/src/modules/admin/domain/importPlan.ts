import { change, type AuditChange } from "./audit";
import {
  emailHash, entryChanges, memberChanges, memberPatch, normalizeEmployee, type EmployeeContext, type EmployeeRecord, type RowIssue,
} from "./employee";
import { payloadHash } from "./reader";

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_CHUNK_SIZE = 100;
export const IMPORT_MAX_ERRORS = 1000;

type Doc = Record<string, unknown>;

export type RowAction = "create" | "update" | "unchanged" | "invalid";
export type RowTarget = "member" | "roster" | "none";

export interface PlannedRow {
  rowNumber: number;
  email: string;
  action: RowAction;
  target: RowTarget;
  changes: AuditChange[];
  errors: RowIssue[];
  /** Normalized, team-resolved record (null for invalid rows). */
  record: EmployeeRecord | null;
}

/** What applying a row would do against the current member and roster state. */
export type RowDecision =
  | { kind: "error"; issue: RowIssue }
  | { kind: "member"; action: "update" | "unchanged"; patch: Doc; changes: AuditChange[] }
  | { kind: "roster"; action: "create" | "update" | "unchanged"; patch: Doc; changes: AuditChange[]; existing: boolean };

/**
 * The single decision used by both the dry-run plan and the apply step (which re-evaluates against live data).
 * Never touches points, auth ids or a Google-owned displayName; an existing admin's role is protected here
 * (use updateMemberV1, which guards the last admin).
 */
export function decideRow(record: EmployeeRecord, member: Doc | undefined, entry: Doc | undefined): RowDecision {
  if (member) {
    if (member.role === "admin" && record.role !== undefined && record.role !== "admin") {
      return { kind: "error", issue: { field: "role", code: "ADMIN_ROLE_PROTECTED", message: "Use the member editor to change an admin's role." } };
    }
    const { patch, changes } = memberChanges(member, record);
    return { kind: "member", action: changes.length > 0 ? "update" : "unchanged", patch, changes };
  }
  if (entry) {
    const { patch, changes } = entryChanges(entry, record);
    return { kind: "roster", action: changes.length > 0 ? "update" : "unchanged", patch, changes, existing: true };
  }
  const supplied: Doc = { ...memberPatch(record), ...(record.displayName !== undefined ? { displayName: record.displayName } : {}) };
  const changes = Object.keys(supplied).map(field => change(field, null, supplied[field]));
  return { kind: "roster", action: "create", patch: supplied, changes, existing: false };
}

export interface PlanContext extends EmployeeContext {
  /** Existing members of the company keyed by lower-case email. */
  members: ReadonlyMap<string, Doc>;
  /** Existing roster entries keyed by email hash. */
  roster: ReadonlyMap<string, Doc>;
}

export function planImport(rows: readonly unknown[], ctx: PlanContext): PlannedRow[] {
  const seen = new Set<string>();
  return rows.map((raw, index): PlannedRow => {
    const rowNumber = index + 1;
    const { record, email, issues } = normalizeEmployee(raw, ctx);
    const invalid = (errors: RowIssue[]): PlannedRow => ({ rowNumber, email, action: "invalid", target: "none", changes: [], errors, record: null });
    if (issues.length > 0) return invalid(issues);
    if (seen.has(email)) return invalid([{ field: "email", code: "DUPLICATE_EMAIL", message: "Email appears more than once in the file." }]);
    seen.add(email);
    const decision = decideRow(record, ctx.members.get(email), ctx.roster.get(emailHash(email)));
    if (decision.kind === "error") return invalid([decision.issue]);
    return {
      rowNumber, email, action: decision.action, target: decision.kind === "member" ? "member" : "roster",
      changes: decision.changes.slice(0, 20), errors: [], record,
    };
  });
}

export function totalsOf(rows: readonly PlannedRow[]) {
  const totals = { total: rows.length, create: 0, update: 0, unchanged: 0, invalid: 0 };
  for (const row of rows) totals[row.action] += 1;
  return totals;
}

/** Hash of what would be applied; the apply step must present it (guards against a swapped or stale plan). */
export const planHashOf = (rows: readonly PlannedRow[]) =>
  payloadHash(rows.map(r => [r.rowNumber, r.email, r.action, r.target, r.record]));

export function chunkRows<T>(rows: readonly T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/** Outcome counters of one chunk, stored per chunk on the job so progress is derived from state, never incremented. */
export interface ChunkTally { created: number; updated: number; unchanged: number; failed: number }
export type Tallies = Record<string, ChunkTally>;

export function tallyOf(results: ReadonlyArray<{ outcome: "created" | "updated" | "unchanged" | "failed" }>): ChunkTally {
  const tally: ChunkTally = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  for (const r of results) tally[r.outcome] += 1;
  return tally;
}

const num = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/**
 * Job progress is the sum of the per-chunk tallies. Re-applying an interrupted chunk replaces that chunk's tally
 * (rows applied by the first attempt keep their stored outcome), so counters stay exact however often a chunk is retried.
 */
export function progressFromTallies(tallies: Tallies, total: number) {
  const sum: ChunkTally = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  for (const t of Object.values(tallies)) for (const key of Object.keys(sum) as Array<keyof ChunkTally>) sum[key] += num(t[key]);
  return { processed: sum.created + sum.updated + sum.unchanged + sum.failed, total, ...sum };
}
