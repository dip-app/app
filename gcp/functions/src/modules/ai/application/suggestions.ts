import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GetEventIdeaSuggestionsResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminTransaction, Doc } from "../../admin/application/ports";
import { AdminError, invalid } from "../../admin/domain/errors";
import { chargeCredits, CREDIT_COSTS, creditsExhausted, creditsRemaining, creditsSummary, ledgerDocument, type CreditLedger } from "../domain/credits";
import { loadLedger } from "./credits";
import { answeredConsiderations, considerationQuestions, considerationsFromAnswers, rankConsiderationsForFacts } from "../domain/considerationRanking";
import type { ConsiderationRank } from "../domain/considerations";
import { summarizeInterests } from "../domain/interests";
import { dayKey, monthKey, aiPaths } from "../domain/paths";
import { costMicros, DECISION_MAX_TOKENS } from "../domain/pricing";
import { addSpend, checkPlatform, dayOfMonth, effectiveLimits, monthDocument, platformDocument, readMonth, readPlatform } from "../domain/quota";
import {
  activeLease, cacheState, DAY_MS, DEFAULT_CACHE_MAX_AGE_DAYS, LEASE_MS, readCache, suggestionFingerprint, type StoredCache,
} from "../domain/suggestionCache";
import {
  aggregatePastEvents, fromAnswers, hasSignal, heuristicSuggestions, suggestionQuestions, suggestionState, type PastEventInput, type Suggestion, type SuggestionFacts,
} from "../domain/suggestions";
import type { AiDeps, DecisionPort } from "./ports";
import type { Caller } from "./ports";

/** Recent past events of a company, for aggregate counts only. */
export interface PastEventSource {
  recent(companyId: string, now: Date): Promise<PastEventInput[]>;
}

/** A decision provider in the suggestion chain, with the model id used to price (and pre-check) its call. */
export interface SuggestionProvider { port: DecisionPort; model: string }

export interface SuggestionDeps extends AiDeps {
  pastEvents: PastEventSource;
  /**
   * Tried in order until one answers: Jev when JEV_API_KEY holds a real key, then the OpenAI mini model. Empty means
   * heuristic only. Every answered call is metered into the company's spend.
   */
  providers: readonly SuggestionProvider[];
  /** How long a saved answer stays fresh (default 7 days, AI_SUGGESTION_CACHE_DAYS). */
  cacheMaxAgeMs?: number;
  /** A request that finds another refresh running waits for it: poll interval and longest wait, in ms. */
  leasePollMs?: number;
  leaseWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Generous input bound for pricing one suggestion call (the state plus the step and consideration questions). */
export const SUGGEST_INPUT_TOKENS = 6000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  sessionId: z.string().regex(UUID).optional(),
  requestId: z.string().regex(UUID).optional(),
  refresh: z.boolean().optional(),
});

/** Worst case of one run: every provider in the chain is tried once at the token ceilings. */
export function suggestionWorstMicros(providers: readonly SuggestionProvider[]): number {
  return providers.reduce((sum, p) => sum + costMicros(p.model, { inputTokens: SUGGEST_INPUT_TOKENS, cachedInputTokens: 0, outputTokens: DECISION_MAX_TOKENS, reasoningTokens: 0 }), 0);
}

type Answer = GetEventIdeaSuggestionsResponse;
type Provider = Answer["provider"];

interface Computed { provider: Provider; suggestions: Suggestion[]; considerations: ConsiderationRank[]; computedAt: Date }

const toAnswer = (
  credits: GetEventIdeaSuggestionsResponse["credits"], data: Computed, status: Answer["cacheStatus"], charged: number, reason?: "data" | "age",
): Answer => ({
  contractVersion: 1, provider: data.provider, suggestions: data.suggestions, considerations: data.considerations, credits,
  cached: status !== "computed", cacheStatus: status, computedAt: data.computedAt.toISOString(), creditsCharged: charged,
  ...(reason ? { staleReason: reason } : {}),
});

/**
 * getEventIdeaSuggestionsV1. Admin only (`ai.generate`) and only while AI ideas are on.
 *
 * The answer (per-step suggestions plus the ranked considerations) is saved once per company in
 * `companies/{c}/aiCache/suggestions` and shared by every admin. A visit never spends credits when a saved answer
 * exists: it returns it as `fresh` (inputs unchanged and younger than the max age) or `stale` (shown as is, with the
 * reason), and makes no model call. The decision chain runs, and exactly one credit is charged when a model answers,
 * only (1) on the true first visit, when nothing is saved and credits remain, or (2) on an explicit `refresh`.
 * Concurrent refreshes share one run through a lease on the cache document. Without credits, budget, data or a
 * working provider the free heuristic answers and nothing is saved or charged.
 */
export async function getEventIdeaSuggestions(deps: SuggestionDeps, rawCaller: Caller | null, data: unknown): Promise<GetEventIdeaSuggestionsResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = RequestSchema.safeParse(data);
  if (!parsed.success) throw invalid([...new Set(parsed.error.issues.map(i => String(i.path[0] ?? "request")))]);
  const { companyId, refresh = false } = parsed.data;
  const requestId = (parsed.data.requestId ?? parsed.data.sessionId)?.toLowerCase();
  if (refresh && !requestId) throw invalid(["requestId"]);
  await deps.limiter?.consume(caller.uid);
  const cachePath = aiPaths.suggestionCache(companyId);
  const worst = suggestionWorstMicros(deps.providers);
  const maxAgeMs = deps.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_DAYS * DAY_MS;

  const start = await deps.store.runReadOnly(async tx => {
    await authorize(tx, caller, companyId, "ai.generate");
    const now = deps.now();
    const [settingsDoc, monthDoc, cacheDoc, platformDoc] = await tx.getMany([
      aiPaths.settings(companyId), aiPaths.month(companyId, monthKey(now)), cachePath, aiPaths.platform(monthKey(now)),
    ]);
    const limits = effectiveLimits(deps.settings, settingsDoc ?? null);
    if (!limits.enabled) throw new AdminError("failed-precondition", "AI_DISABLED", "AI event ideas are turned off for this company.");
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
      cacheDoc: cacheDoc ?? null, ledger, credits: creditsSummary(ledger),
      creditsOk: creditsRemaining(ledger) >= CREDIT_COSTS.suggestPanel,
      budgetOk: monthLeft >= worst && dayLeft >= worst && platformOk,
    };
  });

  const now = deps.now();
  const [stats, catalog, theme, past] = await Promise.all([
    deps.interests.countsFor(companyId), deps.catalog.list(), deps.themes.current(companyId, now), deps.pastEvents.recent(companyId, now),
  ]);
  const facts: SuggestionFacts = {
    interests: summarizeInterests(stats, catalog).top,
    theme,
    past: aggregatePastEvents(past, new Set(catalog.map(tag => tag.id))),
    catalog,
  };
  const fingerprint = suggestionFingerprint({ facts, maxInterestCount: Math.max(0, ...(stats ?? []).map(s => s.memberCount)) });

  const saved = (cache: StoredCache, at: Date, credits: Answer["credits"], charged = 0): Answer => {
    const state = cacheState(cache, fingerprint, at, maxAgeMs);
    return toAnswer(credits, cache, state.status, charged, state.status === "stale" ? state.reason : undefined);
  };

  const existing = readCache(start.cacheDoc);
  if (existing) {
    // A repeated refresh (same requestId) returns what it already produced; a plain visit never recomputes.
    if (!refresh || (requestId !== undefined && existing.requestId === requestId)) {
      deps.log?.("ai.suggest", { companyId, cacheStatus: saved(existing, now, start.credits).cacheStatus, creditsCharged: 0, model: null });
      return saved(existing, now, start.credits);
    }
  }
  if (refresh && !start.creditsOk) throw creditsExhausted(start.ledger);

  // From here a model run is wanted: the first-ever visit, or an explicit refresh.
  const wantModel = hasSignal(facts) && start.budgetOk && start.creditsOk;
  const heuristic = (): Answer => {
    const suggestions = heuristicSuggestions(facts);
    return toAnswer(start.credits, {
      provider: suggestions.length > 0 ? "heuristic" : "none", suggestions, considerations: rankConsiderationsForFacts(facts), computedAt: now,
    }, "computed", 0);
  };
  if (!wantModel) {
    if (existing) return saved(existing, now, start.credits);
    deps.log?.("ai.suggest", { companyId, provider: "heuristic", detail: hasSignal(facts) ? "budget" : "no_data", cacheStatus: "computed", creditsCharged: 0, model: null });
    return heuristic();
  }

  // Claim the lease: one run per company at a time; others wait for it and share the result.
  const token = randomUUID();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const pollMs = deps.leasePollMs ?? 1000;
  let waited = 0;
  for (;;) {
    const claim = await deps.store.runTransaction(async tx => {
      const at = deps.now();
      const doc = await tx.get(cachePath);
      const cache = readCache(doc);
      // Someone else is computing: wait for them first, whatever is saved right now.
      if (activeLease(doc, at)) return { kind: "busy" as const, at };
      if (cache && (!refresh || (requestId !== undefined && cache.requestId === requestId) || waited > 0)) return { kind: "shared" as const, cache, at };
      put(tx, cachePath, doc, { leaseHolder: token, leaseUntil: new Date(at.getTime() + LEASE_MS) });
      return { kind: "claimed" as const, at };
    });
    if (claim.kind === "shared") return saved(claim.cache, claim.at, (await currentCredits(deps, companyId)) ?? start.credits);
    if (claim.kind === "claimed") break;
    if (waited >= (deps.leaseWaitMs ?? 40_000)) return existing ? saved(existing, claim.at, start.credits) : heuristic();
    await sleep(pollMs);
    waited += pollMs;
  }

  // We hold the lease. Whatever happens, release it.
  let provider: Provider = "none";
  let suggestions: Suggestion[] = [];
  let considerations: ConsiderationRank[] = rankConsiderationsForFacts(facts);
  let spent = { micros: 0, tokensIn: 0, tokensOut: 0, model: "" };
  let detail = "providers_failed";
  try {
    const state = suggestionState(facts);
    const questions = { ...suggestionQuestions(facts), ...considerationQuestions() };
    for (const { port } of deps.providers) {
      try {
        const result = await port.decide({ step: "triage", state, questions });
        spent = {
          micros: spent.micros + costMicros(result.model, result.usage), tokensIn: spent.tokensIn + result.usage.inputTokens,
          tokensOut: spent.tokensOut + result.usage.outputTokens, model: result.model,
        };
        const answered = fromAnswers(result.answers, facts);
        if (answered.length > 0) {
          provider = result.provider;
          suggestions = answered;
          if (answeredConsiderations(result.answers) > 0) considerations = considerationsFromAnswers(result.answers, facts);
          detail = "ok";
          break;
        }
      } catch {
        // Provider unavailable or invalid answer: try the next one. Nothing billable is known.
      }
    }
    if (provider === "none") {
      suggestions = heuristicSuggestions(facts);
      provider = suggestions.length > 0 ? "heuristic" : "none";
    }
  } catch (error) {
    await releaseLease(deps, cachePath, token);
    throw error;
  }

  const answered = provider === "jev" || provider === "openai";
  let charged = 0;
  const outcome = await deps.store.runTransaction(async tx => {
    const at = deps.now();
    const monthPath = aiPaths.month(companyId, monthKey(at));
    const platformPath = aiPaths.platform(monthKey(at));
    const [monthDoc, doc, platformDoc, settingsDoc] = await tx.getMany([monthPath, cachePath, platformPath, aiPaths.settings(companyId)]);
    const loaded = await loadLedger(tx, companyId, settingsDoc ?? null, at);
    if (spent.micros > 0 || spent.tokensIn > 0) {
      const month = readMonth(monthDoc ?? null, at);
      addSpend(month, dayKey(at).slice(-2), { spentMicros: spent.micros, inputTokens: spent.tokensIn, outputTokens: spent.tokensOut });
      put(tx, monthPath, monthDoc ?? null, monthDocument(month));
      // The platform-wide monthly ceiling counts every metered call, suggestions included.
      const platform = readPlatform(platformDoc ?? null, at);
      platform.spentMicros += spent.micros;
      put(tx, platformPath, platformDoc ?? null, platformDocument(platform));
    }
    charged = 0;
    if (answered) {
      // One credit per run that a model answered. The key makes a repeated request free; heuristic and failed runs are never charged.
      const outcomeOfCharge = chargeCredits(loaded.ledger, `suggest_${requestId ?? `auto_${fingerprint}`}`, CREDIT_COSTS.suggestPanel);
      if (outcomeOfCharge === "charged") {
        charged = CREDIT_COSTS.suggestPanel;
        put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
      }
      put(tx, cachePath, doc ?? null, {
        provider, suggestions, considerations, fingerprint, computedAt: at, ...(requestId ? { requestId } : {}), leaseHolder: "", leaseUntil: null,
      });
    } else if (doc) {
      put(tx, cachePath, doc, { leaseHolder: "", leaseUntil: null });
    }
    return { at, ledger: loaded.ledger };
  });
  // Ids, counts and outcome only: never the state, the questions or the answers.
  deps.log?.("ai.suggest", {
    companyId, provider, detail, suggestions: suggestions.length, model: spent.model || null, tokensIn: spent.tokensIn, costMicros: spent.micros,
    cacheStatus: answered ? "computed" : "unchanged", creditsCharged: charged,
  });
  const credits = creditsSummary(outcome.ledger as CreditLedger);
  if (answered) return toAnswer(credits, { provider, suggestions, considerations, computedAt: outcome.at }, "computed", charged);
  // Nothing answered: keep and show the saved answer when there is one (a failed refresh changes nothing), else the free heuristic.
  return existing ? saved(existing, outcome.at, credits) : { ...heuristicFrom(provider, suggestions, considerations, outcome.at, credits) };
}

function heuristicFrom(provider: Provider, suggestions: Suggestion[], considerations: ConsiderationRank[], at: Date, credits: Answer["credits"]): Answer {
  return toAnswer(credits, { provider, suggestions, considerations, computedAt: at }, "computed", 0);
}

async function currentCredits(deps: SuggestionDeps, companyId: string): Promise<Answer["credits"] | null> {
  return deps.store.runReadOnly(async tx => {
    const [settingsDoc] = await tx.getMany([aiPaths.settings(companyId)]);
    const { ledger } = await loadLedger(tx, companyId, settingsDoc ?? null, deps.now());
    return creditsSummary(ledger);
  });
}

async function releaseLease(deps: SuggestionDeps, path: string, token: string): Promise<void> {
  try {
    await deps.store.runTransaction(async tx => {
      const doc = await tx.get(path);
      if (doc && doc.leaseHolder === token) tx.update(path, { leaseHolder: "", leaseUntil: null });
    });
  } catch {
    // The lease expires on its own after LEASE_MS.
  }
}

function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data);
  else tx.create(path, data);
}
