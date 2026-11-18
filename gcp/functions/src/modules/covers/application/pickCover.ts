import { z } from "zod";
import type { PickEventCoverResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminStore, Caller, RateLimiter } from "../../admin/application/ports";
import { invalid } from "../../admin/domain/errors";
import type { AiLog, DecisionPort } from "../../ai/application/ports";
import { CHOICE_MIN_PROBABILITY } from "../../ai/domain/decisions";
import { aiPaths } from "../../ai/domain/paths";
import { block } from "../../ai/domain/prompt";
import { fieldsOf } from "../../ai/domain/request";
import type { CoverIndexEntry } from "../domain/catalog.generated";
import { COVER_INDEX } from "../domain/catalog.generated";
import { COVER_THEMES, coverByKey, coverByURL, DEFAULT_COVER_URL, themeDefault } from "../domain/coverCatalog";
import { chosenCoverKey, coverQuestion, groupQuestion, hasClearLexicalWinner } from "../domain/coverQuestion";
import {
  DEFAULT_MAX_CANDIDATES, DEFAULT_MAX_OPTIONS_PER_CALL, DESCRIPTION_CHARS, lexicalRank, lexicalTop, queryThemes, shortlist, themeGroups,
  type CoverPickLimits, type CoverQuery, type ScoredCover,
} from "../domain/shortlist";

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

/**
 * Optional per-action charging hook for a future credits system. Nothing is charged by default; when a deployment
 * supplies one, it runs after authorization and rate limiting and before any provider call, and may throw to refuse.
 */
export interface CoverCredits {
  charge(caller: Caller, action: "coverPick"): Promise<void>;
}

export interface PickCoverDeps {
  store: AdminStore;
  decisions: DecisionPort;
  /** False turns the model off: the deterministic lexical match answers alone. */
  aiEnabled: boolean;
  limiter?: RateLimiter;
  credits?: CoverCredits;
  log?: AiLog;
  now: () => Date;
  /** Cover index to pick from (tests inject a fixture; defaults to the generated library index). */
  index?: readonly CoverIndexEntry[];
  /** Candidate and per-call option limits (defaults 60 and 60). */
  limits?: CoverPickLimits;
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
  deps: Pick<PickCoverDeps, "decisions" | "aiEnabled" | "index" | "limits">, query: PickCoverInput, signal?: AbortSignal,
): Promise<PickCoverResult> {
  const index = deps.index ?? COVER_INDEX;
  const maxCandidates = deps.limits?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const maxOptions = deps.limits?.maxOptionsPerCall ?? DEFAULT_MAX_OPTIONS_PER_CALL;
  const candidates = shortlist(query, index, maxCandidates);
  const top = lexicalTop(query, index);
  const fallbackEntry = themeDefault(queryThemes(query)[0], index) ?? coverByURL(DEFAULT_COVER_URL, index);
  const finish = (entry: CoverIndexEntry | null, source: PickCoverResult["source"], provider: PickCoverResult["provider"], model: string | null, offered: readonly ScoredCover[]): PickCoverResult => {
    const rank = entry ? lexicalRank(query, entry.key, index) : null;
    return {
      coverImageURL: entry?.url ?? DEFAULT_COVER_URL, source, provider, model,
      alternatives: alternativesFor(offered.length > 0 ? offered : candidates, entry?.key, query, index), shortlistSize: candidates.length,
      lexicalRank: rank, pickedOutsideTopLexical: source === "dipbot" && rank !== null && rank > TOP_LEXICAL_RANKS,
    };
  };
  const lexical = (provider: PickCoverResult["provider"], model: string | null, offered: readonly ScoredCover[] = candidates): PickCoverResult =>
    finish(top?.entry ?? fallbackEntry, top ? "match" : "default", provider, model, offered);
  if (!deps.aiEnabled || candidates.length === 0) return lexical(null, null);

  const state = coverState(query);
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
 * limiter, runs the optional credits hook, picks, then records the provider on a content-free request document
 * (companies/{c}/aiCoverPicks/{uid}_{requestId}: provider, source, chosen key, counts; never the event text). Writes no events.
 * A repeated requestId is simply picked again (nothing is charged or reserved).
 */
export async function pickEventCover(deps: PickCoverDeps, rawCaller: Caller | null, data: unknown): Promise<PickEventCoverResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = PickCoverRequestSchema.safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  const { companyId, requestId, title, description, tagIds, theme, excludeCoverImageURLs } = parsed.data;
  // Authorization first (so a non-member never touches the limiter), then the burst limit.
  await deps.store.runReadOnly(tx => authorize(tx, caller, companyId, "ai.generate"));
  await deps.limiter?.consume(caller.uid);
  await deps.credits?.charge(caller, "coverPick");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS);
  let picked: PickCoverResult;
  try {
    picked = await pickCover(deps, {
      title, ...(description !== undefined ? { description } : {}), ...(tagIds ? { tagIds } : {}), ...(theme ? { theme } : {}),
      ...(excludeCoverImageURLs ? { exclude: excludeCoverImageURLs } : {}),
    }, controller.signal);
  } finally {
    clearTimeout(timer);
  }

  const now = deps.now();
  const chosenKey = coverByURL(picked.coverImageURL, deps.index ?? COVER_INDEX)?.key ?? null;
  try {
    await deps.store.setDoc(aiPaths.coverPick(companyId, caller.uid, requestId), {
      uid: caller.uid, source: picked.source, provider: picked.provider, model: picked.model, coverKey: chosenKey,
      shortlistSize: picked.shortlistSize, lexicalRank: picked.lexicalRank, pickedOutsideTopLexical: picked.pickedOutsideTopLexical, updatedAt: now, expireAt: new Date(now.getTime() + RECORD_RETENTION_MS),
    });
  } catch (error) {
    deps.log?.("ai.cover_pick_record_failed", { companyId, requestId, error: error instanceof Error ? error.name : "unknown" }, "warn");
  }
  deps.log?.("ai.coverPick", {
    companyId, requestId, source: picked.source, provider: picked.provider, model: picked.model, shortlistSize: picked.shortlistSize,
    lexicalRank: picked.lexicalRank, pickedOutsideTopLexical: picked.pickedOutsideTopLexical,
  });
  return { contractVersion: 1, coverImageURL: picked.coverImageURL, source: picked.source, provider: picked.provider, alternatives: picked.alternatives };
}
