import { z } from "zod";
import type { GetEventIdeaSuggestionsResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminTransaction, Doc } from "../../admin/application/ports";
import { AdminError, invalid } from "../../admin/domain/errors";
import { summarizeInterests } from "../domain/interests";
import { dayKey, monthKey, aiPaths } from "../domain/paths";
import { costMicros, DECISION_MAX_TOKENS } from "../domain/pricing";
import { addSpend, dayOfMonth, effectiveLimits, monthDocument, readMonth } from "../domain/quota";
import {
  aggregatePastEvents, fromAnswers, hasSignal, heuristicSuggestions, suggestionQuestions, suggestionState, type PastEventInput, type Suggestion, type SuggestionFacts,
} from "../domain/suggestions";
import type { AiDeps, Caller, DecisionPort } from "./ports";

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
}

export const SUGGESTION_TTL_MS = 60 * 60_000;
/** Generous input bound for pricing one suggestion call (the state is a few hundred tokens). */
export const SUGGEST_INPUT_TOKENS = 3000;

export const suggestionPath = (companyId: string, uid: string, sessionId: string) => `companies/${companyId}/aiSuggestions/${uid}_${sessionId}`;

const RequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  sessionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
});

/** Worst case of one run: every provider in the chain is tried once at the token ceilings. */
export function suggestionWorstMicros(providers: readonly SuggestionProvider[]): number {
  return providers.reduce((sum, p) => sum + costMicros(p.model, { inputTokens: SUGGEST_INPUT_TOKENS, cachedInputTokens: 0, outputTokens: DECISION_MAX_TOKENS, reasoningTokens: 0 }), 0);
}

const StoredSchema = z.object({
  uid: z.string(),
  provider: z.enum(["jev", "openai", "heuristic", "none"]),
  suggestions: z.array(z.object({
    question: z.enum(["interest", "goal", "groupSize", "setting", "budget", "timing"]), value: z.string(), probability: z.number().min(0).max(1), reason: z.string(),
  })).max(6),
});

function expiry(doc: Doc | null | undefined): number {
  const value = doc?.expireAt as { toDate?: () => Date } | Date | undefined;
  const date = value instanceof Date ? value : typeof value?.toDate === "function" ? value.toDate() : null;
  return date ? date.getTime() : 0;
}

/**
 * getEventIdeaSuggestionsV1. Admin only (`ai.generate`) and only while AI ideas are on. Per visit (sessionId) it asks
 * the decision chain once, with every step's question over one shared, privacy-safe state, and caches the answer for
 * an hour. The call is priced into the month and day spend (not the generation counts). When the budget left cannot
 * cover the worst case, every provider fails, or there is no data, the deterministic heuristic (or no suggestion)
 * answers instead, so the portal always works.
 */
export async function getEventIdeaSuggestions(deps: SuggestionDeps, rawCaller: Caller | null, data: unknown): Promise<GetEventIdeaSuggestionsResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = RequestSchema.safeParse(data);
  if (!parsed.success) throw invalid([...new Set(parsed.error.issues.map(i => String(i.path[0] ?? "request")))]);
  const { companyId, sessionId } = parsed.data;
  const path = suggestionPath(companyId, caller.uid, sessionId.toLowerCase());
  await deps.limiter?.consume(caller.uid);
  const worst = suggestionWorstMicros(deps.providers);

  const start = await deps.store.runReadOnly(async tx => {
    await authorize(tx, caller, companyId, "ai.generate");
    const now = deps.now();
    const [settingsDoc, monthDoc, cacheDoc] = await tx.getMany([aiPaths.settings(companyId), aiPaths.month(companyId, monthKey(now)), path]);
    const limits = effectiveLimits(deps.settings, settingsDoc ?? null);
    if (!limits.enabled) throw new AdminError("failed-precondition", "AI_DISABLED", "AI event ideas are turned off for this company.");
    if (cacheDoc && expiry(cacheDoc) > now.getTime()) {
      const stored = StoredSchema.safeParse(cacheDoc);
      if (stored.success && stored.data.uid === caller.uid) return { cached: stored.data };
    }
    const month = readMonth(monthDoc ?? null, now);
    const pending = Object.values(month.pending).reduce((sum, r) => sum + r.micros, 0);
    const monthLeft = limits.monthlyBudgetMicros - month.spentMicros - pending;
    const dayLeft = limits.dailyBudgetMicros - (month.days[dayOfMonth(now)]?.spentMicros ?? 0) - pending;
    return { budgetOk: monthLeft >= worst && dayLeft >= worst };
  });
  if ("cached" in start) {
    return { contractVersion: 1, provider: start.cached.provider, suggestions: start.cached.suggestions, cached: true };
  }

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

  let provider: GetEventIdeaSuggestionsResponse["provider"] = "none";
  let suggestions: Suggestion[] = [];
  let spent = { micros: 0, tokensIn: 0, tokensOut: 0, model: "" };
  let detail = "no_data";
  if (hasSignal(facts)) {
    detail = start.budgetOk ? "providers_failed" : "budget";
    if (start.budgetOk) {
      const state = suggestionState(facts);
      const questions = suggestionQuestions(facts);
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
            detail = "ok";
            break;
          }
        } catch {
          // Provider unavailable or invalid answer: try the next one. Nothing billable is known.
        }
      }
    }
    if (provider === "none") {
      suggestions = heuristicSuggestions(facts);
      provider = suggestions.length > 0 ? "heuristic" : "none";
    }
  }

  await deps.store.runTransaction(async tx => {
    const at = deps.now();
    const monthPath = aiPaths.month(companyId, monthKey(at));
    const [monthDoc, cacheDoc] = await tx.getMany([monthPath, path]);
    if (spent.micros > 0 || spent.tokensIn > 0) {
      const month = readMonth(monthDoc ?? null, at);
      addSpend(month, dayKey(at).slice(-2), { spentMicros: spent.micros, inputTokens: spent.tokensIn, outputTokens: spent.tokensOut });
      put(tx, monthPath, monthDoc ?? null, monthDocument(month));
    }
    put(tx, path, cacheDoc ?? null, { uid: caller.uid, provider, suggestions, createdAt: at, expireAt: new Date(at.getTime() + SUGGESTION_TTL_MS) });
  });
  // Ids, counts and outcome only: never the state, the questions or the answers.
  deps.log?.("ai.suggest", {
    companyId, provider, detail, suggestions: suggestions.length, model: spent.model || null, tokensIn: spent.tokensIn, costMicros: spent.micros,
  });
  return { contractVersion: 1, provider, suggestions, cached: false };
}

function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data);
  else tx.create(path, data);
}
