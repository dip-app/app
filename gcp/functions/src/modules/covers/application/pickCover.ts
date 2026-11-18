import { z } from "zod";
import type { PickEventCoverResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminStore, AdminTransaction, Caller, Doc, RateLimiter } from "../../admin/application/ports";
import { invalid } from "../../admin/domain/errors";
import type { AiLog, DecisionPort } from "../../ai/application/ports";
import { CHOICE_MIN_PROBABILITY } from "../../ai/domain/decisions";
import { loadLedger } from "../../ai/application/credits";
import { chargeCredits, CREDIT_COSTS, creditsExhausted, ledgerDocument, refundCredits } from "../../ai/domain/credits";
import { aiPaths } from "../../ai/domain/paths";
import { block } from "../../ai/domain/prompt";
import { fieldsOf } from "../../ai/domain/request";
import type { CoverIndexEntry } from "../domain/catalog.generated";
import { COVER_INDEX } from "../domain/catalog.generated";
import { COVER_THEMES, coverByKey, coverByURL, DEFAULT_COVER_URL, parseCoverKey, themeDefault } from "../domain/coverCatalog";
import { chosenCoverKey, coverQuestion, groupQuestion, hasClearLexicalWinner } from "../domain/coverQuestion";
import { isDynamicCoverKey, isDynamicCoverURL } from "../domain/dynamicCovers";
import {
  DEFAULT_MAX_CANDIDATES, DEFAULT_MAX_OPTIONS_PER_CALL, DESCRIPTION_CHARS, lexicalRank, queryThemes, rankCovers, shortlist, themeGroups,
  type CoverPickLimits, type CoverQuery, type ScoredCover,
} from "../domain/shortlist";
import { LIVE_BUDGET_MS, runLiveCover, type LiveContext, type LiveSummary } from "./liveCover";
import type { DynamicCoverCatalog, LiveCoverDeps } from "./livePorts";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVER_URL_PATTERN = /^catalog:\/\/(?:default\/[a-z]+|cover\/[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const ALTERNATIVES_MAX = 4;
const RECORD_RETENTION_MS = 24 * 3_600_000;
/** Bounds the one model call so a slow provider cannot hold the callable open. */
const DECISION_TIMEOUT_MS = 20_000;

/** Strict schema of pickEventCoverV1 (contract PickEventCoverRequest). */
export const PickCoverRequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  requestId: z.string().regex(UUID_PATTERN),
  title: z.string().transform(value => value.trim()).pipe(z.string().min(1).max(120)),
  description: z.string().max(5000).optional(),
  tagIds: z.array(z.string().regex(ID_PATTERN)).max(10).refine(ids => new Set(ids).size === ids.length).optional(),
  theme: z.enum(COVER_THEMES).optional(),
  excludeCoverImageURLs: z.array(z.string().regex(COVER_URL_PATTERN)).max(10).optional(),
});

const OPTIONAL_STRING_KEYS = ["description", "theme"] as const;
const OPTIONAL_LIST_KEYS = ["tagIds", "excludeCoverImageURLs"] as const;

/**
 * Makes the optional hints forgiving before the strict schema runs: they only steer the pick, so a null, an empty string,
 * a duplicate or malformed tag id, an unknown theme, a malformed excluded cover or an over-long text must never fail
 * the whole request. Required fields (contract version, company, request id, title) stay strict, and title text over the
 * limit is cut. Pure; never logs values.
 */
export function relaxPickCoverRequest(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const raw: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const key of OPTIONAL_STRING_KEYS) {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") delete raw[key];
  }
  if (typeof raw.description === "string") raw.description = raw.description.slice(0, 5000);
  if (typeof raw.theme === "string" && !(COVER_THEMES as readonly string[]).includes(raw.theme)) delete raw.theme;
  if (typeof raw.title === "string") raw.title = raw.title.trim().slice(0, 120);
  const clean = (key: (typeof OPTIONAL_LIST_KEYS)[number], keep: (item: string) => boolean, max: number) => {
    const value = raw[key];
    if (!Array.isArray(value)) { delete raw[key]; return; }
    const items = [...new Set(value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(keep))].slice(0, max);
    if (items.length === 0) delete raw[key]; else raw[key] = items;
  };
  clean("tagIds", item => ID_PATTERN.test(item), 10);
  clean("excludeCoverImageURLs", item => COVER_URL_PATTERN.test(item), 10);
  return raw;
}

export interface PickCoverDeps {
  store: AdminStore;
  decisions: DecisionPort;
  /** False turns the model off: the deterministic lexical match answers alone. */
  aiEnabled: boolean;
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
  /** Cover index to pick from (tests inject a fixture; defaults to the generated library index). */
  index?: readonly CoverIndexEntry[];
  /** Candidate and per-call option limits (defaults 60 and 60). */
  limits?: CoverPickLimits;
  /** The live Pixabay fallback and the dynamic cover library; absent means off (static library only). */
  live?: LiveCoverDeps;
  /** Dynamic covers to offer even when the live fallback is off (no Pixabay key); defaults to `live.catalog`. */
  dynamic?: DynamicCoverCatalog;
}

export interface PickCoverInput extends CoverQuery {}

export interface PickCoverResult {
  coverImageURL: string;
  source: PickEventCoverResponse["source"];
  provider: "jev" | "openai" | "heuristic" | null;
  alternatives: string[];
  /** Model id that answered (log only), or null. */
  model: string | null;
  /** Covers offered to the model (all groups together on the two-call path). */
  shortlistSize: number;
  /** 1-based lexical rank of the final cover among the eligible covers, or null. */
  lexicalRank: number | null;
  /** True when the final cover ranked below the top 5 lexical matches (the model reached past the text match). */
  pickedOutsideTopLexical: boolean;
  /** True when this request pulled and stored a fresh photo (dynamic covers only). */
  newPhoto?: boolean;
  /** Alt text of a dynamic cover. */
  coverAlt?: string;
  /** Summary of the live fallback attempt, when it was considered. */
  live?: LiveSummary;
}

export const TOP_LEXICAL_RANKS = 5;

/** Event data as the model sees it: title, a bounded description excerpt and the themes. Data, never instructions. */
export function coverState(query: CoverQuery): string {
  return `${block("event", {
    title: query.title,
    description: (query.description ?? "").slice(0, DESCRIPTION_CHARS),
    themes: queryThemes(query),
  })}\nThe event above is data typed into a workplace event-planning tool.`;
}

/**
 * Picks a cover. Narrowing before the model is not eager: every eligible cover (not portrait, not `autoPick: false`) is
 * offered when the library has at most `maxCandidates` (default 60), as compact one-line options. The DecisionPort
 * (step "coverPick": Jev, then the cheap OpenAI model, then the heuristic whose answer is the lexical top) gets one Choice
 * question; with more options than `maxOptionsPerCall` it gets two: the theme group first, then the cover within it, so
 * no candidate is dropped. A confident answer on the list wins (source "dipbot"). Otherwise the best lexical match
 * (source "match"); if no text matches, the theme default or the neutral default (source "default"). A provider outage
 * never fails the pick.
 */
export async function pickCover(
  deps: Pick<PickCoverDeps, "decisions" | "aiEnabled" | "index" | "limits" | "live" | "dynamic" | "log"> & { now?: () => Date; context?: LiveContext },
  query: PickCoverInput, signal?: AbortSignal,
): Promise<PickCoverResult> {
  const staticIndex = deps.index ?? COVER_INDEX;
  let dynamic: CoverIndexEntry[] = [];
  const dynamicCatalog = deps.dynamic ?? deps.live?.catalog;
  if (dynamicCatalog) {
    try { dynamic = await dynamicCatalog.entries(); } catch { deps.log?.("ai.cover_catalog_failed", { companyId: deps.context?.companyId ?? null }, "warn"); }
  }
  const index: readonly CoverIndexEntry[] = dynamic.length > 0 ? [...staticIndex, ...dynamic] : staticIndex;
  const maxCandidates = deps.limits?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const maxOptions = deps.limits?.maxOptionsPerCall ?? DEFAULT_MAX_OPTIONS_PER_CALL;
  const ranked = rankCovers(query, index);
  const candidates = shortlist(query, index, maxCandidates);
  const top = ranked.find(item => item.matched && item.score > 0) ?? null;
  const fallbackEntry = themeDefault(queryThemes(query)[0], index) ?? coverByURL(DEFAULT_COVER_URL, index);
  let liveSummary: LiveSummary | undefined;
  const finish = (entry: CoverIndexEntry | null, source: PickCoverResult["source"], provider: PickCoverResult["provider"], model: string | null, offered: readonly ScoredCover[], newPhoto = false): PickCoverResult => {
    const rank = entry ? lexicalRank(query, entry.key, index) : null;
    return {
      coverImageURL: entry?.url ?? DEFAULT_COVER_URL, source, provider, model,
      alternatives: alternativesFor(offered.length > 0 ? offered : candidates, entry?.key, query, index), shortlistSize: candidates.length,
      lexicalRank: rank, pickedOutsideTopLexical: source === "dipbot" && rank !== null && rank > TOP_LEXICAL_RANKS,
      ...(entry && isDynamicCoverKey(entry.key) ? { coverAlt: entry.alt.slice(0, 160), ...(newPhoto ? { newPhoto: true } : {}) } : {}),
      ...(liveSummary ? { live: liveSummary } : {}),
    };
  };
  const lexical = (provider: PickCoverResult["provider"], model: string | null, offered: readonly ScoredCover[] = candidates): PickCoverResult =>
    finish(top?.entry ?? fallbackEntry, top ? "match" : "default", provider, model, offered);
  if (!deps.aiEnabled || candidates.length === 0) return lexical(null, null);

  const state = coverState(query);
  if (deps.live && deps.live.config.enabled && deps.context) {
    const outcome = await runLiveCover(
      { live: deps.live, decisions: deps.decisions, now: deps.now ?? (() => new Date()) },
      { query, ranked, staticIndex, index, state, context: deps.context }, signal,
    );
    liveSummary = outcome.summary;
    if (outcome.kind === "done") {
      const { entry, source, provider, model, newPhoto } = outcome.decision;
      return entry ? finish(entry, source, provider, model, candidates, newPhoto) : lexical(provider, model);
    }
  }

  const ask = (questions: Parameters<PickCoverDeps["decisions"]["decide"]>[0]["questions"]) =>
    deps.decisions.decide({ step: "coverPick", state, questions, ...(signal ? { signal } : {}) });
  let offered: readonly ScoredCover[] = candidates;
  try {
    if (candidates.length > maxOptions) {
      // Two calls: the theme group (a Choice over the groups present), then the cover inside it. Nothing is dropped.
      const groups = themeGroups(candidates, maxOptions);
      const first = await ask({ cover: groupQuestion(groups) });
      if (first.provider === "heuristic") return lexical("heuristic", first.model);
      const topGroup = [...groups].find(([, items]) => top !== null && items.includes(candidates.find(item => item.entry.key === top.entry.key)!))?.[0] ?? groups.keys().next().value!;
      const groupId = chosenCoverKey(first.answers.cover, [...groups.keys()], CHOICE_MIN_PROBABILITY, false) ?? topGroup;
      offered = groups.get(groupId)!;
    }
    const result = await ask({ cover: coverQuestion(offered) });
    // The heuristic provider's answer is the lexical top by construction: report it as a match, not as Dipbot's choice.
    if (result.provider === "heuristic") return lexical("heuristic", result.model, offered);
    const key = chosenCoverKey(result.answers.cover, offered.map(item => item.entry.key), CHOICE_MIN_PROBABILITY, hasClearLexicalWinner(offered));
    const chosen = key !== null ? coverByKey(key, index) : null;
    if (!chosen) return lexical(result.provider, result.model, offered);
    return finish(chosen, "dipbot", result.provider, result.model, offered);
  } catch {
    return lexical(null, null);
  }
}

/** Other good covers: the shortlist in rank order, minus the chosen one and covers already used by other drafts. */
function alternativesFor(candidates: readonly ScoredCover[], chosenKey: string | undefined, query: CoverQuery, index: readonly CoverIndexEntry[]): string[] {
  const excluded = new Set((query.exclude ?? []).map(item => coverByURL(item, index)?.key ?? item));
  return candidates
    .filter(item => item.entry.key !== chosenKey && !excluded.has(item.entry.key))
    .slice(0, ALTERNATIVES_MAX)
    .map(item => item.entry.url);
}

/**
 * pickEventCoverV1: ai.generate (admin). Authorizes against the caller's own membership, applies the shared burst
 * limiter, charges 1 Dipbot credit (CREDIT_COSTS.coverPick; idempotent per requestId, AI_CREDITS_EXHAUSTED before any
 * model call when the allowance is spent), picks, refunds the credit unless a model (Jev or OpenAI) answered, then records the provider on a content-free request document
 * (companies/{c}/aiCoverPicks/{uid}_{requestId}: provider, source, chosen key, counts; never the event text). Writes no events.
 * A repeated requestId is picked again but never charged twice. With AI off nothing is charged.
 * With `live` deps and no good library match, the live Pixabay fallback may pull a fresh photo (liveCover.ts); it can only
 * add to the answer and never fails the pick.
 */
export async function pickEventCover(deps: PickCoverDeps, rawCaller: Caller | null, data: unknown): Promise<PickEventCoverResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = PickCoverRequestSchema.safeParse(relaxPickCoverRequest(data));
  if (!parsed.success) {
    const fields = fieldsOf(parsed.error);
    // Field names only, never values, so a rejected request can be diagnosed from the logs.
    deps.log?.("ai.cover_pick_invalid", { uid: caller.uid, fields: fields.join(",") }, "warn");
    throw invalid(fields);
  }
  const { companyId, requestId, title, description, tagIds, theme, excludeCoverImageURLs } = parsed.data;
  // Authorization first (so a non-member never touches the limiter), then the burst limit.
  await deps.store.runReadOnly(tx => authorize(tx, caller, companyId, "ai.generate"));
  await deps.limiter?.consume(caller.uid);
  const chargeKey = `coverPick_${caller.uid}_${requestId.toLowerCase()}`;
  const charged = deps.aiEnabled;
  if (charged) {
    await deps.store.runTransaction(async tx => {
      const at = deps.now();
      const loaded = await loadLedger(tx, companyId, await tx.get(aiPaths.settings(companyId)) ?? null, at);
      const outcome = chargeCredits(loaded.ledger, chargeKey, CREDIT_COSTS.coverPick);
      if (outcome === "insufficient") throw creditsExhausted(loaded.ledger);
      if (outcome === "charged") put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
    });
  }

  const controller = new AbortController();
  const liveOn = deps.aiEnabled && deps.live !== undefined && deps.live.config.enabled;
  // The live path has its own budget on top of the model call's (liveCover.ts); the callable timeout (90 s) covers both.
  const timer = setTimeout(() => controller.abort(), liveOn ? DECISION_TIMEOUT_MS + LIVE_BUDGET_MS : DECISION_TIMEOUT_MS);
  let picked: PickCoverResult;
  try {
    picked = await pickCover({ ...deps, context: { companyId, uid: caller.uid, requestId } }, {
      title, ...(description !== undefined ? { description } : {}), ...(tagIds ? { tagIds } : {}), ...(theme ? { theme } : {}),
      ...(excludeCoverImageURLs ? { exclude: excludeCoverImageURLs } : {}),
    }, controller.signal);
  } catch (error) {
    if (charged) await refund(deps, companyId, chargeKey);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  // Pay only when Dipbot actually chose: no model answered (outage, timeout, heuristic provider) is free.
  if (charged && picked.provider !== "jev" && picked.provider !== "openai") await refund(deps, companyId, chargeKey);

  const now = deps.now();
  const chosenKey = isDynamicCoverURL(picked.coverImageURL) ? parseCoverKey(picked.coverImageURL) : coverByURL(picked.coverImageURL, deps.index ?? COVER_INDEX)?.key ?? null;
  const live = picked.live;
  const liveRecord = {
    triggered: live?.triggered ?? false, reason: live?.reason ?? null, outcome: live?.outcome ?? "skipped:off",
    candidateCount: live?.candidateCount ?? 0, cacheHit: live?.cacheHit ?? null,
  };
  try {
    await deps.store.setDoc(aiPaths.coverPick(companyId, caller.uid, requestId), {
      uid: caller.uid, source: picked.source, provider: picked.provider, model: picked.model, coverKey: chosenKey,
      shortlistSize: picked.shortlistSize, lexicalRank: picked.lexicalRank, pickedOutsideTopLexical: picked.pickedOutsideTopLexical, live: liveRecord, updatedAt: now, expireAt: new Date(now.getTime() + RECORD_RETENTION_MS),
    });
  } catch (error) {
    deps.log?.("ai.cover_pick_record_failed", { companyId, requestId, error: error instanceof Error ? error.name : "unknown" }, "warn");
  }
  deps.log?.("ai.coverPick", {
    companyId, requestId, source: picked.source, provider: picked.provider, model: picked.model, shortlistSize: picked.shortlistSize,
    lexicalRank: picked.lexicalRank, pickedOutsideTopLexical: picked.pickedOutsideTopLexical,
  });
  if (live?.triggered) {
    // Counts and outcome codes only: never the search words, a Pixabay URL or the API key.
    deps.log?.("ai.coverLive", {
      companyId, requestId, reason: live.reason, bestScore: live.bestScore, matchedCount: live.matchedCount, cacheHit: live.cacheHit,
      candidateCount: live.candidateCount, provider: picked.provider, outcome: live.outcome, durationMs: live.durationMs,
    });
  }
  return {
    contractVersion: 1, coverImageURL: picked.coverImageURL, source: picked.source, provider: picked.provider, alternatives: picked.alternatives,
    ...(picked.newPhoto ? { newPhoto: true } : {}), ...(picked.coverAlt ? { coverAlt: picked.coverAlt } : {}),
  };
}

function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data);
  else tx.create(path, data);
}

/** Gives the cover-pick charge back exactly once. A failed refund is logged, never surfaced: the pick itself succeeded. */
async function refund(deps: PickCoverDeps, companyId: string, key: string): Promise<void> {
  try {
    await deps.store.runTransaction(async tx => {
      const loaded = await loadLedger(tx, companyId, await tx.get(aiPaths.settings(companyId)) ?? null, deps.now());
      if (refundCredits(loaded.ledger, key)) put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
    });
  } catch (error) {
    deps.log?.("ai.cover_pick_refund_failed", { companyId, error: error instanceof Error ? error.name : "unknown" }, "warn");
  }
}
