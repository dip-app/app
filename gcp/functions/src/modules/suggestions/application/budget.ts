import type { AdminStore, AdminTransaction, Doc } from "../../admin/application/ports";
import type { AiSettings } from "../../ai/application/ports";
import { aiPaths, monthKey } from "../../ai/domain/paths";
import { costMicros } from "../../ai/domain/pricing";
import { addSpend, dayOfMonth, effectiveLimits, monthDocument, readMonth, RESERVATION_TTL_MS } from "../../ai/domain/quota";
import type { SuggestionBudget } from "./ports";

/** Per-chunk token ceilings used to bound the cost of one ranking call. */
export const CHUNK_INPUT_TOKENS = 6000;
export const CHUNK_OUTPUT_TOKENS = 2000;

/** Upper bound of a whole ranking run for an engine: every chunk at the token ceilings, priced on the engine's model. */
export function worstCaseFor(model: string, chunks: number): number {
  const one = costMicros(model, { inputTokens: CHUNK_INPUT_TOKENS, cachedInputTokens: 0, outputTokens: CHUNK_OUTPUT_TOKENS, reasoningTokens: 0 });
  return one * chunks;
}

function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data);
  else tx.create(path, data);
}

/**
 * The weekly suggestions run shares the company's AI budget on `companies/{c}/aiUsage/{yyyymm}`
 * (docs/design/stretch/admin-suggestions-email.md, "Cost and the AI budget guard"). It reserves the worst case under
 * the pending key `suggest_{weekKey}` (uid `system`, same five minute expiry), then settles the actual cost. It never
 * counts as a generation. Reservation and settlement are transactions on the month document, so concurrent AI
 * generations and this run cannot overspend together.
 */
export function firestoreBudget(store: AdminStore, settings: AiSettings): SuggestionBudget {
  return {
    async reserve(companyId, key, worstMicros, now) {
      return store.runTransaction(async tx => {
        const monthPath = aiPaths.month(companyId, monthKey(now));
        const [settingsDoc, monthDoc] = await tx.getMany([aiPaths.settings(companyId), monthPath]);
        const limits = effectiveLimits(settings, settingsDoc ?? null);
        if (!limits.enabled) return false;
        const month = readMonth(monthDoc ?? null, now);
        // A re-run of the same key (an expired lease) replaces its own earlier reservation instead of counting it twice.
        const others = Object.entries(month.pending).filter(([k]) => k !== key).reduce((sum, [, r]) => sum + r.micros, 0);
        const monthLeft = limits.monthlyBudgetMicros - month.spentMicros - others;
        const dayLeft = limits.dailyBudgetMicros - (month.days[dayOfMonth(now)]?.spentMicros ?? 0) - others;
        if (monthLeft < worstMicros || dayLeft < worstMicros) return false;
        month.pending[key] = { uid: "system", micros: worstMicros, expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS) };
        put(tx, monthPath, monthDoc ?? null, monthDocument(month));
        return true;
      });
    },

    async settle(companyId, key, spentMicros, tokensIn, tokensOut, now) {
      await store.runTransaction(async tx => {
        const monthPath = aiPaths.month(companyId, monthKey(now));
        const [monthDoc] = await tx.getMany([monthPath]);
        const month = readMonth(monthDoc ?? null, now);
        delete month.pending[key];
        addSpend(month, dayOfMonth(now), { spentMicros, inputTokens: tokensIn, outputTokens: tokensOut });
        put(tx, monthPath, monthDoc ?? null, monthDocument(month));
      });
    },
  };
}
