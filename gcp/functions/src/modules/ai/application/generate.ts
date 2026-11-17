import type { GeneratedEventDraft, GenerateEventDraftsResponse } from "../../../generated/models";
import { authorize, requireCaller, writeAudit, type Actor } from "../../admin/application/context";
import type { AdminTransaction, Doc } from "../../admin/application/ports";
import { change } from "../../admin/domain/audit";
import { AdminError, type AdminErrorReason } from "../../admin/domain/errors";
import { payloadHash } from "../../admin/domain/reader";
import { InvalidModelOutput, parseModelDrafts } from "../domain/drafts";
import { summarizeInterests } from "../domain/interests";
import { aiPaths, dayKey, monthKey } from "../domain/paths";
import { costMicros, GENERATE_MAX_TOKENS, SCREEN_MAX_TOKENS, worstCaseMicros } from "../domain/pricing";
import {
  buildGenerateUserContent, buildScreenUserContent, GENERATE_SYSTEM_PROMPT, generateOutputSchema, SCREEN_OUTPUT_SCHEMA, SCREEN_SYSTEM_PROMPT,
} from "../domain/prompt";
import {
  checkReservation, effectiveLimits, monthDocument, readDay, readMonth, RESERVATION_TTL_MS, usageSummary, type Limits,
} from "../domain/quota";
import { parseGenerateRequest, type ParsedGenerateRequest } from "../domain/request";
import { LlmUnavailableError, type AiDeps, type Caller, type CatalogTag, type LlmOutcome } from "./ports";

const REQUEST_RETENTION_MS = 24 * 3_600_000;
const DAY_RETENTION_MS = 8 * 86_400_000;
/** Thin interests named in the prompt (names only, never counts). */
const THIN_IN_PROMPT = 8;

/** What one model run produced; spend is always metered, whatever the outcome. */
type RunResult =
  | { status: "done"; drafts: GeneratedEventDraft[]; spentMicros: number; tokensIn: number; tokensOut: number; model: string; calls: number }
  | { status: "flagged" | "failed"; reason: AdminErrorReason; detail: string; spentMicros: number; tokensIn: number; tokensOut: number; model: string; calls: number };

interface Reservation {
  actor: Actor; limits: Limits; attempt: number; month: string; day: string;
}

/**
 * generateEventDraftsV1 (docs/design/stretch/ai-event-creation.md). Three steps so the slow model call never holds a
 * transaction open:
 * 1. Reserve (transaction): authorize `ai.generate`, honor the kill switches, replay a finished requestId, refuse a
 *    concurrent duplicate, check the per-admin daily, company monthly and budget caps, and reserve the worst-case cost.
 *    Concurrent calls serialize on the month document, so parallel requests cannot pass a cap.
 * 2. Run (no transaction): screen the admin's note with the cheap model, then draft with structured output; invalid
 *    output is retried once. Nothing is written to events.
 * 3. Settle (transaction): release the reservation, add the actual cost, count the generation only on success (a
 *    declined note counts toward the daily flag limit instead), store the result for replay and write a content-free
 *    audit entry. Expired reservations (a crashed run) are dropped on the next read, so the caps heal themselves.
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
    const [settingsDoc, monthDoc, dayDoc, requestDoc] = await tx.getMany([
      aiPaths.settings(companyId), aiPaths.month(companyId, month), aiPaths.day(companyId, day, caller.uid), aiPaths.request(companyId, caller.uid, requestId),
    ]);
    const limits = effectiveLimits(deps.settings, settingsDoc ?? null);
    const monthState = readMonth(monthDoc ?? null, now);
    const dayState = readDay(dayDoc ?? null);
    if (requestDoc) {
      if (requestDoc.hash !== hash) {
        throw new AdminError("failed-precondition", "REQUEST_REUSED", "This request ID was already used with different details.", ["requestId"]);
      }
      if (requestDoc.status === "done") {
        return { replay: { contractVersion: 1, drafts: storedDrafts(requestDoc), usage: usageSummary(monthState, dayState, caller.uid, limits, worst), replay: true } };
      }
      if (requestDoc.status === "pending" && key in monthState.pending) {
        throw new AdminError("aborted", "REQUEST_IN_PROGRESS", "These ideas are still being written. Wait a moment.");
      }
    }
    if (!limits.enabled) throw new AdminError("failed-precondition", "AI_DISABLED", "AI event ideas are turned off for this company.");
    checkReservation(monthState, dayState, caller.uid, limits, worst);
    monthState.pending[key] = { uid: caller.uid, micros: worst, expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS) };
    put(tx, aiPaths.month(companyId, month), monthDoc ?? null, monthDocument(monthState));
    const attempt = (typeof requestDoc?.attempts === "number" ? requestDoc.attempts : 0) + 1;
    put(tx, aiPaths.request(companyId, caller.uid, requestId), requestDoc ?? null, {
      uid: caller.uid, hash, status: "pending", attempts: attempt, month, day, updatedAt: now, expireAt: new Date(now.getTime() + REQUEST_RETENTION_MS),
    });
    return { reservation: { actor, limits, attempt, month, day } };
  });
  if ("replay" in reserved) {
    deps.log?.("ai.generate", { companyId, requestId, outcome: "replay" });
    return reserved.replay;
  }

  const { reservation } = reserved;
  let result: RunResult;
  let unexpected: unknown = null;
  try {
    result = await run(deps, request, catalog);
  } catch (error) {
    unexpected = error;
    result = { status: "failed", reason: "AI_UNAVAILABLE", detail: "unexpected", spentMicros: 0, tokensIn: 0, tokensOut: 0, model: deps.settings.generateModel, calls: 0 };
  }

  const usage = await settle(deps, caller.uid, request, reservation, result, worst);
  deps.log?.("ai.generate", {
    companyId, requestId, outcome: result.status, detail: result.status === "done" ? null : result.detail, model: result.model,
    calls: result.calls, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMicros: result.spentMicros,
  });
  if (unexpected) throw unexpected;
  if (result.status === "done") return { contractVersion: 1, drafts: result.drafts, usage, replay: false };
  throw failure(result.reason);
}

async function run(deps: AiDeps, request: ParsedGenerateRequest, catalog: readonly CatalogTag[]): Promise<RunResult> {
  const meter = { spentMicros: 0, tokensIn: 0, tokensOut: 0, model: deps.settings.generateModel, calls: 0 };
  const record = (outcome: LlmOutcome) => {
    meter.calls += 1;
    meter.spentMicros += costMicros(outcome.model, outcome.usage);
    meter.tokensIn += outcome.usage.inputTokens + outcome.usage.cacheReadTokens + outcome.usage.cacheWriteTokens;
    meter.tokensOut += outcome.usage.outputTokens;
  };
  const stop = (status: "flagged" | "failed", reason: AdminErrorReason, detail: string): RunResult => ({ status, reason, detail, ...meter });

  try {
    if (request.prompt !== "") {
      const screen = await deps.llm.complete({
        purpose: "screen", system: SCREEN_SYSTEM_PROMPT, user: buildScreenUserContent(request.prompt), schema: SCREEN_OUTPUT_SCHEMA, maxTokens: SCREEN_MAX_TOKENS,
      });
      record(screen);
      if (screen.kind === "refusal") return stop("flagged", "AI_PROMPT_REJECTED", "screen_refusal");
      // Fail closed: an unreadable verdict never lets the note through.
      if (screen.kind !== "ok") return stop("failed", "AI_UNAVAILABLE", `screen_${screen.kind}`);
      const verdict = (screen.json as { verdict?: unknown } | null)?.verdict;
      if (verdict !== "ok") return stop("flagged", "AI_PROMPT_REJECTED", `screen_${typeof verdict === "string" ? verdict.slice(0, 20) : "invalid"}`);
    }

    const now = deps.now();
    const [stats, theme] = await Promise.all([deps.interests.countsFor(request.companyId), deps.themes.current(request.companyId, now)]);
    const interests = summarizeInterests(stats, catalog);
    const catalogIds = catalog.map(tag => tag.id);
    const user = buildGenerateUserContent({
      choices: request.choices, count: request.count, note: request.prompt, catalog, topInterests: interests.top,
      thinTagIds: interests.thinTagIds.slice(0, THIN_IN_PROMPT), theme, now,
    });
    const schema = generateOutputSchema(catalogIds);
    const context = { count: request.count, choices: request.choices, catalogIds: new Set(catalogIds) };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const outcome = await deps.llm.complete({ purpose: "generate", system: GENERATE_SYSTEM_PROMPT, user, schema, maxTokens: GENERATE_MAX_TOKENS });
      record(outcome);
      meter.model = outcome.model;
      if (outcome.kind === "refusal") {
        return request.prompt !== "" ? stop("flagged", "AI_PROMPT_REJECTED", "generate_refusal") : stop("failed", "AI_OUTPUT_INVALID", "generate_refusal");
      }
      if (outcome.kind !== "ok") continue;
      try {
        return { status: "done", drafts: parseModelDrafts(outcome.json, context), ...meter };
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

async function settle(deps: AiDeps, uid: string, request: ParsedGenerateRequest, reservation: Reservation, result: RunResult, worst: number) {
  const { companyId, requestId } = request;
  const key = `${uid}_${requestId}`;
  return deps.store.runTransaction(async tx => {
    const now = deps.now();
    const monthPath = aiPaths.month(companyId, reservation.month);
    const dayPath = aiPaths.day(companyId, reservation.day, uid);
    const requestPath = aiPaths.request(companyId, uid, requestId);
    const [monthDoc, dayDoc, requestDoc] = await tx.getMany([monthPath, dayPath, requestPath]);
    const month = readMonth(monthDoc ?? null, now);
    const day = readDay(dayDoc ?? null);
    delete month.pending[key];
    month.spentMicros += result.spentMicros;
    if (result.status === "done") {
      month.generations += 1;
      day.generations += 1;
    } else if (result.status === "flagged") {
      day.flags += 1;
    }
    put(tx, monthPath, monthDoc ?? null, monthDocument(month));
    put(tx, dayPath, dayDoc ?? null, { generations: day.generations, flags: day.flags, expireAt: new Date(now.getTime() + DAY_RETENTION_MS) });
    put(tx, requestPath, requestDoc ?? null, result.status === "done"
      ? { status: "done", response: { drafts: result.drafts }, updatedAt: now }
      : { status: "failed", reason: result.reason, updatedAt: now });
    writeAudit(tx, reservation.actor, {
      id: `ai_${uid}_${requestId}_${reservation.attempt}`,
      action: result.status === "done" ? "ai.generateDrafts" : result.status === "flagged" ? "ai.noteDeclined" : "ai.generateFailed",
      targetType: "company",
      targetId: companyId,
      summary: result.status === "done" ? `Generated ${result.drafts.length} AI event draft${result.drafts.length === 1 ? "" : "s"}`
        : result.status === "flagged" ? "AI note declined by the safety check" : "AI event drafts failed",
      changes: [
        change("model", null, result.model),
        change("tokens", null, `${result.tokensIn} in, ${result.tokensOut} out`),
        change("costUsd", null, (result.spentMicros / 1_000_000).toFixed(4)),
      ],
      requestId,
    });
    return usageSummary(month, day, uid, reservation.limits, worst);
  });
}

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
