import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DipbotIdea, GetDipbotIdeasResponse } from "../../../generated/models";
import { authorize, requireCaller, writeAudit, type Actor } from "../../admin/application/context";
import type { AdminTransaction, Doc } from "../../admin/application/ports";
import { change } from "../../admin/domain/audit";
import { AdminError, invalid } from "../../admin/domain/errors";
import { gatherSignals } from "../../suggestions/application/buildDigest";
import type { SuggestionsStore } from "../../suggestions/application/ports";
import { weekKey as weekKeyOf } from "../../suggestions/domain/signals";
import { chargeCredits, CREDIT_COSTS, creditsExhausted, creditsRemaining, creditsSummary, ledgerDocument, refundCredits, type CreditLedger } from "../domain/credits";
import {
  autoRefreshDue, DEFAULT_IDEAS_MANUAL_PER_DAY, DEFAULT_IDEAS_MAX_AGE_HOURS, HOUR_MS, IDEAS_LEASE_MS, ideasStatus, localDayKey, manualCountOn,
  readIdeasCache, readIdeasMeta, type IdeasMeta, type IdeasProvider, type StoredIdeas,
} from "../domain/ideaCache";
import { ideaFingerprint, ideaSnapshot } from "../domain/ideaTools";
import type { IdeaSnapshot } from "../domain/ideaTypes";
import { applyRanking, buildIdeas, fallbackIdeas, rankingRequest } from "../domain/ideaValidate";
import { aiPaths, dayKey, monthKey } from "../domain/paths";
import { costMicros, ideasWorstCaseMicros } from "../domain/pricing";
import { addSpend, checkPlatform, dayOfMonth, effectiveLimits, monthDocument, platformDocument, readMonth, readPlatform } from "../domain/quota";
import { activeLease } from "../domain/suggestionCache";
import { loadLedger } from "./credits";
import { runIdeaAgent, type IdeaAgentResult } from "./ideaAgent";
import type { AgentModelPort, AiDeps, Caller, DecisionAnswer, IdeasSettings } from "./ports";
import { suggestionWorstMicros, type SuggestionProvider } from "./suggestions";

/**
 * getDipbotIdeasV1 (docs/design/stretch/dipbot-daily-ideas.md). Admin only (`ai.generate`).
 *
 * `load` (every visit) returns the stored ideas or the free catalog fallback and never calls a model; it only reports
 * whether an automatic refresh is due. `auto` is started once by the portal when it is due: under a 90 second lease it
 * extends the stored ideas for free when the inputs are unchanged, else runs the model once per local day. `refresh` is
 * the button: idempotent per requestId, limited per local day, and it needs the credits. A run reserves 3 credits in
 * the lease transaction and refunds them exactly once when no model idea survives validation.
 */

export interface IdeasDeps extends AiDeps {
  /** The tool-using model; null when none is configured (nothing then runs and the fallback shows). */
  agent: AgentModelPort | null;
  /** Company signals (shared with the weekly email). */
  signals: SuggestionsStore;
  /** Ranking decision providers, tried in order (Jev, then the OpenAI mini model); empty ranks by the prior only. */
  rankers: readonly SuggestionProvider[];
  /** Where ideas came from, stored with them (default "openai"; the emulator uses "demo"). */
  provider?: IdeasProvider;
  /** Agent deadline override for tests. */
  agentDeadlineMs?: number;
}

const DEFAULT_SETTINGS: IdeasSettings = { enabled: true, maxAgeHours: DEFAULT_IDEAS_MAX_AGE_HOURS, manualPerDay: DEFAULT_IDEAS_MANUAL_PER_DAY, model: "gpt-4o-mini" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  mode: z.enum(["load", "auto", "refresh"]),
  requestId: z.string().regex(UUID).optional(),
});

type Answer = GetDipbotIdeasResponse;
type Outcome = NonNullable<Answer["outcome"]>;

function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data);
  else tx.create(path, data);
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function getDipbotIdeas(deps: IdeasDeps, rawCaller: Caller | null, data: unknown): Promise<GetDipbotIdeasResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = RequestSchema.safeParse(data);
  if (!parsed.success) throw invalid([...new Set(parsed.error.issues.map(i => String(i.path[0] ?? "request")))]);
  const { companyId, mode } = parsed.data;
  const requestId = parsed.data.requestId?.toLowerCase();
  if (mode === "refresh" && !requestId) throw invalid(["requestId"]);
  await deps.limiter?.consume(caller.uid);

  const cfg = deps.settings.ideas ?? DEFAULT_SETTINGS;
  const maxAgeMs = cfg.maxAgeHours * HOUR_MS;
  const cachePath = aiPaths.ideasCache(companyId);
  const worst = ideasWorstCaseMicros(cfg.model) + suggestionWorstMicros(deps.rankers);

  const start = await deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, caller, companyId, "ai.generate");
    const now = deps.now();
    const [settingsDoc, monthDoc, cacheDoc, platformDoc] = await tx.getMany([
      aiPaths.settings(companyId), aiPaths.month(companyId, monthKey(now)), cachePath, aiPaths.platform(monthKey(now)),
    ]);
    const limits = effectiveLimits(deps.settings, settingsDoc ?? null);
    const { ledger } = await loadLedger(tx, companyId, settingsDoc ?? null, now);
    const month = readMonth(monthDoc ?? null, now);
    const pending = Object.values(month.pending).reduce((sum, r) => sum + r.micros, 0);
    const monthLeft = limits.monthlyBudgetMicros - month.spentMicros - pending;
    const dayLeft = limits.dailyBudgetMicros - (month.days[dayOfMonth(now)]?.spentMicros ?? 0) - pending;
    let platformOk = true;
    try {
      checkPlatform(readPlatform(platformDoc ?? null, now), deps.settings.platformMonthlyBudgetMicros, worst);
    } catch {
      platformOk = false;
    }
    return {
      actor, cacheDoc: cacheDoc ?? null, ledger, credits: creditsSummary(ledger),
      enabled: cfg.enabled && limits.enabled && settingsDoc?.ideasEnabled !== false,
      creditsOk: creditsRemaining(ledger) >= CREDIT_COSTS.ideas,
      budgetOk: monthLeft >= worst && dayLeft >= worst && platformOk,
    };
  });

  const base = { contractVersion: 1 as const, credits: start.credits, creditsCharged: 0 };
  if (!start.enabled) {
    return { ...base, enabled: false, ideas: [], status: "fallback", dataLevel: "none", autoRefreshDue: false, refreshesLeftToday: 0 };
  }

  const now = deps.now();
  const timeZone = (await deps.signals.companyContext(companyId)).timeZone ?? "UTC";
  const existing = readIdeasCache(start.cacheDoc);
  const meta = readIdeasMeta(start.cacheDoc);
  const modelReady = deps.agent !== null;
  const timeDue = autoRefreshDue({ cache: existing, meta, now, maxAgeMs, timeZone });

  // A plain visit with stored ideas reads nothing else: no company events, no model.
  if (mode === "load" && existing) {
    const due = timeDue && start.creditsOk && start.budgetOk && modelReady;
    deps.log?.("ai.ideas", { companyId, mode, outcome: "loaded", status: ideasStatus(existing, now, maxAgeMs), autoRefreshDue: due, creditsCharged: 0 });
    return {
      ...base, enabled: true, ideas: existing.ideas, status: ideasStatus(existing, now, maxAgeMs), generatedAt: existing.generatedAt.toISOString(),
      dataLevel: existing.dataLevel, autoRefreshDue: due, refreshesLeftToday: Math.max(0, cfg.manualPerDay - manualCountOn(meta, localDayKey(now, timeZone))),
    };
  }

  const signals = await gatherSignals({ store: deps.signals, interests: deps.interests, catalog: deps.catalog }, companyId, now, timeZone, weekKeyOf(now, timeZone));
  const snapshot = ideaSnapshot(signals, await deps.catalog.list());
  const fingerprint = ideaFingerprint(snapshot);
  const day = localDayKey(now, timeZone);

  /** The response for the given stored state: stored ideas (fresh or stale) or the free catalog fallback. */
  const view = (
    cache: StoredIdeas | null, at: Date, m: IdeasMeta, extra: { credits?: Answer["credits"]; charged?: number; outcome?: Outcome; due?: boolean; status?: Answer["status"] } = {},
  ): Answer => ({
    contractVersion: 1,
    enabled: true,
    ideas: cache ? cache.ideas : fallbackIdeas(snapshot, at),
    status: extra.status ?? (cache ? ideasStatus(cache, at, maxAgeMs) : "fallback"),
    ...(cache ? { generatedAt: cache.generatedAt.toISOString() } : {}),
    dataLevel: cache ? cache.dataLevel : snapshot.summary.dataLevel,
    autoRefreshDue: extra.due ?? false,
    refreshesLeftToday: Math.max(0, cfg.manualPerDay - manualCountOn(m, localDayKey(at, timeZone))),
    ...(extra.outcome ? { outcome: extra.outcome } : {}),
    credits: extra.credits ?? start.credits,
    creditsCharged: extra.charged ?? 0,
  });
  const log = (fields: Record<string, string | number | boolean | null>) => deps.log?.("ai.ideas", { companyId, mode, ...fields });

  if (mode === "load") {
    const due = timeDue && start.creditsOk && start.budgetOk && modelReady;
    log({ outcome: "loaded", status: existing ? ideasStatus(existing, now, maxAgeMs) : "fallback", autoRefreshDue: due, creditsCharged: 0 });
    return view(existing, now, meta, { due });
  }

  if (mode === "refresh") {
    // A replay returns what the first request produced and never charges again.
    if (existing && requestId !== undefined && existing.requestId === requestId) {
      log({ outcome: "unchanged", creditsCharged: 0 });
      return view(existing, now, meta, { outcome: "unchanged" });
    }
    if (manualCountOn(meta, day) >= cfg.manualPerDay) throw refreshLimit();
    if (!start.creditsOk) throw creditsExhausted(start.ledger);
  } else if (!timeDue || !start.creditsOk || !modelReady) {
    // Not due, or not affordable: never an error for the background call.
    log({ outcome: "skipped", detail: !timeDue ? "not_due" : !start.creditsOk ? "credits" : "no_model", creditsCharged: 0 });
    return view(existing, now, meta, { outcome: "skipped" });
  }
  if (!start.budgetOk || !modelReady) {
    log({ outcome: "skipped", detail: !start.budgetOk ? "budget" : "no_model", creditsCharged: 0 });
    return view(existing, now, meta, { outcome: "skipped" });
  }

  // Claim the lease, re-checking the rules inside the transaction, and reserve the credits in the same step.
  const token = randomUUID();
  const chargeKey = mode === "refresh" ? `ideas_${requestId}` : `ideas_auto_${day}`;
  const claim = await deps.store.runTransaction(async tx => {
    const at = deps.now();
    const atDay = localDayKey(at, timeZone);
    const [docRaw, settingsDoc] = await tx.getMany([cachePath, aiPaths.settings(companyId)]);
    const doc = docRaw ?? null;
    const loaded = await loadLedger(tx, companyId, settingsDoc ?? null, at);
    const cache = readIdeasCache(doc);
    const state = readIdeasMeta(doc);
    if (activeLease(doc, at)) return { kind: "busy" as const, cache, state, at, ledger: loaded.ledger };
    if (mode === "refresh") {
      if (cache && cache.requestId === requestId) return { kind: "replay" as const, cache, state, at, ledger: loaded.ledger };
      if (manualCountOn(state, atDay) >= cfg.manualPerDay) return { kind: "limit" as const, cache, state, at, ledger: loaded.ledger };
    } else {
      if (!autoRefreshDue({ cache, meta: state, now: at, maxAgeMs, timeZone })) return { kind: "skipped" as const, cache, state, at, ledger: loaded.ledger };
      if (cache && cache.fingerprint === fingerprint) {
        put(tx, cachePath, doc, { checkedAt: at });
        return { kind: "extended" as const, cache: { ...cache, checkedAt: at }, state, at, ledger: loaded.ledger };
      }
    }
    const charge = chargeCredits(loaded.ledger, chargeKey, CREDIT_COSTS.ideas);
    if (charge === "insufficient") return { kind: "exhausted" as const, cache, state, at, ledger: loaded.ledger };
    // The key was already paid for by an earlier press (later overwritten): never run or refund it twice.
    if (charge === "duplicate") return { kind: "replay" as const, cache, state, at, ledger: loaded.ledger };
    if (charge === "charged") put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
    const manual = mode === "refresh" ? { manualRefreshes: { day: atDay, count: manualCountOn(state, atDay) + 1 } } : { autoRunDay: atDay };
    put(tx, cachePath, doc, { ...manual, leaseHolder: token, leaseUntil: new Date(at.getTime() + IDEAS_LEASE_MS) });
    const after = readIdeasMeta({ ...(doc ?? {}), ...manual });
    return { kind: "claimed" as const, cache, state: after, at, ledger: loaded.ledger };
  });

  const credits = creditsSummary(claim.ledger);
  if (claim.kind === "replay") return view(claim.cache, claim.at, claim.state, { outcome: "unchanged", credits });
  if (claim.kind === "limit") throw refreshLimit();
  if (claim.kind === "exhausted") {
    if (mode === "refresh") throw creditsExhausted(claim.ledger);
    return view(claim.cache, claim.at, claim.state, { outcome: "skipped", credits });
  }
  if (claim.kind === "busy" || claim.kind === "skipped") {
    log({ outcome: "skipped", detail: claim.kind === "busy" ? "busy" : "not_due", creditsCharged: 0 });
    return view(claim.cache, claim.at, claim.state, { outcome: "skipped", credits });
  }
  if (claim.kind === "extended") {
    log({ outcome: "extended", creditsCharged: 0 });
    return view(claim.cache, claim.at, claim.state, { outcome: "extended", credits, status: "fresh" });
  }

  // We hold the lease and the reservation. Whatever happens next, settle once: spend, refund or keep, release.
  const run = await produce(deps, snapshot, cfg.model);
  const answered = run.ideas !== null;
  const spent = { micros: run.micros, tokensIn: run.tokensIn, tokensOut: run.tokensOut };
  const charged = answered ? CREDIT_COSTS.ideas : 0;
  const toolNames = run.agent.traces.map(t => t.name);
  let settled: { ledger: CreditLedger; at: Date } = { ledger: claim.ledger, at: claim.at };
  try {
    settled = await deps.store.runTransaction(async tx => {
      const at = deps.now();
      const monthPath = aiPaths.month(companyId, monthKey(at));
      const platformPath = aiPaths.platform(monthKey(at));
      const [monthDoc, docRaw, platformDoc, settingsDoc] = await tx.getMany([monthPath, cachePath, platformPath, aiPaths.settings(companyId)]);
      const doc = docRaw ?? null;
      const loaded = await loadLedger(tx, companyId, settingsDoc ?? null, at);
      if (spent.micros > 0 || spent.tokensIn > 0) {
        const month = readMonth(monthDoc ?? null, at);
        addSpend(month, dayKey(at).slice(-2), { spentMicros: spent.micros, inputTokens: spent.tokensIn, outputTokens: spent.tokensOut });
        put(tx, monthPath, monthDoc ?? null, monthDocument(month));
        // The platform ceiling counts every metered call; ideas are never counted as a generation.
        const platform = readPlatform(platformDoc ?? null, at);
        platform.spentMicros += spent.micros;
        put(tx, platformPath, platformDoc ?? null, platformDocument(platform));
      }
      if (!answered && refundCredits(loaded.ledger, chargeKey)) put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
      const release = { leaseHolder: "", leaseUntil: null };
      if (run.ideas) {
        put(tx, cachePath, doc, {
          ideas: plain(run.ideas), fingerprint, generatedAt: at, checkedAt: at, provider: deps.provider ?? "openai", model: run.agent.model || cfg.model,
          rankedBy: run.rankedBy, dataLevel: snapshot.summary.dataLevel, tools: toolNames, creditsCharged: charged, ...(requestId ? { requestId } : {}), ...release,
        });
      } else {
        put(tx, cachePath, doc, release);
      }
      auditRun(tx, start.actor, token, answered, run.agent, charged, requestId);
      return { ledger: loaded.ledger, at };
    });
  } catch (error) {
    await bestEffortRecover(deps, companyId, cachePath, token, chargeKey);
    throw error;
  }

  log({
    outcome: answered ? "updated" : "failed", detail: run.agent.outcome, tools: toolNames.length, toolNames: toolNames.join(","),
    provider: deps.provider ?? "openai", model: run.agent.model || null, rankedBy: answered ? run.rankedBy : null, turns: run.agent.turns,
    tokensIn: spent.tokensIn, tokensOut: spent.tokensOut, costMicros: spent.micros, ideas: run.ideas?.length ?? 0, creditsCharged: charged,
  });
  const after = creditsSummary(settled.ledger);
  const stateAfter = claim.state;
  if (run.ideas) {
    const stored: StoredIdeas = {
      ideas: run.ideas, fingerprint, provider: deps.provider ?? "openai", model: run.agent.model || cfg.model, tools: toolNames, creditsCharged: charged,
      rankedBy: run.rankedBy, dataLevel: snapshot.summary.dataLevel, generatedAt: settled.at, checkedAt: settled.at,
    };
    return view(stored, stored.generatedAt, stateAfter, { outcome: "updated", credits: after, charged, status: "computed" });
  }
  return view(claim.cache, claim.at, stateAfter, { outcome: "failed", credits: after });
}

const refreshLimit = () => new AdminError("resource-exhausted", "AI_IDEAS_REFRESH_LIMIT", "You have used today's idea refreshes. Try again tomorrow.");

interface Produced {
  /** Final ranked ideas when at least one model idea survived validation; null otherwise (the run is refunded). */
  ideas: DipbotIdea[] | null;
  rankedBy: "jev" | "openai" | "heuristic";
  agent: IdeaAgentResult;
  micros: number;
  tokensIn: number;
  tokensOut: number;
}

/** Runs the agent, validates and builds the ideas, ranks them. Never throws; every failure is an unanswered run. */
async function produce(deps: IdeasDeps, snapshot: IdeaSnapshot, model: string): Promise<Produced> {
  const empty: IdeaAgentResult = { modelIdeas: null, traces: [], usage: { tokensIn: 0, tokensOut: 0, cachedIn: 0, reasoning: 0 }, model: "", turns: 0, outcome: "unavailable" };
  let agent = empty;
  try {
    agent = await runIdeaAgent({ model: deps.agent!, ...(deps.agentDeadlineMs !== undefined ? { deadlineMs: deps.agentDeadlineMs } : {}) }, snapshot);
  } catch {
    // Treated as an unanswered run below.
  }
  const u = agent.usage;
  let micros = costMicros(agent.model || model, { inputTokens: u.tokensIn, cachedInputTokens: u.cachedIn, outputTokens: u.tokensOut, reasoningTokens: u.reasoning });
  let tokensIn = u.tokensIn;
  let tokensOut = u.tokensOut;
  if (agent.modelIdeas === null) return { ideas: null, rankedBy: "heuristic", agent, micros, tokensIn, tokensOut };

  try {
    const at = deps.now();
    const built = buildIdeas(snapshot, agent.modelIdeas, agent.traces, at);
    if (built.agentCount === 0) return { ideas: null, rankedBy: "heuristic", agent, micros, tokensIn, tokensOut };
    let rankedBy: Produced["rankedBy"] = "heuristic";
    let answers: Record<string, DecisionAnswer> | null = null;
    const request = rankingRequest(built.ideas, snapshot);
    for (const { port } of deps.rankers) {
      try {
        const result = await port.decide({ step: "draftCheck", state: request.state, questions: request.questions });
        micros += costMicros(result.model, result.usage);
        tokensIn += result.usage.inputTokens;
        tokensOut += result.usage.outputTokens;
        answers = result.answers;
        rankedBy = result.provider;
        break;
      } catch {
        // Provider unavailable: try the next one, then the prior only. Nothing billable is known.
      }
    }
    return { ideas: applyRanking(built.ideas, snapshot, answers), rankedBy, agent, micros, tokensIn, tokensOut };
  } catch {
    return { ideas: null, rankedBy: "heuristic", agent, micros, tokensIn, tokensOut };
  }
}

function auditRun(tx: AdminTransaction, actor: Actor, token: string, answered: boolean, agent: IdeaAgentResult, charged: number, requestId: string | undefined): void {
  writeAudit(tx, actor, {
    id: `ai_ideas_${token}`,
    action: answered ? "ai.ideasGenerated" : "ai.ideasFailed",
    targetType: "company",
    targetId: actor.companyId,
    summary: answered ? "Dipbot daily ideas updated" : "Dipbot daily ideas failed",
    // Tool names, model, tokens and credits only: never prompts, tool results or idea text, and never money.
    changes: [
      change("tools", null, agent.traces.map(t => t.name)),
      change("models", null, agent.model),
      change("tokens", null, `${agent.usage.tokensIn} in, ${agent.usage.tokensOut} out`),
      change("credits", null, String(charged)),
    ],
    requestId,
  });
}

/** After a failed settle: give the credits back and free the lease so the company is not locked out. Best effort. */
async function bestEffortRecover(deps: IdeasDeps, companyId: string, cachePath: string, token: string, chargeKey: string): Promise<void> {
  try {
    await deps.store.runTransaction(async tx => {
      const [doc, settingsDoc] = await tx.getMany([cachePath, aiPaths.settings(companyId)]);
      const loaded = await loadLedger(tx, companyId, settingsDoc ?? null, deps.now());
      if (refundCredits(loaded.ledger, chargeKey)) put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
      if (doc && doc.leaseHolder === token) tx.update(cachePath, { leaseHolder: "", leaseUntil: null });
    });
  } catch {
    // The lease expires on its own after IDEAS_LEASE_MS.
  }
}
