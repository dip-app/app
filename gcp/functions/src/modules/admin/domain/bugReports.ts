import type { AdminBugReport, AdminBugReportDiagnostics } from "../../../generated/models";
import { validDate } from "./employee";

export const BUG_STATUSES = ["new", "triaged", "resolved"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export const BUG_CATEGORIES = ["bug", "confusing", "looksWrong", "idea", "unspecified"] as const;
export type BugCategory = (typeof BUG_CATEGORIES)[number];
export const MAX_NOTE = 2000;
/** Screenshots are capped at 400 KB by storage.rules, so an inline fallback stays small. */
export const MAX_INLINE_SCREENSHOT = 512 * 1024;
export const SCREENSHOT_TTL_MS = 15 * 60_000;

type Doc = Record<string, unknown>;
const isDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const text = (value: unknown, max: number): string | undefined => (typeof value === "string" && value !== "" ? [...value].slice(0, max).join("") : undefined);

/** Opaque cursor: the position (createdAt millis, document id) of the last report handed out. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.getTime()}~${id}`).toString("base64url");
}

export function decodeCursor(token: string): { at: Date; id: string } | null {
  let raw: string;
  try { raw = Buffer.from(token, "base64url").toString("utf8"); } catch { return null; }
  const split = raw.indexOf("~");
  if (split < 1) return null;
  const millis = Number(raw.slice(0, split));
  const id = raw.slice(split + 1);
  if (!Number.isSafeInteger(millis) || millis < 0 || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return { at: new Date(millis), id };
}

/** Inclusive UTC day bounds from YYYY-MM-DD strings (validated by the caller). */
export function dayStart(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
export function dayEnd(value: string): Date { return new Date(`${value}T23:59:59.999Z`); }
export const validDay = (value: string) => validDate(value);

export interface Reporter { name: string; email: string }

/** The diagnostics block exactly as the app sent it, restricted to known string fields. */
export function toDiagnostics(raw: unknown): AdminBugReportDiagnostics | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const d = raw as Doc;
  const out: AdminBugReportDiagnostics = {};
  const appVersion = text(d.appVersion, 32); if (appVersion) out.appVersion = appVersion;
  const appBuild = text(d.appBuild, 32); if (appBuild) out.appBuild = appBuild;
  const osVersion = text(d.osVersion, 32); if (osVersion) out.osVersion = osVersion;
  const deviceModel = text(d.deviceModel, 40); if (deviceModel) out.deviceModel = deviceModel;
  const locale = text(d.locale, 35); if (locale) out.locale = locale;
  const screen = text(d.screen, 32); if (screen) out.screen = screen;
  const installId = text(d.installId, 36); if (installId) out.installId = installId;
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface Triage { status: BugStatus; note: string; assigneeId?: string; assigneeName?: string; revision: number; updatedAt?: Date; updatedByName?: string }

/** Triage state of a report; a report without a triage document is `new`. */
export function readTriage(doc: Doc | null): Triage {
  if (!doc) return { status: "new", note: "", revision: 0 };
  const status = (BUG_STATUSES as readonly unknown[]).includes(doc.status) ? (doc.status as BugStatus) : "new";
  const triage: Triage = {
    status, note: typeof doc.note === "string" ? doc.note.slice(0, MAX_NOTE) : "",
    revision: typeof doc.revision === "number" && Number.isSafeInteger(doc.revision) && doc.revision >= 0 ? doc.revision : 0,
  };
  const assigneeId = text(doc.assigneeId, 128); if (assigneeId) triage.assigneeId = assigneeId;
  const assigneeName = text(doc.assigneeName, 200); if (assigneeName) triage.assigneeName = assigneeName;
  if (isDate(doc.updatedAt)) triage.updatedAt = doc.updatedAt;
  const updatedByName = text(doc.updatedByName, 200); if (updatedByName) triage.updatedByName = updatedByName;
  return triage;
}

/** A report as the inbox lists it, or null when the stored document is malformed (skipped, never fatal). */
export function toReport(id: string, doc: Doc, reporter: Reporter, triage: Triage): AdminBugReport | null {
  const category = doc.category;
  if (!(BUG_CATEGORIES as readonly unknown[]).includes(category) || typeof doc.uid !== "string" || !isDate(doc.createdAt)) return null;
  const source = doc.source === "profile" ? "profile" : "shake";
  const diagnostics = toDiagnostics(doc.diagnostics);
  const report: AdminBugReport = {
    id, category: category as BugCategory, description: typeof doc.description === "string" ? doc.description.slice(0, 1000) : "", source,
    screen: text(doc.screen, 32) ?? "other", createdAt: doc.createdAt.toISOString(), reporterId: doc.uid, reporterName: reporter.name,
    hasScreenshot: typeof doc.screenshotPath === "string" && doc.screenshotPath !== "", status: triage.status, hasNote: triage.note !== "",
  };
  if (diagnostics?.appVersion) report.appVersion = diagnostics.appVersion;
  if (triage.assigneeId) report.assigneeId = triage.assigneeId;
  if (triage.assigneeName) report.assigneeName = triage.assigneeName;
  return report;
}

export interface BugFilter { status?: BugStatus | undefined; category?: BugCategory | undefined; query?: string | undefined }

/** Category and text match (the status is applied separately so counts can ignore it). */
export function matchesBugText(report: AdminBugReport, filter: BugFilter): boolean {
  if (filter.category && report.category !== filter.category) return false;
  const q = filter.query?.trim().toLowerCase();
  if (!q) return true;
  return `${report.description} ${report.reporterName} ${report.screen} ${report.appVersion ?? ""} ${report.id} ${report.assigneeName ?? ""}`.toLowerCase().includes(q);
}
