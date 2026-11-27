import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SuggestThemeResponse, ThemeSuggestion } from "../../../generated/models";
import { authorize, requireCaller, writeAudit, type Actor } from "../../admin/application/context";
import type { AdminTransaction, Doc } from "../../admin/application/ports";
import { change } from "../../admin/domain/audit";
import { AdminError, invalid } from "../../admin/domain/errors";
import { gatherSignals } from "../../suggestions/application/buildDigest";
import type { SuggestionsStore } from "../../suggestions/application/ports";
import { weekKey as weekKeyOf } from "../../suggestions/domain/signals";
import { chargeCredits, CREDIT_COSTS, creditsExhausted, creditsRemaining, creditsSummary, ledgerDocument, refundCredits, type CreditLedger } from "../domain/credits";
import { cleanText, hasForbiddenContent } from "../domain/drafts";
import { ideaSnapshot } from "../domain/ideaTools";
import { aiPaths, dayKey, monthKey } from "../domain/paths";
import { THEME_PRICED, costMicros, isReasoningModel, themeWorstCaseMicros } from "../domain/pricing";
import { addSpend, checkPlatform, dayOfMonth, effectiveLimits, monthDocument, platformDocument, readMonth, readPlatform } from "../domain/quota";
import { THEME_LIMITS, themeKeyOfUrl, themeSnapshot, type ThemeRecord, type ThemeSnapshot } from "../domain/themeTools";
import { buildThemes, fallbackThemes, moderationTexts, rankThemes, themeRankingRequest, type ThemeLocale } from "../domain/themeValidate";
import { loadLedger } from "./credits";
import type { AgentModelPort, AiDeps, Caller, DecisionAnswer, ThemeHistorySource, ThemeSuggestSettings } from "./ports";
import { suggestionWorstMicros, type SuggestionProvider } from "./suggestions";
import { runThemeAgent, type ThemeAgentResult } from "./themeAgent";

/**
 * suggestThemeV1 (docs/design/stretch/dipbot-suggest-theme.md). Admin only (`ai.generate`); the company comes from the
 * caller's server membership and the supplied companyId must equal it.
 *
 * Order: caller, strict parse, burst limiter, authorization and the switches (read only), a replay of the requestId (free),
 * the hint (no contact data, free moderation), the company snapshot, then ONE transaction that re-checks the replay, counts
 * the run against the company and per-admin daily caps and reserves the credits. The model (tool loop over read-only
 * aggregates) runs outside it; its themes are validated, moderated and ranked. A second transaction settles: spend added
 * to the month and platform, credits refunded when no model theme survived (the free catalog themes are returned), the
 * answer stored for replays and a content-free audit entry.
 */

export interface SuggestThemeDeps extends AiDeps {
  /** The tool-using model; null when none is configured (the free catalog suggestions are returned). */
  agent: AgentModelPort | null;
  signals: SuggestionsStore;
  themeHistory: ThemeHistorySource;
  /** Ranking decision providers in order (Jev, then the OpenAI mini model); empty ranks by the prior only. */
  rankers: readonly SuggestionProvider[];
  /** Stored with the request ("openai"; "demo" in the emulator). */
  provider?: "openai" | "demo";
  agentDeadlineMs?: number;
}

const DEFAULT_SETTINGS: ThemeSuggestSettings = { enabled: true, model: "gpt-4o-mini", companyDailyLimit: 40 };
const FIELDS = ["title", "description", "tags", "week", "illustration"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  requestId: z.string().regex(UUID),
  hint: z.string().max(THEME_LIMITS.hintMax).optional(),
  fields: z.array(z.enum(FIELDS)).min(1).max(FIELDS.length).optional(),
  locale: z.enum(["en", "es"]).optional(),
});

const LEASE_MS = 90_000;
const REQUEST_TTL_MS = 24 * 3_600_000;
const USAGE_TTL_MS = 3 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;

const put = (tx: AdminTransaction, path: string, existing: Doc | null, data: Doc) => (existing ? tx.update(path, data) : tx.create(path, data));
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** A stored instant (Date or Firestore Timestamp) in ms; 0 when absent. */
function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const maybe = value as { toDate?: () => Date } | null | undefined;
  return maybe && typeof maybe.toDate === "function" ? maybe.toDate().getTime() : 0;
}

export const themeSuggestDisabled = () => new AdminError("failed-precondition", "AI_THEME_SUGGEST_DISABLED", "Theme suggestions are turned off for this company.");
const limitReached = () => new AdminError("resource-exhausted", "AI_THEME_SUGGEST_LIMIT", "You have used today's theme suggestions. Try again tomorrow.");
const inProgress = () => new AdminError("aborted", "REQUEST_IN_PROGRESS", "These ideas are still being written. Wait a moment.");
const reused = () => new AdminError("failed-precondition", "REQUEST_REUSED", "This request ID was already used with different details.", ["requestId"]);

/** Whether Suggest theme is on for a company: deployment switch, the company AI rule (effectiveLimits) and the per-company switch. */
export function themeSuggestOn(settings: AiDeps["settings"], companySettings: Doc | null): boolean {
  const cfg = settings.themeSuggest ?? DEFAULT_SETTINGS;
  return cfg.enabled && effectiveLimits(settings, companySettings).enabled && companySettings?.themeSuggestEnabled !== false;
}

interface StoredAnswer { suggestions: ThemeSuggestion[]; outcome: SuggestThemeResponse["outcome"]; charged: number }

function storedAnswer(doc: Doc | null): StoredAnswer | null {
  const r = doc?.response as Partial<StoredAnswer> | undefined;
  if (doc?.status !== "done" || !r || !Array.isArray(r.suggestions) || r.suggestions.length === 0) return null;
  return { suggestions: r.suggestions, outcome: r.outcome === "suggested" ? "suggested" : "fallback", charged: typeof r.charged === "number" ? r.charged : 0 };
}

const answer = (s: StoredAnswer, credits: SuggestThemeResponse["credits"], replay: boolean, charged: number): SuggestThemeResponse => ({
  contractVersion: 1, suggestion: s.suggestions[0]!, alternatives: s.suggestions.slice(1, 4), outcome: s.outcome, replay, credits, creditsCharged: charged,
});

export async function suggestTheme(deps: SuggestThemeDeps, rawCaller: Caller | null, data: unknown): Promise<SuggestThemeResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = RequestSchema.safeParse(data);
  if (!parsed.success) throw invalid([...new Set(parsed.error.issues.map(i => String(i.path[0] ?? "request")))]);
  const { companyId } = parsed.data;
  const requestId = parsed.data.requestId.toLowerCase();
  const locale: ThemeLocale = parsed.data.locale ?? "en";
  const fields = [...new Set(parsed.data.fields ?? FIELDS)].sort();
  const rawHint = parsed.data.hint ?? "";
  const hash = createHash("sha256").update(JSON.stringify({ hint: rawHint.trim(), fields, locale })).digest("hex").slice(0, 32);
  await deps.limiter?.consume(caller.uid);

  const cfg = deps.settings.themeSuggest ?? DEFAULT_SETTINGS;
  const requestPath = aiPaths.themeRequest(companyId, caller.uid, requestId);
  const chargeKey = `themeSuggest_${caller.uid}_${requestId}`;
  const cost = CREDIT_COSTS.themeSuggest;
  const worst = themeWorstCaseMicros(cfg.model) + suggestionWorstMicros(deps.rankers);

  // 1. Read-only: who, the switches, a replay, and the fast refusals (nothing is written or charged).
  const start = await deps.store.runReadOnly(async tx => {
    const actor = await authorize(tx, caller, companyId, "ai.generate");
    const [settingsDoc, requestDoc] = await tx.getMany([aiPaths.settings(companyId), requestPath]);
    if (!themeSuggestOn(deps.settings, settingsDoc ?? null)) throw themeSuggestDisabled();
    const { ledger } = await loadLedger(tx, companyId, settingsDoc ?? null, deps.now());
    return { actor, requestDoc: requestDoc ?? null, ledger };
  });
  const replayOf = (doc: Doc | null, ledger: CreditLedger): SuggestThemeResponse | null => {
    if (!doc) return null;
    if (doc.hash !== hash) throw reused();
    const stored = storedAnswer(doc);
    return stored ? answer(stored, creditsSummary(ledger), true, 0) : null;
  };
  const early = replayOf(start.requestDoc, start.ledger);
  if (early) return early;
  if (!(chargeKey in start.ledger.charges) && creditsRemaining(start.ledger) < cost) throw creditsExhausted(start.ledger);

  // 2. The hint: never contact data; free moderation fails closed. Nothing is charged for a refused hint.
  const hint = cleanText(rawHint.replace(/\s*\n\s*/g, " "), THEME_LIMITS.hintMax);
  if (hint && hasForbiddenContent(hint)) throw new AdminError("invalid-argument", "AI_PROMPT_REJECTED", "Leave out links, email addresses and phone numbers.", ["hint"]);
  if (hint) {
    let flagged = false;
    try {
      const [verdict] = await deps.llm.moderate([hint]);
      if (!verdict) throw new Error("moderation missing");
      flagged = verdict.flagged;
    } catch {
      throw new AdminError("unavailable", "AI_UNAVAILABLE", "The AI service is busy. Try again in a minute.");
    }
    if (flagged) {
      deps.log?.("ai.themeSuggest", { companyId, requestId, outcome: "hint_declined", creditsCharged: 0 });
      throw new AdminError("invalid-argument", "AI_PROMPT_REJECTED", "We couldn't use that hint. Describe the kind of theme you want and try again.", ["hint"]);
    }
  }

  // 3. The snapshot: company aggregates (shared with the daily ideas) plus past and scheduled weekly themes.
  const now = deps.now();
  const timeZone = (await deps.signals.companyContext(companyId)).timeZone ?? "UTC";
  const [signals, tags, history] = await Promise.all([
    gatherSignals({ store: deps.signals, interests: deps.interests, catalog: deps.catalog }, companyId, now, timeZone, weekKeyOf(now, timeZone)),
    deps.catalog.list(),
    deps.themeHistory.between(companyId, new Date(now.getTime() - (THEME_LIMITS.duplicateWindowWeeks + 1) * WEEK_MS), new Date(now.getTime() + (THEME_LIMITS.weeksAhead + 1) * WEEK_MS)),
  ]);
  const records: ThemeRecord[] = history.map(h => ({
    title: h.title, tagIds: h.tagIds, themeKey: themeKeyOfUrl(h.coverImageURL), startDate: h.startDate, endDate: h.endDate, participantCount: h.participantCount,
  }));
  const snapshot = themeSnapshot(ideaSnapshot(signals, tags), records);
  const ctx = { snapshot, locale };

  // 4. Claim: replay check again, daily caps, budget headroom and the credit reservation, all in one transaction.
  const token = randomUUID();
  const claim = await deps.store.runTransaction(async tx => {
    const at = deps.now();
    const usagePath = aiPaths.themeUsage(companyId, dayKey(at));
    const [requestDoc, usageDoc, settingsDoc, monthDoc, platformDoc] = await tx.getMany([
      requestPath, usagePath, aiPaths.settings(companyId), aiPaths.month(companyId, monthKey(at)), aiPaths.platform(monthKey(at)),
    ]);
    if (!themeSuggestOn(deps.settings, settingsDoc ?? null)) throw themeSuggestDisabled();
    const loaded = await loadLedger(tx, companyId, settingsDoc ?? null, at);
    const replay = replayOf(requestDoc ?? null, loaded.ledger);
    if (replay) return { kind: "replay" as const, replay };
    const lease = millis(requestDoc?.leaseUntil);
    if (requestDoc && requestDoc.status === "pending" && lease > at.getTime()) throw inProgress();

    // A retried crashed request was already counted and charged: never count or charge it twice.
    if (!requestDoc) {
      const count = typeof usageDoc?.count === "number" ? usageDoc.count : 0;
      const byAdmin = (usageDoc?.byAdmin ?? {}) as Record<string, number>;
      const mine = typeof byAdmin[caller.uid] === "number" ? byAdmin[caller.uid]! : 0;
      if (count >= cfg.companyDailyLimit || mine >= deps.settings.dailyGenerationLimit) throw limitReached();
      put(tx, usagePath, usageDoc ?? null, { count: count + 1, byAdmin: { ...byAdmin, [caller.uid]: mine + 1 }, updatedAt: at, expireAt: new Date(at.getTime() + USAGE_TTL_MS) });
    }

    const limits = effectiveLimits(deps.settings, settingsDoc ?? null);
    const month = readMonth(monthDoc ?? null, at);
    const pending = Object.values(month.pending).reduce((sum, r) => sum + r.micros, 0);
    let budgetOk = limits.monthlyBudgetMicros - month.spentMicros - pending >= worst
      && limits.dailyBudgetMicros - (month.days[dayOfMonth(at)]?.spentMicros ?? 0) - pending >= worst;
    try { checkPlatform(readPlatform(platformDoc ?? null, at), deps.settings.platformMonthlyBudgetMicros, worst); } catch { budgetOk = false; }
    const runModel = deps.agent !== null && budgetOk;
    if (runModel) {
      const outcome = chargeCredits(loaded.ledger, chargeKey, cost);
      if (outcome === "insufficient") throw creditsExhausted(loaded.ledger);
      if (outcome === "charged") put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
    }
    put(tx, requestPath, requestDoc ?? null, {
      uid: caller.uid, hash, status: "pending", leaseHolder: token, leaseUntil: new Date(at.getTime() + LEASE_MS), createdAt: at,
      expireAt: new Date(at.getTime() + REQUEST_TTL_MS),
    });
    return { kind: "claimed" as const, runModel, detail: deps.agent === null ? "no_model" : budgetOk ? "" : "budget", ledger: loaded.ledger };
  });
  if (claim.kind === "replay") return claim.replay;

  // 5. Run (never throws): agent, validation, moderation, ranking.
  const run = claim.runModel ? await produce(deps, ctx, { hint, fields, locale }, cfg.model) : null;
  const suggestions = run?.suggestions ?? fallbackThemes(ctx);
  const answered = run !== null && run.agentCount > 0;
  const charged = answered ? cost : 0;
  const stored: StoredAnswer = { suggestions, outcome: answered ? "suggested" : "fallback", charged };

  // 6. Settle once: spend, refund or keep, store the answer, audit when a model ran.
  let ledger = claim.ledger;
  try {
    ledger = await deps.store.runTransaction(async tx => {
      const at = deps.now();
      const monthPath = aiPaths.month(companyId, monthKey(at));
      const platformPath = aiPaths.platform(monthKey(at));
      const [monthDoc, platformDoc, settingsDoc, requestDoc] = await tx.getMany([monthPath, platformPath, aiPaths.settings(companyId), requestPath]);
      const loaded = await loadLedger(tx, companyId, settingsDoc ?? null, at);
      if (run && (run.micros > 0 || run.tokensIn > 0)) {
        const month = readMonth(monthDoc ?? null, at);
        addSpend(month, dayKey(at).slice(-2), { spentMicros: run.micros, inputTokens: run.tokensIn, outputTokens: run.tokensOut });
        put(tx, monthPath, monthDoc ?? null, monthDocument(month));
        const platform = readPlatform(platformDoc ?? null, at);
        platform.spentMicros += run.micros;
        put(tx, platformPath, platformDoc ?? null, platformDocument(platform));
      }
      if (!answered && refundCredits(loaded.ledger, chargeKey)) put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
      put(tx, requestPath, requestDoc ?? null, { status: "done", leaseHolder: "", leaseUntil: null, response: plain(stored), finishedAt: at });
      if (run) auditRun(tx, start.actor, token, answered, run.agent, charged, requestId);
      return loaded.ledger;
    });
  } catch (error) {
    await recover(deps, companyId, requestPath, token, chargeKey);
    throw error;
  }

  const toolNames = run?.agent.traces.map(t => t.name) ?? [];
  deps.log?.("ai.themeSuggest", {
    companyId, requestId, outcome: answered ? "suggested" : "fallback", detail: run ? run.agent.outcome : claim.detail, hint: hint !== "",
    tools: toolNames.length, toolNames: toolNames.join(","), provider: run ? deps.provider ?? "openai" : null, model: run?.agent.model || null,
    rankedBy: run?.rankedBy ?? null, turns: run?.agent.turns ?? 0, tokensIn: run?.tokensIn ?? 0, tokensOut: run?.tokensOut ?? 0, costMicros: run?.micros ?? 0,
    suggestions: suggestions.length, agentSuggestions: run?.agentCount ?? 0, creditsCharged: charged,
  });
  return answer(stored, creditsSummary(ledger), false, charged);
}

interface Produced {
  suggestions: ThemeSuggestion[] | null;
  agentCount: number;
  rankedBy: "jev" | "openai" | "heuristic";
  agent: ThemeAgentResult;
  micros: number;
  tokensIn: number;
  tokensOut: number;
}

/** Agent, repair and de-duplication, output moderation (fails closed), ranking. Never throws: a failure is an unanswered run. */
async function produce(deps: SuggestThemeDeps, ctx: { snapshot: ThemeSnapshot; locale: ThemeLocale }, input: { hint: string; fields: readonly string[]; locale: ThemeLocale }, model: string): Promise<Produced> {
  let agent: ThemeAgentResult = { modelThemes: null, traces: [], usage: { tokensIn: 0, tokensOut: 0, cachedIn: 0, reasoning: 0 }, model: "", turns: 0, outcome: "unavailable" };
  try {
    // Reasoning models spend hidden output tokens: give them the same 3x room the price reservation already covers.
    const maxOutputTokens = isReasoningModel(model) ? 3 * THEME_PRICED.outputPerTurn : THEME_PRICED.outputPerTurn;
    agent = await runThemeAgent({ model: deps.agent!, maxOutputTokens, ...(deps.agentDeadlineMs !== undefined ? { deadlineMs: deps.agentDeadlineMs } : {}) }, { snapshot: ctx.snapshot, ...input });
  } catch {
    // Unanswered below.
  }
  const u = agent.usage;
  let micros = costMicros(agent.model || model, { inputTokens: u.tokensIn, cachedInputTokens: u.cachedIn, outputTokens: u.tokensOut, reasoningTokens: u.reasoning });
  let tokensIn = u.tokensIn;
  let tokensOut = u.tokensOut;
  const none = (): Produced => ({ suggestions: null, agentCount: 0, rankedBy: "heuristic", agent, micros, tokensIn, tokensOut });
  if (agent.modelThemes === null) return none();
  try {
    let flagged = new Set<number>();
    try {
      const verdicts = await deps.llm.moderate(moderationTexts(agent.modelThemes));
      flagged = new Set(agent.modelThemes.map((_, i) => i).filter(i => verdicts[i]?.flagged !== false));
    } catch {
      flagged = new Set(agent.modelThemes.map((_, i) => i));
    }
    const built = buildThemes(ctx, agent.modelThemes, agent.traces, flagged);
    if (built.agentCount === 0) return none();
    let rankedBy: Produced["rankedBy"] = "heuristic";
    let answers: Record<string, DecisionAnswer> | null = null;
    const request = themeRankingRequest(built.suggestions, ctx.snapshot);
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
        // Next provider, then the prior only.
      }
    }
    return { suggestions: rankThemes(built.suggestions, ctx.snapshot, answers), agentCount: built.agentCount, rankedBy, agent, micros, tokensIn, tokensOut };
  } catch {
    return none();
  }
}

function auditRun(tx: AdminTransaction, actor: Actor, token: string, answered: boolean, agent: ThemeAgentResult, charged: number, requestId: string): void {
  writeAudit(tx, actor, {
    id: `ai_theme_${token}`,
    action: answered ? "ai.themeSuggested" : "ai.themeSuggestFailed",
    targetType: "company",
    targetId: actor.companyId,
    summary: answered ? "Dipbot suggested a weekly theme" : "Dipbot couldn't suggest a weekly theme",
    summaryKey: answered ? "ai.themeSuggested" : "ai.themeSuggestFailed",
    // Tool names, model, tokens and credits only: never the hint, prompts, tool results or theme text, and never money.
    changes: [
      change("tools", null, agent.traces.map(t => t.name)),
      change("models", null, agent.model),
      change("tokens", null, `${agent.usage.tokensIn} in, ${agent.usage.tokensOut} out`),
      change("credits", null, String(charged)),
    ],
    requestId,
  });
}

/** After a failed settle: refund and release the lease so a retry of the same requestId can run. Best effort. */
async function recover(deps: SuggestThemeDeps, companyId: string, requestPath: string, token: string, chargeKey: string): Promise<void> {
  try {
    await deps.store.runTransaction(async tx => {
      const [doc, settingsDoc] = await tx.getMany([requestPath, aiPaths.settings(companyId)]);
      const loaded = await loadLedger(tx, companyId, settingsDoc ?? null, deps.now());
      if (refundCredits(loaded.ledger, chargeKey)) put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
      if (doc && doc.leaseHolder === token) tx.update(requestPath, { leaseHolder: "", leaseUntil: null });
    });
  } catch {
    // The lease expires on its own after LEASE_MS.
  }
}
