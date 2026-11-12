import { invalid } from "./errors";
import { ROLES, type Role } from "./permissions";
import { Reader, validWireId } from "./reader";
import { MAX_TEAMS_PER_MEMBER, validDate } from "./employee";
import { IMPORT_MAX_ROWS } from "./importPlan";
import { AdminError } from "./errors";
import { BUG_CATEGORIES, BUG_STATUSES, MAX_NOTE, decodeCursor, validDay } from "./bugReports";

const BASE = ["contractVersion", "companyId"];
const MUTATING = [...BASE, "requestId"];
const REQUIRED_ROLES = ROLES as readonly Role[];
const STATUSES = ["invited", "active", "deactivated"] as const;
const MEMBER_STATUS = ["active", "deactivated"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Photo ids are `{uid}_{slot}`; validated as wire ids here, the slot is only used to derive the Storage path. */
function photoId(reader: Reader): string {
  const value = reader.record.photoId;
  if (!validWireId(value) || value.length < 3) { reader.fail("photoId"); return ""; }
  return value;
}

export function parseRemovePhoto(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "eventId", "photoId", "reason"]);
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), eventId: r.id("eventId"), photoId: photoId(r), reason: r.optText("reason", 200) };
  r.finish();
  return req;
}

export function parseRemoveComment(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "eventId", "photoId", "commentId", "reason"]);
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), eventId: r.id("eventId"), photoId: photoId(r), commentId: r.id("commentId"), reason: r.optText("reason", 200) };
  r.finish();
  return req;
}

export function parseAddAttendee(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "eventId", "userId", "notify", "capacityOverrideReason"]);
  const req = {
    companyId: r.id("companyId"), requestId: r.requestId(), eventId: r.id("eventId"), userId: r.id("userId"),
    notify: r.optBool("notify") ?? false, capacityOverrideReason: r.optText("capacityOverrideReason", 200, 3),
  };
  r.finish();
  return req;
}

export function parseRemoveAttendee(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "eventId", "userId", "notify", "reason"]);
  const req = {
    companyId: r.id("companyId"), requestId: r.requestId(), eventId: r.id("eventId"), userId: r.id("userId"),
    notify: r.optBool("notify") ?? false, reason: r.optText("reason", 200),
  };
  r.finish();
  return req;
}

export function parseRecordAttendance(data: unknown) {
  const r = Reader.from(data, [...BASE, "eventId", "userId", "checkedIn"]);
  const req = { companyId: r.id("companyId"), eventId: r.id("eventId"), userId: r.id("userId"), checkedIn: r.optBool("checkedIn") ?? true };
  r.finish();
  return req;
}

export function parseListMembers(data: unknown) {
  const r = Reader.from(data, [...BASE, "query", "role", "status", "teamId", "workLocation", "pageSize", "pageToken"]);
  const req = {
    companyId: r.id("companyId"), query: r.optText("query", 80), role: r.optEnum("role", REQUIRED_ROLES), status: r.optEnum("status", STATUSES),
    teamId: r.optId("teamId"), workLocation: r.optText("workLocation", 120), pageSize: r.optInt("pageSize", 1, 100) ?? 50, pageToken: r.optId("pageToken"),
  };
  r.finish();
  return req;
}

export function parseGetMember(data: unknown) {
  const r = Reader.from(data, [...BASE, "userId"]);
  const req = { companyId: r.id("companyId"), userId: r.id("userId") };
  r.finish();
  return req;
}

export function parseGetCompanyInsights(data: unknown) {
  const r = Reader.from(data, [...BASE, "refresh"]);
  const req = { companyId: r.id("companyId"), refresh: r.optBool("refresh") ?? false };
  r.finish();
  return req;
}

export interface UpdateMemberRequest {
  companyId: string; requestId: string; userId: string; expectedRevision?: number | undefined; role?: Role | undefined; teamIds?: string[] | undefined;
  workLocation?: string | undefined; department?: string | undefined; jobTitle?: string | undefined; managerEmail?: string | undefined; startDate?: string | undefined;
}

export function parseUpdateMember(data: unknown): UpdateMemberRequest {
  const r = Reader.from(data, [...MUTATING, "userId", "expectedRevision", "role", "teamIds", "workLocation", "department", "jobTitle", "managerEmail", "startDate"]);
  const managerEmail = r.optText("managerEmail", 254);
  if (managerEmail !== undefined && managerEmail !== "" && !EMAIL.test(managerEmail)) r.fail("managerEmail");
  const startDate = r.optText("startDate", 10);
  if (startDate !== undefined && startDate !== "" && !validDate(startDate)) r.fail("startDate");
  const req: UpdateMemberRequest = {
    companyId: r.id("companyId"), requestId: r.requestId(), userId: r.id("userId"), expectedRevision: r.optInt("expectedRevision", 0, 1_000_000_000),
    role: r.optEnum("role", REQUIRED_ROLES), teamIds: r.idList("teamIds", MAX_TEAMS_PER_MEMBER),
    workLocation: r.optText("workLocation", 120), department: r.optText("department", 120), jobTitle: r.optText("jobTitle", 120),
    managerEmail: managerEmail?.toLowerCase(), startDate,
  };
  r.finish();
  return req;
}

export function parseResetProfile(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "userId", "reason"]);
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), userId: r.id("userId"), reason: r.optText("reason", 200) };
  r.finish();
  return req;
}

export function parseSetStatus(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "userId", "status", "reason"]);
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), userId: r.id("userId"), status: r.enum("status", MEMBER_STATUS), reason: r.optText("reason", 200) };
  r.finish();
  return req;
}

export function parseAdjustPoints(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "userId", "delta", "reason"]);
  const delta = r.int("delta", -100_000, 100_000);
  if (delta === 0 && r.record.delta !== undefined) r.fail("delta");
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), userId: r.id("userId"), delta, reason: r.text("reason", 200, 3) };
  r.finish();
  return req;
}

export function parseUpsertTeam(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "teamId", "name", "archived"]);
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), teamId: r.optId("teamId"), name: r.text("name", 80, 1), archived: r.optBool("archived") };
  r.finish();
  return req;
}

export function parseUpsertRoster(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "entry"]);
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), entry: r.record.entry as unknown };
  if (!req.entry || typeof req.entry !== "object" || Array.isArray(req.entry)) r.fail("entry");
  r.finish();
  return req;
}

const HASH = /^[0-9a-f]{64}$/;

export function parseRevokeRoster(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "entryId"]);
  const entryId = r.record.entryId;
  if (typeof entryId !== "string" || !HASH.test(entryId)) r.fail("entryId");
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), entryId: typeof entryId === "string" ? entryId : "" };
  r.finish();
  return req;
}

export function parseImportEmployees(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "fileName", "rows"]);
  const rows = r.record.rows;
  if (!Array.isArray(rows) || rows.length === 0) r.fail("rows");
  else if (rows.length > IMPORT_MAX_ROWS) {
    throw new AdminError("invalid-argument", "IMPORT_TOO_LARGE", `At most ${IMPORT_MAX_ROWS} rows per import.`, ["rows"]);
  }
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), fileName: r.optText("fileName", 200), rows: Array.isArray(rows) ? (rows as unknown[]) : [] };
  r.finish();
  return req;
}

export function parseApplyImport(data: unknown) {
  const r = Reader.from(data, [...BASE, "jobId", "planHash"]);
  const planHash = r.record.planHash;
  if (typeof planHash !== "string" || !HASH.test(planHash)) r.fail("planHash");
  const req = { companyId: r.id("companyId"), jobId: r.id("jobId"), planHash: typeof planHash === "string" ? planHash : "" };
  r.finish();
  return req;
}

export function parseGetImport(data: unknown) {
  const r = Reader.from(data, [...BASE, "jobId"]);
  const req = { companyId: r.id("companyId"), jobId: r.id("jobId") };
  r.finish();
  return req;
}

export { invalid };

export function parseResendRoster(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "entryId"]);
  const entryId = r.record.entryId;
  if (typeof entryId !== "string" || !HASH.test(entryId)) r.fail("entryId");
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), entryId: typeof entryId === "string" ? entryId : "" };
  r.finish();
  return req;
}

export function parseBackfillRoster(data: unknown) {
  const r = Reader.from(data, [...MUTATING, "dryRun", "pageToken"]);
  const dryRun = r.optBool("dryRun");
  if (dryRun === undefined) r.fail("dryRun");
  const req = { companyId: r.id("companyId"), requestId: r.requestId(), dryRun: dryRun === true, pageToken: r.optId("pageToken") };
  r.finish();
  return req;
}

const ROSTER_STATES = ["invited", "active", "deactivated", "revoked"] as const;
export type RosterState = (typeof ROSTER_STATES)[number];

export function parseListRoster(data: unknown) {
  const r = Reader.from(data, [...BASE, "state", "query", "pageSize", "pageToken"]);
  const req = {
    companyId: r.id("companyId"), state: r.optEnum("state", ROSTER_STATES), query: r.optText("query", 80), pageSize: r.optInt("pageSize", 1, 100) ?? 50,
    pageToken: r.optId("pageToken"),
  };
  r.finish();
  return req;
}

export function parseListBugReports(data: unknown) {
  const r = Reader.from(data, [...BASE, "status", "category", "query", "from", "to", "pageSize", "pageToken"]);
  const from = r.optText("from", 10);
  const to = r.optText("to", 10);
  if (from !== undefined && !validDay(from)) r.fail("from");
  if (to !== undefined && !validDay(to)) r.fail("to");
  if (from !== undefined && to !== undefined && validDay(from) && validDay(to) && from > to) r.fail("to");
  const pageToken = r.optId("pageToken");
  if (pageToken !== undefined && pageToken !== "" && !decodeCursor(pageToken)) r.fail("pageToken");
  const req = {
    companyId: r.id("companyId"), status: r.optEnum("status", BUG_STATUSES), category: r.optEnum("category", BUG_CATEGORIES), query: r.optText("query", 80),
    from, to, pageSize: r.optInt("pageSize", 1, 100) ?? 25, pageToken,
  };
  r.finish();
  return req;
}

export function parseGetBugReport(data: unknown) {
  const r = Reader.from(data, [...BASE, "reportId"]);
  const req = { companyId: r.id("companyId"), reportId: r.id("reportId") };
  r.finish();
  return req;
}

export interface UpdateBugReportRequest {
  companyId: string; requestId: string; reportId: string; status?: (typeof BUG_STATUSES)[number] | undefined; note?: string | undefined;
  /** A member id assigns, null clears, undefined leaves unchanged. */
  assigneeId?: string | null | undefined; expectedRevision?: number | undefined;
}

export function parseUpdateBugReport(data: unknown): UpdateBugReportRequest {
  const r = Reader.from(data, [...MUTATING, "reportId", "status", "note", "assigneeId", "expectedRevision"]);
  const rawAssignee = r.record.assigneeId;
  const assigneeId = rawAssignee === null ? null : r.optId("assigneeId");
  const req: UpdateBugReportRequest = {
    companyId: r.id("companyId"), requestId: r.requestId(), reportId: r.id("reportId"), status: r.optEnum("status", BUG_STATUSES),
    note: r.optText("note", MAX_NOTE), assigneeId, expectedRevision: r.optInt("expectedRevision", 0, 1_000_000_000),
  };
  if (req.status === undefined && req.note === undefined && req.assigneeId === undefined) r.fail("status");
  r.finish();
  return req;
}
