import { z } from "zod";
import type { ManageSuggestionsEmailResponse, SuggestionsEmailPreview } from "../../../generated/models";
import { authorize, requireCaller, writeAudit, type Actor } from "../../admin/application/context";
import type { AdminStore, AdminTransaction, Caller, Doc, RateLimiter } from "../../admin/application/ports";
import { change } from "../../admin/domain/audit";
import { AdminError, invalid } from "../../admin/domain/errors";
import { paths, SERVER_TIME } from "../../admin/domain/ops";
import type { AiLog, AiSettings } from "../../ai/application/ports";
import { effectiveLimits } from "../../ai/domain/quota";
import { enqueueEmail, type EnqueueDeps } from "../../email/application/enqueueEmail";
import type { EmailPreferencesStore } from "../../email/application/ports";
import { resolveEmailPreferences } from "../../email/domain/categories";
import { renderEmail } from "../../email/domain/templates/render";
import { MIN_KEY_BYTES } from "../../email/domain/unsubscribeToken";
import type { PreferencesWriter } from "../../notifications/application/ports";
import { localParts, weekKey as weekKeyOf } from "../domain/signals";
import { getOrBuildDigest } from "./buildDigest";
import { DEFAULT_SCHEDULE, suggestionPaths, type BuildDeps, type CompanyContext, type Schedule, type StoredDigest, type SuggestionsConfig } from "./ports";
import { digestVariables } from "./variables";
import { validTimeZone } from "./weeklyJob";

export interface ManageDeps {
  /** Authorization and the schedule write (with its audit entry) run on the shared admin store. */
  admin: AdminStore;
  build: BuildDeps;
  enqueue: EnqueueDeps;
  preferences: EmailPreferencesStore;
  writer: PreferencesWriter;
  settings: AiSettings;
  config: SuggestionsConfig;
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ACTIONS = ["status", "preview", "sendTest", "subscribe", "unsubscribe", "setSchedule"] as const;

const ScheduleSchema = z.strictObject({ weekday: z.number().int().min(1).max(7), hour: z.number().int().min(0).max(23) });
const RequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  action: z.enum(ACTIONS),
  schedule: ScheduleSchema.optional(),
});

/** Field paths of a failed parse as VALIDATION_FAILED fields. */
export function fieldsOf(error: z.ZodError): string[] {
  const fields = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".");
    if (issue.code === "unrecognized_keys") for (const key of issue.keys) fields.add(path ? `${path}.${key}` : key);
    else fields.add(path || "request");
  }
  return [...fields];
}

interface ParsedRequest { companyId: string; action: (typeof ACTIONS)[number]; schedule: Schedule | null }

export function parseManageRequest(data: unknown): ParsedRequest {
  const parsed = RequestSchema.safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  const { companyId, action, schedule } = parsed.data;
  if (action === "setSchedule" && schedule === undefined) throw invalid(["schedule"]);
  if (action !== "setSchedule" && schedule !== undefined) throw invalid(["schedule"]);
  return { companyId, action, schedule: schedule ?? null };
}

const HOUR_MS = 3_600_000;

/** The next instant after `now` that is `hour:00` on the ISO weekday in the zone, as ISO UTC; null if none within 8 days. */
export function nextSendAt(now: Date, schedule: Schedule, timeZone: string): string | null {
  const first = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS;
  for (let i = 0; i < 24 * 8; i += 1) {
    const candidate = new Date(first + i * HOUR_MS);
    const p = localParts(candidate, timeZone);
    if (p.isoWeekday === schedule.weekday && p.hour === schedule.hour) return candidate.toISOString();
  }
  return null;
}

function firstName(displayName: string): string | null {
  const token = displayName.trim().split(/\s+/)[0] ?? "";
  return token.length > 0 ? token.slice(0, 80) : null;
}

function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data);
  else tx.create(path, data);
}

/**
 * manageSuggestionsEmailV1 (docs/design/stretch/admin-suggestions-email.md, Portal): status, subscribe/unsubscribe the
 * caller's own `admin_suggestions` email switch, the company schedule, a dry-run preview and a test send. Admins only
 * (`ai.generate`); the company comes from the server-owned membership, never from the request alone.
 */
export async function manageSuggestionsEmail(deps: ManageDeps, rawCaller: Caller | null, data: unknown): Promise<ManageSuggestionsEmailResponse> {
  const caller = requireCaller(rawCaller);
  const request = parseManageRequest(data);
  const { companyId } = request;
  await deps.limiter?.consume(caller.uid);
  const now = deps.now();

  if (request.action === "setSchedule") {
    const schedule = request.schedule!;
    await deps.admin.runTransaction(async tx => {
      const actor = await authorize(tx, caller, companyId, "ai.generate");
      const path = suggestionPaths.schedule(companyId);
      const existing = await tx.get(path);
      const before = readSchedule(existing);
      put(tx, path, existing, { weekday: schedule.weekday, hour: schedule.hour, updatedAt: SERVER_TIME, updatedBy: actor.uid });
      writeAudit(tx, actor, {
        id: `suggest_schedule_${actor.uid}_${now.getTime()}`,
        action: "suggestions.setSchedule",
        targetType: "company",
        targetId: companyId,
        summary: "Changed the weekly ideas email schedule", summaryKey: "suggestions.setSchedule",
        changes: [change("weekday", before?.weekday ?? null, schedule.weekday), change("hour", before?.hour ?? null, schedule.hour)],
      });
    });
    return status(deps, caller.uid, companyId, now);
  }

  const actor = await deps.admin.runReadOnly(tx => authorize(tx, caller, companyId, "ai.generate"));
  switch (request.action) {
    case "status":
      return status(deps, caller.uid, companyId, now);
    case "subscribe":
    case "unsubscribe":
      await deps.writer.setCategory(caller.uid, "email", "admin_suggestions", request.action === "subscribe");
      return status(deps, caller.uid, companyId, now);
    case "preview":
      return preview(deps, actor, now);
    default:
      return sendTest(deps, actor, now);
  }
}

function readSchedule(doc: Doc | null): Schedule | null {
  if (!doc) return null;
  const { weekday, hour } = doc;
  return Number.isInteger(weekday) && (weekday as number) >= 1 && (weekday as number) <= 7 && Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23
    ? { weekday: weekday as number, hour: hour as number }
    : null;
}

interface Snapshot { response: ManageSuggestionsEmailResponse; context: CompanyContext; timeZone: string }

async function snapshot(deps: ManageDeps, uid: string, companyId: string, now: Date): Promise<Snapshot> {
  const context = await deps.build.store.companyContext(companyId);
  const timeZone = validTimeZone(context.timeZone) ?? deps.config.defaultTimeZone;
  const schedule = context.schedule ?? DEFAULT_SCHEDULE;
  const subscribed = resolveEmailPreferences(await deps.preferences.getEmailMap(uid)).admin_suggestions;
  const emailEnabled = deps.config.emailEnabled && context.emailEnabled;
  const aiEnabled = effectiveLimits(deps.settings, context.aiSettings).enabled;
  const response: ManageSuggestionsEmailResponse = {
    contractVersion: 1, subscribed, emailEnabled, aiEnabled, schedule: { ...schedule }, timeZone,
    nextSendAt: emailEnabled && aiEnabled ? nextSendAt(now, schedule, timeZone) : null,
  };
  return { response, context, timeZone };
}

async function status(deps: ManageDeps, uid: string, companyId: string, now: Date): Promise<ManageSuggestionsEmailResponse> {
  return (await snapshot(deps, uid, companyId, now)).response;
}

function requireKey(deps: ManageDeps): void {
  if (Buffer.byteLength(deps.config.signingKey, "utf8") < MIN_KEY_BYTES) {
    throw new AdminError("failed-precondition", "AI_UNAVAILABLE", "The weekly ideas email isn't set up on this server yet.");
  }
}

async function digestFor(deps: ManageDeps, companyId: string, now: Date, snap: Snapshot): Promise<StoredDigest> {
  if (!effectiveLimits(deps.settings, snap.context.aiSettings).enabled) {
    throw new AdminError("failed-precondition", "AI_DISABLED", "AI event ideas are turned off for this company.");
  }
  const digest = await getOrBuildDigest(deps.build, companyId, now, { timeZone: snap.timeZone });
  if (digest === null) throw new AdminError("aborted", "REQUEST_IN_PROGRESS", "This week's ideas are still being prepared. Try again in a moment.");
  return digest;
}

/** Dry run: ranks (or reuses this week's digest) and renders in memory. Nothing is enqueued or sent. */
async function preview(deps: ManageDeps, actor: Actor, now: Date): Promise<ManageSuggestionsEmailResponse> {
  const snap = await snapshot(deps, actor.uid, actor.companyId, now);
  requireKey(deps);
  const digest = await digestFor(deps, actor.companyId, now, snap);
  const variables = digestVariables(digest, {
    companyId: actor.companyId, signingKey: deps.config.signingKey, origin: deps.config.origin, nowSeconds: Math.floor(now.getTime() / 1000),
  });
  if (deps.enqueue.validate("admin_suggestions", variables) === null) {
    throw new AdminError("internal", "INVALID_STORED_DATA", "Invalid stored digest.");
  }
  const rendered = renderEmail("admin_suggestions", variables, {
    recipientFirstName: firstName(actor.name), timeZone: snap.timeZone, unsubscribeURL: `${deps.config.origin}/admin/suggestions/`, openPixelURL: null,
    ...(actor.locale ? { locale: actor.locale } : {}),
  });
  const result: SuggestionsEmailPreview = {
    subject: rendered.subject, preheader: rendered.preheader, html: rendered.html, text: rendered.text,
    engine: digest.engine, ideaCount: variables.ideas.length, dataLevel: digest.dataLevel,
  };
  deps.log?.("suggestions.preview", { companyId: actor.companyId, weekKey: digest.weekKey, engine: digest.engine, ideas: variables.ideas.length });
  return { ...snap.response, preview: result };
}

/** Enqueues one test email for the caller through the normal outbox (so every send-time gate still applies). */
async function sendTest(deps: ManageDeps, actor: Actor, now: Date): Promise<ManageSuggestionsEmailResponse> {
  const snap = await snapshot(deps, actor.uid, actor.companyId, now);
  const refuse = (testReason: NonNullable<ManageSuggestionsEmailResponse["testReason"]>): ManageSuggestionsEmailResponse =>
    ({ ...snap.response, testQueued: false, testReason });
  if (!deps.config.emailEnabled) return refuse("EMAIL_DISABLED");
  if (!snap.context.emailEnabled) return refuse("COMPANY_EMAIL_DISABLED");
  if (!snap.response.subscribed) return refuse("NOT_SUBSCRIBED");
  requireKey(deps);
  const digest = await digestFor(deps, actor.companyId, now, snap);
  const variables = digestVariables(digest, {
    companyId: actor.companyId, signingKey: deps.config.signingKey, origin: deps.config.origin, nowSeconds: Math.floor(now.getTime() / 1000),
  });
  const hour = now.toISOString().slice(0, 13).replace(/[-T]/g, "");
  const result = await enqueueEmail(deps.enqueue, {
    template: "admin_suggestions", variables, uid: actor.uid, companyId: actor.companyId,
    objectId: `${actor.companyId}-${weekKeyOf(now, snap.timeZone)}-test`, revisionOrWindow: `test-${hour}`,
    notAfter: new Date(now.getTime() + 2 * 3_600_000),
  });
  if (result.enqueued) {
    // Only the call that actually queued the test records it (a duplicate is refused above), so there is one entry per queued test.
    // Nobody's address goes in the entry: the recipient is always the caller.
    const auditId = `suggest_test_${actor.uid}_${hour}`;
    await deps.admin.runTransaction(async tx => {
      if (await tx.get(paths.audit(actor.companyId, auditId))) return;
      writeAudit(tx, actor, {
        id: auditId, action: "suggestions.sendTest", targetType: "company", targetId: actor.companyId, summary: "Sent a test of the weekly ideas email to themselves", summaryKey: "suggestions.sendTest",
      });
    });
    return { ...snap.response, testQueued: true };
  }
  if (result.reason === "duplicate") return refuse("TEST_LIMIT");
  throw new AdminError("internal", "INVALID_STORED_DATA", "Invalid stored digest.");
}
