import type { AiLog, AiSettings } from "../../ai/application/ports";
import { effectiveLimits } from "../../ai/domain/quota";
import { enqueueEmail, type EnqueueDeps } from "../../email/application/enqueueEmail";
import type { EmailPreferencesStore } from "../../email/application/ports";
import { resolveEmailPreferences } from "../../email/domain/categories";
import { MIN_KEY_BYTES } from "../../email/domain/unsubscribeToken";
import { localParts, weekKey as weekKeyOf } from "../domain/signals";
import { getOrBuildDigest } from "./buildDigest";
import { DEFAULT_SCHEDULE, type BuildDeps, type SuggestionsConfig } from "./ports";
import { digestVariables } from "./variables";

/** Companies handled per hourly run; the rest wait for the next run (the list is small by design). */
export const MAX_COMPANIES_PER_RUN = 500;
const TWO_DAYS_MS = 2 * 86_400_000;

export interface WeeklyJobDeps {
  build: BuildDeps;
  enqueue: EnqueueDeps;
  preferences: EmailPreferencesStore;
  /** Deployment-wide AI switches and limits (company document narrows them). */
  settings: AiSettings;
  config: SuggestionsConfig;
  log?: AiLog;
}

export interface WeeklySummary {
  /** Companies with email enabled that were looked at. */
  companies: number;
  /** Companies whose local time is at or after their scheduled send time on the scheduled weekday. */
  due: number;
  /** Digests obtained (built or reused) for due companies. */
  digests: number;
  enqueued: number;
  /** Outbox documents that already existed (a replay in the same week). */
  duplicates: number;
  /** Due companies with nothing to do: AI off, nobody opted in, a build in progress, or no ideas. */
  skipped: number;
  failed: number;
}

export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; } catch { return null; }
}

/**
 * Hourly job (docs/design/stretch/admin-suggestions-email.md, Flow). For every company with email enabled that is due
 * (local weekday matches and the local hour is at or after the schedule hour, so a missed run catches up the same
 * day), builds or reuses the week's digest and creates one outbox document per opted-in admin. Idempotent: the digest
 * is built once per company-week and the outbox id is deterministic. One company's failure never stops the others.
 */
export async function runWeeklySuggestions(deps: WeeklyJobDeps, now: Date): Promise<WeeklySummary> {
  const summary: WeeklySummary = { companies: 0, due: 0, digests: 0, enqueued: 0, duplicates: 0, skipped: 0, failed: 0 };
  const log = deps.log;
  if (!deps.config.emailEnabled) return summary;
  if (Buffer.byteLength(deps.config.signingKey, "utf8") < MIN_KEY_BYTES) {
    log?.("suggestions.config_incomplete", { reason: "signing_key" });
    return summary;
  }
  const { store } = deps.build;
  const companyIds = await store.listEmailCompanies(MAX_COMPANIES_PER_RUN);
  for (const companyId of companyIds.slice(0, MAX_COMPANIES_PER_RUN)) {
    summary.companies += 1;
    try {
      await runCompany(deps, companyId, now, summary);
    } catch (error) {
      summary.failed += 1;
      log?.("suggestions.company_failed", { companyId, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  log?.("suggestions.job", { ...summary });
  return summary;
}

async function runCompany(deps: WeeklyJobDeps, companyId: string, now: Date, summary: WeeklySummary): Promise<void> {
  const { store } = deps.build;
  const context = await store.companyContext(companyId);
  if (!context.emailEnabled) return;
  const timeZone = validTimeZone(context.timeZone) ?? deps.config.defaultTimeZone;
  const schedule = context.schedule ?? DEFAULT_SCHEDULE;
  const local = localParts(now, timeZone);
  if (local.isoWeekday !== schedule.weekday || local.hour < schedule.hour) return;
  summary.due += 1;

  if (!effectiveLimits(deps.settings, context.aiSettings).enabled) {
    summary.skipped += 1;
    return;
  }

  // Do not rank for nobody: only active admins whose own switch is on.
  const admins = await store.listAdmins(companyId);
  const recipients: string[] = [];
  for (const admin of admins) {
    const map = await deps.preferences.getEmailMap(admin.uid);
    if (resolveEmailPreferences(map).admin_suggestions) recipients.push(admin.uid);
  }
  if (recipients.length === 0) {
    summary.skipped += 1;
    return;
  }

  const digest = await getOrBuildDigest(deps.build, companyId, now, { timeZone });
  if (digest === null) {
    summary.skipped += 1;
    return;
  }
  summary.digests += 1;
  const variables = digestVariables(digest, {
    companyId, signingKey: deps.config.signingKey, origin: deps.config.origin, nowSeconds: Math.floor(now.getTime() / 1000),
  });
  if (variables.ideas.length === 0) {
    summary.skipped += 1;
    return;
  }
  const weekKey = weekKeyOf(now, timeZone);
  let enqueued = 0;
  for (const uid of recipients) {
    const result = await enqueueEmail(deps.enqueue, {
      template: "admin_suggestions", variables, uid, companyId, objectId: `${companyId}-${weekKey}`, revisionOrWindow: weekKey,
      notAfter: new Date(now.getTime() + TWO_DAYS_MS),
    });
    if (result.enqueued) { summary.enqueued += 1; enqueued += 1; }
    else if (result.reason === "duplicate") summary.duplicates += 1;
  }
  deps.log?.("suggestions.company_done", { companyId, weekKey, recipients: recipients.length, enqueued });
}
