import type {
  AdminBugReport, AdminBugReportCounts, GetBugReportResponse, ListBugReportsResponse, UpdateBugReportResponse,
} from "../../../generated/models";
import { change } from "../domain/audit";
import {
  MAX_INLINE_SCREENSHOT, SCREENSHOT_TTL_MS, decodeCursor, dayEnd, dayStart, encodeCursor, matchesBugText, readTriage, toDiagnostics, toReport,
  type Triage,
} from "../domain/bugReports";
import { AdminError, stored } from "../domain/errors";
import { DELETE_FIELD, paths, SERVER_TIME } from "../domain/ops";
import { parseGetBugReport, parseListBugReports, parseUpdateBugReport } from "../domain/requests";
import { authorize, once, requireCaller, writeAudit, type Actor } from "./context";
import type { AdminDeps, AdminTransaction, Caller, Doc } from "./ports";

const SCAN_BATCH = 100;
/** The first page also counts statuses over the newest reports; later pages scan less. */
const FIRST_SCAN = 1000;
const NEXT_SCAN = 500;

const notFound = () => new AdminError("not-found", "BUG_REPORT_NOT_FOUND", "Bug report not found.");
const MISSING_REPORTER = { name: "Former member", email: "" };

/** Reads reporter profiles once per uid; `null` = no membership (the report cannot be attributed to a company). */
async function loadReporters(tx: AdminTransaction, uids: readonly string[], cache: Map<string, Doc | null>): Promise<void> {
  const missing = [...new Set(uids)].filter(uid => !cache.has(uid));
  const docs = await tx.getMany(missing.map(uid => paths.user(uid)));
  missing.forEach((uid, i) => cache.set(uid, docs[i] ?? null));
}

/**
 * listBugReportsV1: reports have no company on them (the client never supplies one), so the company is derived at read time from the
 * reporter's server-owned membership: only reports whose uid belongs to the caller's company are returned. Newest first, scanned in
 * bounded batches with a (createdAt, id) cursor; filters apply in memory so no composite index is needed. The first page adds counts
 * per status over the newest 1000 reports.
 */
export async function listBugReports(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<ListBugReportsResponse> {
  const authenticated = requireCaller(caller);
  const req = parseListBugReports(data);
  await deps.limiter?.consume(authenticated.uid);
  return deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "bugreport.manage");
    const firstPage = !req.pageToken;
    const budget = firstPage ? FIRST_SCAN : NEXT_SCAN;
    let after = req.pageToken ? decodeCursor(req.pageToken) ?? undefined : undefined;
    const users = new Map<string, Doc | null>();
    const reports: AdminBugReport[] = [];
    const counts = { all: 0, new: 0, triaged: 0, resolved: 0 };
    let scanned = 0;
    let exhausted = false;
    let lastIncluded: { at: Date; id: string } | undefined;
    let moreMatches = false;
    while (scanned < budget) {
      const batch = await tx.scanNewest(paths.bugReports, {
        field: "createdAt", limit: SCAN_BATCH, ...(req.from ? { from: dayStart(req.from) } : {}), ...(req.to ? { to: dayEnd(req.to) } : {}), ...(after ? { after } : {}),
      });
      await loadReporters(tx, batch.map(b => b.data.uid).filter((u): u is string => typeof u === "string"), users);
      const own = batch.filter(b => typeof b.data.uid === "string" && users.get(b.data.uid)?.companyId === actor.companyId);
      const triages = await tx.getMany(own.map(b => paths.bugTriage(actor.companyId, b.id)));
      const triageById = new Map(own.map((b, i) => [b.id, readTriage(triages[i] ?? null)]));
      for (const item of batch) {
        scanned += 1;
        const createdAt = item.data.createdAt;
        if (createdAt instanceof Date) after = { at: createdAt, id: item.id };
        const reporter = typeof item.data.uid === "string" ? users.get(item.data.uid) : null;
        if (!reporter || reporter.companyId !== actor.companyId) continue;
        const report = toReport(item.id, item.data, { name: typeof reporter.displayName === "string" ? reporter.displayName : MISSING_REPORTER.name, email: "" }, triageById.get(item.id) ?? readTriage(null));
        if (!report || !matchesBugText(report, req)) continue;
        if (firstPage) { counts.all += 1; counts[report.status] += 1; }
        if (req.status && report.status !== req.status) continue;
        if (reports.length < req.pageSize) {
          reports.push(report);
          if (createdAt instanceof Date) lastIncluded = { at: createdAt, id: item.id };
        } else moreMatches = true;
      }
      if (batch.length < SCAN_BATCH) { exhausted = true; break; }
      // Later pages stop as soon as a page is full; the first page keeps counting through its window.
      if (!firstPage && reports.length >= req.pageSize) break;
    }
    const full = reports.length >= req.pageSize;
    const resume = full ? (moreMatches || !exhausted ? lastIncluded : undefined) : exhausted ? undefined : after;
    return {
      contractVersion: 1, reports, ...(resume ? { nextPageToken: encodeCursor(resume.at, resume.id) } : {}),
      ...(firstPage ? { counts: { ...counts, capped: !exhausted } satisfies AdminBugReportCounts } : {}),
    } satisfies ListBugReportsResponse;
  });
}

/** The report, its reporter and triage state, when (and only when) the reporter belongs to the actor's company. */
async function loadReport(tx: AdminTransaction, actor: Actor, reportId: string): Promise<{ report: Doc; reporter: Doc; triageDoc: Doc | null }> {
  const report = await tx.get(paths.bugReport(reportId));
  const uid = report?.uid;
  if (!report || typeof uid !== "string") throw notFound();
  const reporter = await tx.get(paths.user(uid));
  // Another tenant's report (or one from someone without a membership) is indistinguishable from a missing one.
  if (!reporter || reporter.companyId !== actor.companyId) throw notFound();
  return { report, reporter, triageDoc: await tx.get(paths.bugTriage(actor.companyId, reportId)) };
}

/** getBugReportV1: full detail for admins, with the reporter's email, the app's diagnostics and a 15 minute screenshot URL. */
export async function getBugReport(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<GetBugReportResponse> {
  const authenticated = requireCaller(caller);
  const req = parseGetBugReport(data);
  await deps.limiter?.consume(authenticated.uid);
  const loaded = await deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "bugreport.manage");
    return loadReport(tx, actor, req.reportId);
  });
  const triage = readTriage(loaded.triageDoc);
  const reporterName = typeof loaded.reporter.displayName === "string" ? loaded.reporter.displayName : MISSING_REPORTER.name;
  const report = toReport(req.reportId, loaded.report, { name: reporterName, email: "" }, triage);
  stored(report !== null, "bug report");
  const uid = loaded.report.uid as string;
  // Only the exact object the rules allow the reporter to write is ever read.
  const expectedPath = `bugReports/${uid}/${req.reportId}.jpg`;
  let screenshot: { url: string; expiresAt: Date } | null = null;
  if (loaded.report.screenshotPath === expectedPath) {
    screenshot = await deps.objects.readUrl(expectedPath, SCREENSHOT_TTL_MS, MAX_INLINE_SCREENSHOT).catch(() => null);
  }
  const diagnostics = toDiagnostics(loaded.report.diagnostics);
  return {
    contractVersion: 1, report, reporterEmail: typeof loaded.reporter.email === "string" ? loaded.reporter.email : "",
    ...(diagnostics ? { diagnostics } : {}), ...(screenshot ? { screenshotUrl: screenshot.url, screenshotExpiresAt: screenshot.expiresAt.toISOString() } : {}),
    note: triage.note, revision: triage.revision, ...(triage.updatedAt ? { updatedAt: triage.updatedAt.toISOString() } : {}),
    ...(triage.updatedByName ? { updatedByName: triage.updatedByName } : {}),
  } satisfies GetBugReportResponse;
}

function response(reportId: string, triage: Triage, changed: boolean): UpdateBugReportResponse {
  return {
    contractVersion: 1, reportId, status: triage.status, note: triage.note, ...(triage.assigneeId ? { assigneeId: triage.assigneeId } : {}),
    ...(triage.assigneeName ? { assigneeName: triage.assigneeName } : {}), revision: triage.revision, ...(triage.updatedAt ? { updatedAt: triage.updatedAt.toISOString() } : {}), changed,
  };
}

/**
 * updateBugReportV1: triage state lives in companies/{c}/bugReportTriage/{reportId}, a server-owned document, so the client-created
 * bugReports document stays immutable. Idempotent per requestId; optional expectedRevision guards concurrent admins.
 */
export async function updateBugReport(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<UpdateBugReportResponse> {
  const authenticated = requireCaller(caller);
  const req = parseUpdateBugReport(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "bugreport.manage");
    return once(tx, actor, "updateBugReportV1", req.requestId, {
      reportId: req.reportId, status: req.status, note: req.note, assigneeId: req.assigneeId, expectedRevision: req.expectedRevision,
    }, async () => {
      const { triageDoc } = await loadReport(tx, actor, req.reportId);
      const current = readTriage(triageDoc);
      if (req.expectedRevision !== undefined && req.expectedRevision !== current.revision) {
        throw new AdminError("aborted", "REVISION_CONFLICT", "Someone else updated this report. Reload it and try again.");
      }
      let assignee: { id: string; name: string } | null | undefined;
      if (req.assigneeId === null) assignee = null;
      else if (req.assigneeId !== undefined) {
        const member = await tx.get(paths.user(req.assigneeId));
        if (!member || member.companyId !== actor.companyId || member.role !== "admin" || member.status === "deactivated" || typeof member.displayName !== "string") {
          throw new AdminError("not-found", "ASSIGNEE_NOT_FOUND", "That person can't be assigned. Pick an admin of your company.", ["assigneeId"]);
        }
        assignee = { id: req.assigneeId, name: member.displayName };
      }
      const next: Triage = { ...current };
      const changes = [];
      if (req.status !== undefined && req.status !== current.status) { next.status = req.status; changes.push(change("status", current.status, req.status)); }
      if (req.note !== undefined && req.note !== current.note) { next.note = req.note; changes.push(change("note", current.note === "" ? null : "(edited)", req.note === "" ? null : "(edited)")); }
      if (assignee !== undefined && (assignee?.id ?? undefined) !== current.assigneeId) {
        if (assignee) { next.assigneeId = assignee.id; next.assigneeName = assignee.name; } else { delete next.assigneeId; delete next.assigneeName; }
        changes.push(change("assignee", current.assigneeName ?? null, assignee?.name ?? null));
      }
      if (changes.length === 0) return response(req.reportId, current, false);
      next.revision = current.revision + 1;
      next.updatedAt = now;
      next.updatedByName = actor.name;
      const fields = {
        status: next.status, note: next.note, revision: next.revision, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
        ...(next.assigneeId ? { assigneeId: next.assigneeId, assigneeName: next.assigneeName } : {}),
      };
      if (!triageDoc) {
        tx.create(paths.bugTriage(actor.companyId, req.reportId), { companyId: actor.companyId, reportId: req.reportId, ...fields, createdAt: SERVER_TIME });
      } else {
        tx.update(paths.bugTriage(actor.companyId, req.reportId), {
          ...fields, ...(next.assigneeId ? {} : { assigneeId: DELETE_FIELD, assigneeName: DELETE_FIELD }),
        });
      }
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "bugreport.update", targetType: "bugReport", targetId: req.reportId,
        summary: `Updated bug report ${req.reportId.slice(0, 8)}${req.status && req.status !== current.status ? ` (${current.status} to ${req.status})` : ""}`,
        changes, requestId: req.requestId,
      });
      return response(req.reportId, next, true);
    }, now);
  })).value;
}
