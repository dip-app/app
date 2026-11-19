import { resolveEmailPreferences } from "../domain/categories";
import { DIGEST_IMPORTS_MAX, DIGEST_NAMES_MAX } from "../domain/templates/render";
import type { TemplateVariables } from "../domain/templates/types";
import { enqueueEmail, type EnqueueDeps } from "./enqueueEmail";
import type { CompanySettingsReader, EmailPreferencesStore } from "./ports";

/**
 * Daily roster digest for admins (docs/design/email-catalog.md), following the weekly ideas job: an hourly scheduler
 * looks at every company with email on, and once the company's local time is past DIGEST_HOUR it reports the previous
 * local day: invited or imported people who joined (roster entries claimed that day; walk-in sign-ups are not
 * "invited") and imports that finished. Only admins whose own `admin_digest` switch is on (default off) get it, one
 * email per admin per company day (`admin_digest_<companyId-day>_<uid>_<day>`), and only when something happened.
 * Content is limited to what the roster and import pages already show admins: names and counts.
 */

/** Local hour (company zone) from which yesterday's digest goes out; later hourly runs the same morning catch up. */
export const DIGEST_HOUR = 8;
/** Hours after DIGEST_HOUR in which a missed run still sends (so a scheduler outage does not skip the day). */
export const DIGEST_CATCH_UP_HOURS = 4;
/** Companies handled per run, like the weekly ideas job. */
export const MAX_COMPANIES_PER_RUN = 500;
/** Roster entries and import jobs read per company day (bounded reads; counts above this read as this many). */
export const MAX_JOINS_READ = 1000;
export const MAX_IMPORTS_READ = 50;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface RosterJoin { displayName: string; claimedAt: Date }
export interface FinishedImport { invited: number; updated: number; failed: number; finishedAt: Date }

/** Server-side reads for the digest (Admin SDK adapter in infrastructure/firestoreDigestSource.ts). */
export interface DigestSource {
  /** Companies with `emailSettings/{companyId}.enabled == true`. */
  listEmailCompanies(limit: number): Promise<string[]>;
  /** Active (not deactivated) admins of the company. */
  listAdmins(companyId: string): Promise<string[]>;
  /** Roster entries of this company invited by an admin or an import (not `signup`) and claimed in [from, to), oldest first. */
  joinsBetween(companyId: string, from: Date, to: Date, limit: number): Promise<RosterJoin[]>;
  /** Imports of this company that finished (completed or completed with errors) in [from, to). */
  importsFinishedBetween(companyId: string, from: Date, to: Date, limit: number): Promise<FinishedImport[]>;
}

export interface AdminDigestDeps {
  source: DigestSource;
  companies: CompanySettingsReader;
  preferences: EmailPreferencesStore;
  enqueue: EnqueueDeps;
  config: { enabled: boolean; defaultTimeZone: string };
  log?: (event: string, fields: Record<string, string | number>) => void;
}

export interface AdminDigestSummary {
  companies: number;
  /** Companies inside their send window this run. */
  due: number;
  enqueued: number;
  duplicates: number;
  /** Due companies with no opted-in admin or nothing to report. */
  skipped: number;
  failed: number;
}

function validZone(value: string | null, fallback: string): string {
  if (value) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; } catch { /* fall back */ }
  }
  return fallback;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Wall-clock parts of an instant in a zone (24-hour clock, minutes included for half-hour offsets). */
function wallClock(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const out: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  for (const part of format.formatToParts(date)) out[part.type] = part.value;
  return { year: Number(out.year), month: Number(out.month), day: Number(out.day), hour: Number(out.hour) % 24, minute: Number(out.minute) };
}

/** The instant of 00:00 on a civil date in a zone (handles DST: the offset is re-read at the candidate instant). */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(new Date(guess), timeZone);
    const next = guess - (Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - target);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export interface DigestWindow { dayKey: string; from: Date; to: Date }

/** The previous local day of `now` when the local hour is inside the send window, else null. */
export function digestWindow(now: Date, timeZone: string): DigestWindow | null {
  const p = wallClock(now, timeZone);
  if (p.hour < DIGEST_HOUR || p.hour >= DIGEST_HOUR + DIGEST_CATCH_UP_HOURS) return null;
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const yesterday = new Date(today.getTime() - ONE_DAY_MS);
  const y = { year: yesterday.getUTCFullYear(), month: yesterday.getUTCMonth() + 1, day: yesterday.getUTCDate() };
  return {
    dayKey: `${y.year}-${pad(y.month)}-${pad(y.day)}`,
    from: zonedMidnight(y.year, y.month, y.day, timeZone),
    to: zonedMidnight(p.year, p.month, p.day, timeZone),
  };
}

/** Allow-listed digest variables, or null when there is nothing to report. */
export function digestVariables(dayKey: string, joins: readonly RosterJoin[], imports: readonly FinishedImport[]): TemplateVariables["admin_digest"] | null {
  if (joins.length === 0 && imports.length === 0) return null;
  const names = joins.map((join) => join.displayName.replace(/\s+/g, " ").trim().slice(0, 80)).filter((name) => name.length > 0).slice(0, DIGEST_NAMES_MAX);
  const newestFirst = [...imports].sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
  return {
    dayKey,
    joined: { count: joins.length, names },
    imports: newestFirst.slice(0, DIGEST_IMPORTS_MAX).map(({ invited, updated, failed, finishedAt }) => ({ invited, updated, failed, finishedAt: finishedAt.toISOString() })),
    importCount: imports.length,
  };
}

/** Hourly (UTC). Idempotent: outbox ids are per admin and company day, so later runs of the same morning enqueue nothing new. */
export async function runAdminDigests(deps: AdminDigestDeps, now: Date): Promise<AdminDigestSummary> {
  const summary: AdminDigestSummary = { companies: 0, due: 0, enqueued: 0, duplicates: 0, skipped: 0, failed: 0 };
  if (!deps.config.enabled) return summary;
  const companyIds = await deps.source.listEmailCompanies(MAX_COMPANIES_PER_RUN);
  for (const companyId of companyIds.slice(0, MAX_COMPANIES_PER_RUN)) {
    summary.companies += 1;
    try {
      await runCompany(deps, companyId, now, summary);
    } catch (error) {
      summary.failed += 1;
      deps.log?.("admin_digest.company_failed", { companyId, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  deps.log?.("admin_digest.job", { ...summary });
  return summary;
}

async function runCompany(deps: AdminDigestDeps, companyId: string, now: Date, summary: AdminDigestSummary): Promise<void> {
  const settings = await deps.companies.get(companyId);
  if (settings === null || !settings.enabled) return;
  const window = digestWindow(now, validZone(settings.timeZone, deps.config.defaultTimeZone));
  if (window === null) return;
  summary.due += 1;

  // Read the roster only for someone: active admins whose own switch is on.
  const recipients: string[] = [];
  for (const uid of await deps.source.listAdmins(companyId)) {
    if (resolveEmailPreferences(await deps.preferences.getEmailMap(uid)).admin_digest) recipients.push(uid);
  }
  if (recipients.length === 0) { summary.skipped += 1; return; }

  const [joins, imports] = await Promise.all([
    deps.source.joinsBetween(companyId, window.from, window.to, MAX_JOINS_READ),
    deps.source.importsFinishedBetween(companyId, window.from, window.to, MAX_IMPORTS_READ),
  ]);
  const variables = digestVariables(window.dayKey, joins, imports);
  if (variables === null) { summary.skipped += 1; return; }

  let enqueued = 0;
  for (const uid of recipients) {
    const result = await enqueueEmail(deps.enqueue, {
      template: "admin_digest", variables, uid, companyId, objectId: `${companyId}-${window.dayKey}`, revisionOrWindow: window.dayKey,
      // Stale by the next morning's digest.
      notAfter: new Date(now.getTime() + ONE_DAY_MS),
    });
    if (result.enqueued) { summary.enqueued += 1; enqueued += 1; }
    else if (result.reason === "duplicate") summary.duplicates += 1;
  }
  deps.log?.("admin_digest.company_done", { companyId, dayKey: window.dayKey, recipients: recipients.length, enqueued });
}
