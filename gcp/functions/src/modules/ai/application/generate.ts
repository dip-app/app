import type { GeneratedEventDraft, GenerateEventDraftsResponse } from "../../../generated/models";
import { authorize, requireCaller, writeAudit, type Actor } from "../../admin/application/context";
import type { AdminTransaction, Doc } from "../../admin/application/ports";
import { change, type AuditChange } from "../../admin/domain/audit";
import { AdminError, type AdminErrorReason } from "../../admin/domain/errors";
import { payloadHash } from "../../admin/domain/reader";
import { chargeCredits, creditsExhausted, creditsSummary, CREDIT_COSTS, ledgerDocument, ledgerFromDoc, refundCredits, type LedgerBase } from "../domain/credits";
import { draftCheckQuestions, draftState, interpretDraftCheck, TRIAGE_QUESTIONS, triageState, triageVerdict } from "../domain/decisions";
import { InvalidModelOutput, parseModelDrafts } from "../domain/drafts";
import { summarizeInterests } from "../domain/interests";
import { aiPaths, dayKey, monthKey } from "../domain/paths";
import { callWorstCaseMicros, costMicros, outputCeiling, worstCaseMicros } from "../domain/pricing";
import { buildGenerateUserContent, GENERATE_SYSTEM_PROMPT, modelDraftsSchema } from "../domain/prompt";
import {
  addSpend, checkPlatform, checkReservation, effectiveLimits, monthDocument, platformDocument, readDay, readMonth, readPlatform, RESERVATION_TTL_MS,
  RUN_DEADLINE_MS, usageSummary, type Limits,
} from "../domain/quota";
import { parseGenerateRequest, type ParsedGenerateRequest } from "../domain/request";
import { loadLedger } from "./credits";
import { LlmUnavailableError, type AiDeps, type Caller, type CatalogTag, type LlmUsage } from "./ports";

const REQUEST_RETENTION_MS = 24 * 3_600_000;
const DAY_RETENTION_MS = 8 * 86_400_000;
/** Thin interests named in the prompt (names only, never counts). */
const THIN_IN_PROMPT = 8;

/** Metered spend of one run, whatever the outcome. */
interface Meter { spentMicros: number; tokensIn: number; tokensOut: number; calls: number; models: string[]; providers: string[] }

/** What one model run produced. `extra` holds content-free audit details (names of reasons or categories, never text). */
type RunResult =
  | ({ status: "done"; drafts: GeneratedEventDraft[]; extra: AuditChange[] } & Meter)
  | ({ status: "flagged" | "failed"; reason: AdminErrorReason; detail: string; extra: AuditChange[] } & Meter);

/** Accumulates spend as calls finish, so the catch path settles with what was really spent. */
interface Metering {
  record: (model: string, usage: LlmUsage, provider?: string) => void;
  /** Wraps a billable call: refuses after the deadline, and charges a conservative estimate when the call fails with unknown usage. */
  guard: <T>(step: "triage" | "generate" | "draftCheck", call: () => Promise<T>) => Promise<T>;
  snapshot: () => Meter;
}

function createMeter(deps: AiDeps, signal: AbortSignal): Metering {
  const models = new Set<string>();
  const providers = new Set<string>();
  const meter = { spentMicros: 0, tokensIn: 0, tokensOut: 0, calls: 0 };
  return {
    record: (model, usage, provider) => {
      meter.calls += 1;
      meter.spentMicros += costMicros(model, usage);
      meter.tokensIn += usage.inputTokens;
      meter.tokensOut += usage.outputTokens;
      models.add(model);
      if (provider) providers.add(provider);
    },
    guard: async (step, call) => {
      if (signal.aborted) throw new LlmUnavailableError(null, "run deadline reached");
      try {
        return await call();
      } catch (error) {
        // A timeout, network drop or 5xx may still have been billed; a 4xx (auth, rate limit) is not.
        if (error instanceof LlmUnavailableError && (error.status === null || error.status >= 500)) {
          meter.calls += 1;
          meter.spentMicros += callWorstCaseMicros(deps.settings, step);
        }
        throw error;
      }
    },
    snapshot: () => ({ ...meter, models: [...models], providers: [...providers] }),
  };
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface Reservation {
  actor: Actor; limits: Limits; attempt: number; month: string; day: string;
  /** Where the run's credits were charged, under which key, and the period figures needed to answer after a month change. */
  credits: { path: string; key: string; base: LedgerBase };
}

const SETTLE_ATTEMPTS = 3;
const SETTLE_BACKOFF_MS = 250;

/**
 * generateEventDraftsV1 (docs/design/stretch/ai-event-creation.md). Three steps so the slow model calls never hold a
 * transaction open:
 * 1. Reserve (transaction): authorize `ai.generate`, honor the kill switches, replay a finished requestId, refuse a
 *    concurrent duplicate, check the per-admin daily, company monthly and daily/monthly budget caps, and reserve the
 *    worst-case cost. Concurrent calls serialize on the month document, so parallel requests cannot pass a cap.
 * 2. Run (no transaction): moderate and triage the admin's note, draft with structured output (invalid output is
 *    retried once), then moderate and check every draft. Nothing is written to events.
 * 3. Settle (transaction): release the reservation, add the actual cost and tokens to the month and day totals, count
 *    the generation only on success (a declined note counts toward the daily flag limit instead), store the result
 *    for replay and write a content-free audit entry. Expired reservations (a crashed run) are dropped on the next
 *    read, so the caps heal themselves.
 */
export async function generateEventDrafts(deps: AiDeps, rawCaller: Caller | null, data: unknown): Promise<GenerateEventDraftsResponse> {
  const caller = requireCaller(rawCaller);
  const catalog = await deps.catalog.list();
  const request = parseGenerateRequest(data, new Set(catalog.map(tag => tag.id)));
  const { companyId, requestId } = request;
  const hash = payloadHash({ choices: request.choices, prompt: request.prompt, count: request.count });
  const worst = worstCaseMicros(deps.settings);
  const key = `${caller.uid}_${requestId}`;
  await deps.limiter?.consume(caller.uid);

  const reserved = await deps.store.runTransaction(async (tx): Promise<{ replay: GenerateEventDraftsResponse } | { reservation: Reservation }> => {
    const actor = await authorize(tx, caller, companyId, "ai.generate");
    const now = deps.now();
    const month = monthKey(now);
    const day = dayKey(now);
    const [settingsDoc, monthDoc, dayDoc, requestDoc, platformDoc] = await tx.getMany([
      aiPaths.settings(companyId), aiPaths.month(companyId, month), aiPaths.day(companyId, day, caller.uid), aiPaths.request(companyId, caller.uid, requestId),
      aiPaths.platform(month),
    ]);
    const limits = effectiveLimits(deps.settings, settingsDoc ?? null);
    const monthState = readMonth(monthDoc ?? null, now);
    const dayState = readDay(dayDoc ?? null);
    const { ledger, base, path: creditsPath, doc: creditsDoc } = await loadLedger(tx, companyId, settingsDoc ?? null, now);
    if (requestDoc) {
      if (requestDoc.hash !== hash) {
        throw new AdminError("failed-precondition", "REQUEST_REUSED", "This request ID was already used with different details.", ["requestId"]);
      }
      if (requestDoc.status === "done") {
        return { replay: { contractVersion: 1, drafts: storedDrafts(requestDoc), usage: usageSummary(monthState, dayState, caller.uid, limits, worst, now), credits: creditsSummary(ledger), replay: true } };
      }
      if (requestDoc.status === "pending" && key in monthState.pending) {
        throw new AdminError("aborted", "REQUEST_IN_PROGRESS", "These ideas are still being written. Wait a moment.");
      }
    }
    if (!limits.enabled) throw new AdminError("failed-precondition", "AI_DISABLED", "AI event ideas are turned off for this company.");
    const attempt = (typeof requestDoc?.attempts === "number" ? requestDoc.attempts : 0) + 1;
    // A run that died without settling (its reservation expired) is refunded before the retry is charged.
    if (requestDoc?.status === "pending") refundCredits(ledger, creditKey(caller.uid, requestId, attempt - 1));
    const charge = creditKey(caller.uid, requestId, attempt);
    // Credits are charged once the request passed validation, authorization and the switches; a run that produces no drafts is refunded on settle.
    if (chargeCredits(ledger, charge, CREDIT_COSTS.generateDrafts) === "insufficient") throw creditsExhausted(ledger);
    checkReservation(monthState, dayState, caller.uid, limits, worst, now);
    const platformState = readPlatform(platformDoc ?? null, now);
    checkPlatform(platformState, deps.settings.platformMonthlyBudgetMicros, worst);
    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    monthState.pending[key] = { uid: caller.uid, micros: worst, expiresAt };
    platformState.pending[`${companyId}_${key}`] = { uid: caller.uid, micros: worst, expiresAt };
    put(tx, aiPaths.month(companyId, month), monthDoc ?? null, monthDocument(monthState));
    put(tx, aiPaths.platform(month), platformDoc ?? null, platformDocument(platformState));
    // Every reservation counts toward the per-admin attempt cap, whatever the run's outcome.
    put(tx, aiPaths.day(companyId, day, caller.uid), dayDoc ?? null, {
      generations: dayState.generations, flags: dayState.flags, attempts: dayState.attempts + 1, expireAt: new Date(now.getTime() + DAY_RETENTION_MS),
    });
    put(tx, creditsPath, creditsDoc, ledgerDocument(ledger));
    put(tx, aiPaths.request(companyId, caller.uid, requestId), requestDoc ?? null, {
      uid: caller.uid, hash, status: "pending", attempts: attempt, month, day, updatedAt: now, expireAt: new Date(now.getTime() + REQUEST_RETENTION_MS),
    });
    return { reservation: { actor, limits, attempt, month, day, credits: { path: creditsPath, key: charge, base } } };
  });
  if ("replay" in reserved) {
    deps.log?.("ai.generate", { companyId, requestId, outcome: "replay" });
    return reserved.replay;
  }

  const { reservation } = reserved;
  let result: RunResult;
  let unexpected: unknown = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.deadlineMs ?? RUN_DEADLINE_MS);
  const meter = createMeter(deps, controller.signal);
  try {
    result = await run(deps, request, catalog, meter, controller.signal);
  } catch (error) {
    unexpected = error;
    // Settle with whatever was really spent before the failure.
    result = { status: "failed", reason: "AI_UNAVAILABLE", detail: "unexpected", extra: [], ...meter.snapshot() };
  } finally {
    clearTimeout(timer);
  }

  const settled = await settleWithRetry(deps, caller.uid, request, reservation, result, worst);
  deps.log?.("ai.generate", {
    companyId, requestId, outcome: result.status, detail: result.status === "done" ? null : result.detail, models: result.models.join(","),
    calls: result.calls, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMicros: result.spentMicros,
    credits: result.status === "done" ? CREDIT_COSTS.generateDrafts : 0, decisionProviders: result.providers.join(","),
  });
  if (unexpected) throw unexpected;
  if (result.status === "done") return { contractVersion: 1, drafts: result.drafts, usage: settled.usage, credits: settled.credits, replay: false };
  throw failure(result.reason);
}

/** Moderation category names are provider constants; keep plain tokens only so no free text can reach the audit log. */
const categoryNames = (categories: readonly string[]) => categories.filter(name => /^[A-Za-z0-9/_-]{1,40}$/.test(name)).slice(0, 12);

async function run(
  deps: AiDeps, request: ParsedGenerateRequest, catalog: readonly CatalogTag[], meter: Metering, signal: AbortSignal,
): Promise<RunResult> {
  const { record, snapshot } = meter;
  const stop = (status: "flagged" | "failed", reason: AdminErrorReason, detail: string, extra: AuditChange[] = []): RunResult =>
    ({ status, reason, detail, extra, ...snapshot() });

  try {
    if (request.prompt !== "") {
      // Free provider moderation first, then the typed triage questions. A thrown error fails closed (AI_UNAVAILABLE).
      const [moderation] = await deps.llm.moderate([request.prompt], signal);
      if (!moderation) return stop("failed", "AI_UNAVAILABLE", "moderation_missing");
      if (moderation.flagged) {
        return stop("flagged", "AI_PROMPT_REJECTED", "moderation", [change("flaggedCategories", null, categoryNames(moderation.categories).join(","))]);
      }
      const triage = await meter.guard("triage", () => deps.decisions.decide({ step: "triage", state: triageState(request.prompt), questions: TRIAGE_QUESTIONS, signal }));
      record(triage.model, triage.usage, triage.provider);
      const reasons = triageVerdict(triage);
      if (reasons.length > 0) return stop("flagged", "AI_PROMPT_REJECTED", "triage", [change("triageReasons", null, reasons.join(","))]);
    }

    const now = deps.now();
    const [stats, theme] = await Promise.all([
      bestEffort(deps, "interests", () => deps.interests.countsFor(request.companyId), null),
      bestEffort(deps, "theme", () => deps.themes.current(request.companyId, now), null),
    ]);
    const interests = summarizeInterests(stats, catalog);
    const catalogIds = catalog.map(tag => tag.id);
    const input = buildGenerateUserContent({
      choices: request.choices, count: request.count, note: request.prompt, catalog, topInterests: interests.top,
      thinTagIds: interests.thinTagIds.slice(0, THIN_IN_PROMPT), theme, now,
    });
    const schema = modelDraftsSchema(catalogIds, { count: request.count, choices: request.choices });
    const context = { count: request.count, choices: request.choices, catalogIds: new Set(catalogIds), catalogNames: new Map(catalog.map(tag => [tag.id, tag.name])) };
    const focusTags = catalog.filter(tag => request.choices.focusTagIds.includes(tag.id));
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const outcome = await meter.guard("generate", () => deps.llm.generate({
        step: "generate", instructions: GENERATE_SYSTEM_PROMPT, input, schema, schemaName: "event_drafts",
        maxOutputTokens: outputCeiling("generate", deps.settings.models.generate), signal,
      }));
      record(outcome.model, outcome.usage);
      if (outcome.kind === "refusal") {
        return request.prompt !== "" ? stop("flagged", "AI_PROMPT_REJECTED", "generate_refusal") : stop("failed", "AI_OUTPUT_INVALID", "generate_refusal");
      }
      if (outcome.kind !== "ok") continue;
      try {
        const parsed = parseModelDrafts(outcome.value, context);
        const reviewed = await review(deps, request, parsed, focusTags, meter, signal);
        if (reviewed.length > 0) return { status: "done", drafts: reviewed, extra: [], ...snapshot() };
      } catch (error) {
        if (!(error instanceof InvalidModelOutput)) throw error;
      }
    }
    return stop("failed", "AI_OUTPUT_INVALID", "invalid_output");
  } catch (error) {
    if (error instanceof LlmUnavailableError) return stop("failed", "AI_UNAVAILABLE", `provider_${error.status ?? "network"}`);
    throw error;
  }
}

/**
 * Output gates after parsing: free moderation of every draft's text, then one typed check per remaining draft (cover
 * art, fit, safety). A failed check keeps the draft because moderation and the validators already gate it; an unsafe
 * answer drops it; drafts are ordered by fit, best first. An empty result counts as invalid output.
 */
async function review(
  deps: AiDeps, request: ParsedGenerateRequest, drafts: GeneratedEventDraft[], focusTags: readonly CatalogTag[], meter: Metering, signal: AbortSignal,
): Promise<GeneratedEventDraft[]> {
  const verdicts = await deps.llm.moderate(drafts.map(draft => `${draft.title}\n${draft.description}\n${draft.rationale}`), signal);
  const clean = drafts.filter((_, i) => verdicts[i] !== undefined && !verdicts[i]!.flagged);
  if (clean.length === 0) return [];
  const questions = draftCheckQuestions(request.choices, focusTags);
  const checked = await Promise.all(clean.map(async draft => {
    try {
      const result = await meter.guard("draftCheck", () => deps.decisions.decide({ step: "draftCheck", state: draftState(draft), questions, signal }));
      meter.record(result.model, result.usage, result.provider);
      return { draft, check: interpretDraftCheck(result.answers) };
    } catch {
      return { draft, check: interpretDraftCheck(null) };
    }
  }));
  return checked
    .filter(item => !item.check.unsafe)
    .map(({ draft, check }) => ({
      draft: check.cover ? { ...draft, coverImageURL: `catalog://default/${check.cover}` } : draft,
      fit: check.fit ?? -1,
    }))
    .sort((a, b) => b.fit - a.fit)
    .map(item => item.draft);
}

/** Context reads (interest counts, theme) only enrich the prompt: a missing index or a transient failure must not kill a paid run. */
export async function bestEffort<T>(deps: Pick<AiDeps, "log">, source: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    deps.log?.("ai.context_unavailable", { source, error: error instanceof Error ? error.name : "unknown" }, "warn");
    return fallback;
  }
}

/** Settling is what releases the reservation and records the spend, so a transient failure is retried before it is reported. */
async function settleWithRetry(
  deps: AiDeps, uid: string, request: ParsedGenerateRequest, reservation: Reservation, result: RunResult, worst: number,
) {
  const sleep = deps.sleep ?? wait;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await settle(deps, uid, request, reservation, result, worst);
    } catch (error) {
      if (attempt >= SETTLE_ATTEMPTS) {
        // Alertable; ids only, never prompt text. The reservation expires on its own, but this run's spend is unrecorded.
        deps.log?.("ai.settle_failed", {
          companyId: request.companyId, requestId: request.requestId, outcome: result.status, costMicros: result.spentMicros,
          error: error instanceof Error ? error.name : "unknown",
        }, "error");
        throw error;
      }
      await sleep(SETTLE_BACKOFF_MS * 4 ** (attempt - 1));
    }
  }
}

async function settle(deps: AiDeps, uid: string, request: ParsedGenerateRequest, reservation: Reservation, result: RunResult, worst: number) {
  const { companyId, requestId } = request;
  const key = `${uid}_${requestId}`;
  return deps.store.runTransaction(async tx => {
    const now = deps.now();
    const monthPath = aiPaths.month(companyId, reservation.month);
    const dayPath = aiPaths.day(companyId, reservation.day, uid);
    const requestPath = aiPaths.request(companyId, uid, requestId);
    const [monthDoc, dayDoc, requestDoc, creditsDoc] = await tx.getMany([monthPath, dayPath, requestPath, reservation.credits.path]);
    const month = readMonth(monthDoc ?? null, now);
    const day = readDay(dayDoc ?? null);
    const ledger = ledgerFromDoc(reservation.credits.base, creditsDoc ?? null);
    // A retry after a commit whose acknowledgement was lost must not count the run twice.
    if (requestDoc && requestDoc.status !== "pending" && requestDoc.attempts === reservation.attempt) {
      return { usage: usageSummary(month, day, uid, reservation.limits, worst, now), credits: creditsSummary(ledger) };
    }
    // No drafts produced (declined note, provider failure, invalid output): the charge is given back.
    if (result.status !== "done") refundCredits(ledger, reservation.credits.key);
    const platformPath = aiPaths.platform(reservation.month);
    const platformDoc = await tx.get(platformPath);
    const platform = readPlatform(platformDoc ?? null, now);
    delete platform.pending[`${companyId}_${key}`];
    platform.spentMicros += result.spentMicros;
    delete month.pending[key];
    addSpend(month, reservation.day.slice(-2), { spentMicros: result.spentMicros, inputTokens: result.tokensIn, outputTokens: result.tokensOut });
    if (result.status === "done") {
      month.generations += 1;
      day.generations += 1;
    } else if (result.status === "flagged") {
      day.flags += 1;
    }
    put(tx, monthPath, monthDoc ?? null, monthDocument(month));
    put(tx, platformPath, platformDoc ?? null, platformDocument(platform));
    put(tx, dayPath, dayDoc ?? null, { generations: day.generations, flags: day.flags, attempts: day.attempts, expireAt: new Date(now.getTime() + DAY_RETENTION_MS) });
    // Which models and decision providers (jev, openai or heuristic) answered, for observability; never content.
    const observed = { models: result.models, decisionProviders: result.providers };
    if (creditsDoc) tx.update(reservation.credits.path, ledgerDocument(ledger));
    put(tx, requestPath, requestDoc ?? null, result.status === "done"
      ? { status: "done", response: { drafts: result.drafts }, ...observed, updatedAt: now }
      : { status: "failed", reason: result.reason, ...observed, updatedAt: now });
    writeAudit(tx, reservation.actor, {
      id: `ai_${uid}_${requestId}_${reservation.attempt}`,
      action: result.status === "done" ? "ai.generateDrafts" : result.status === "flagged" ? "ai.noteDeclined" : "ai.generateFailed",
      targetType: "company",
      targetId: companyId,
      summary: result.status === "done" ? `Generated ${result.drafts.length} AI event draft${result.drafts.length === 1 ? "" : "s"}`
        : result.status === "flagged" ? "AI note declined by the safety check" : "AI event drafts failed",
      changes: [
        change("models", null, result.models.join(",")),
        change("tokens", null, `${result.tokensIn} in, ${result.tokensOut} out`),
        // Admins can read the audit log: credits only, never money. Cost stays in the server log.
        change("credits", null, String(result.status === "done" ? CREDIT_COSTS.generateDrafts : 0)),
        ...result.extra,
      ],
      requestId,
    });
    return { usage: usageSummary(month, day, uid, reservation.limits, worst, now), credits: creditsSummary(ledger) };
  });
}

const creditKey = (uid: string, requestId: string, attempt: number) => `gen_${uid}_${requestId}_${attempt}`;

/** Creates or merges a server-owned document inside the transaction (the adapter has create and update only). */
function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data);
  else tx.create(path, data);
}

function storedDrafts(requestDoc: Doc): GeneratedEventDraft[] {
  const response = requestDoc.response as { drafts?: unknown } | undefined;
  if (!response || !Array.isArray(response.drafts) || response.drafts.length === 0) {
    throw new AdminError("internal", "INVALID_STORED_DATA", "Invalid stored AI drafts.");
  }
  return response.drafts as GeneratedEventDraft[];
}

function failure(reason: AdminErrorReason): AdminError {
  switch (reason) {
    case "AI_PROMPT_REJECTED":
      return new AdminError("invalid-argument", "AI_PROMPT_REJECTED", "We couldn't use that note. Describe the kind of event you want and try again.", ["prompt"]);
    case "AI_OUTPUT_INVALID":
      return new AdminError("unavailable", "AI_OUTPUT_INVALID", "The ideas didn't come out right. Try again or change your choices.");
    default:
      return new AdminError("unavailable", "AI_UNAVAILABLE", "The AI service is busy. Try again in a minute.");
  }
}
