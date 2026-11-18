import type { DecisionPort } from "../../ai/application/ports";
import { CHOICE_MIN_PROBABILITY } from "../../ai/domain/decisions";
import type { CoverIndexEntry } from "../domain/catalog.generated";
import { coverByKey } from "../domain/coverCatalog";
import { chosenCoverKey } from "../domain/coverQuestion";
import { dynamicCoverImagePath, dynamicKeyFor, staticPixabayIds, toIndexEntry } from "../domain/dynamicCovers";
import { deterministicLivePick, liveCandidates, liveQuestion, liveTrigger, type LiveTriggerReason } from "../domain/liveFallback";
import { buildPixabayQuery, coverVocabulary, distinctiveTerms } from "../domain/liveQuery";
import { findNearDuplicate } from "../domain/nearDuplicate";
import { docFieldsFromHit, pixabayLicense } from "../domain/pixabayRules";
import { queryThemes, type CoverQuery, type ScoredCover } from "../domain/shortlist";
import {
  PixabayRateLimitedError, PixabayUnavailableError, type DynamicCoverDoc, type LiveCoverDeps, type PixabayHit,
} from "./livePorts";

/** Wall-clock budget of the search, download, processing and storing steps (the caller's own deadline still applies). */
export const LIVE_BUDGET_MS = 25_000;
/** Bounds the one model call of the live path. */
export const LIVE_DECISION_MS = 20_000;

export interface LiveContext { companyId: string; uid: string; requestId: string }

export interface LiveRunDeps { live: LiveCoverDeps; decisions: DecisionPort; now: () => Date }

export interface LiveInput {
  query: CoverQuery;
  /** Lexical ranking over the merged (static plus dynamic) index. */
  ranked: readonly ScoredCover[];
  /** The generated static index: vocabulary, Pixabay-id dedupe and theme voting use it, never the dynamic covers. */
  staticIndex: readonly CoverIndexEntry[];
  /** Static plus dynamic entries (resolves a model answer naming an existing cover). */
  index: readonly CoverIndexEntry[];
  /** The `<event>` data block the model sees. */
  state: string;
  context: LiveContext;
}

/** Content-free summary of one live attempt (logged and stored on the request record; no query text, URLs or keys). */
export interface LiveSummary {
  triggered: boolean;
  reason: LiveTriggerReason | null;
  bestScore: number;
  matchedCount: number;
  cacheHit: boolean | null;
  candidateCount: number;
  /** stored | reused | static | skipped:<why> | failed:<code> */
  outcome: string;
  durationMs: number;
}

export interface LiveDecision {
  /** The chosen cover, or null for "use the normal lexical result" (the model, if any, already answered). */
  entry: CoverIndexEntry | null;
  source: "dipbot" | "match";
  provider: "jev" | "openai" | "heuristic" | null;
  model: string | null;
  /** True only when this request stored a fresh photo. */
  newPhoto: boolean;
}

/** `continue`: nothing decided, run the normal static pick (the model was not consulted). `done`: the answer is final. */
export type LiveOutcome = { kind: "continue"; summary: LiveSummary } | { kind: "done"; decision: LiveDecision; summary: LiveSummary };

const vocabularies = new WeakMap<readonly CoverIndexEntry[], Set<string>>();
const vocabularyOf = (index: readonly CoverIndexEntry[]): Set<string> => {
  let found = vocabularies.get(index);
  if (!found) { found = coverVocabulary(index); vocabularies.set(index, found); }
  return found;
};

const withTimeout = (signal: AbortSignal | undefined, ms: number): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

/** Short, content-free failure code. */
function failureCode(error: unknown): string {
  if (error instanceof PixabayRateLimitedError) return "rate_limited";
  if (error instanceof PixabayUnavailableError) return error.reason.replace(/[^a-z0-9_]/gi, "_").slice(0, 40) || "unavailable";
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "timeout";
  return "error";
}

class Removed extends Error { constructor() { super("removed"); this.name = "RemovedCover"; } }

interface Materialized { doc: Pick<DynamicCoverDoc, "key" | "themes" | "tags" | "label" | "alt">; stored: boolean }

/**
 * The live path of "Let Dipbot choose": when the library has no good match, search Pixabay (cached, quota-limited),
 * let the model choose among a few candidates and the best covers, store the chosen photo and answer with it. Every
 * failure yields a `continue` outcome (or a final lexical answer once the model has answered); this function never throws.
 */
export async function runLiveCover(deps: LiveRunDeps, input: LiveInput, signal?: AbortSignal): Promise<LiveOutcome> {
  const started = Date.now();
  const { live } = deps;
  const trigger = liveTrigger(input.ranked, live.config, distinctiveTerms(input.query, vocabularyOf(input.staticIndex)));
  const summary: LiveSummary = {
    triggered: trigger.trigger, reason: trigger.reason, bestScore: trigger.bestScore, matchedCount: trigger.matchedCount,
    cacheHit: null, candidateCount: 0, outcome: "skipped:not_triggered", durationMs: 0,
  };
  const seal = (label: string): LiveSummary => ({ ...summary, outcome: label, durationMs: Date.now() - started });
  const cont = (label: string): LiveOutcome => ({ kind: "continue", summary: seal(label) });
  const done = (decision: LiveDecision, label: string): LiveOutcome => ({ kind: "done", decision, summary: seal(label) });
  if (!trigger.trigger) return cont("skipped:not_triggered");

  try {
    const built = buildPixabayQuery(input.query, vocabularyOf(input.staticIndex));
    if (!built) return cont("skipped:no_query");
    const liveSignal = withTimeout(signal, LIVE_BUDGET_MS);
    const now = deps.now();
    const normalized = built.words.join(" ");

    let hits = await live.cache.get(normalized, now).catch(() => null);
    summary.cacheHit = hits !== null;
    if (hits === null) {
      const denial = await live.quota.tryConsume(input.context.companyId, now);
      if (denial) return cont(`skipped:${denial}`);
      hits = await live.search.search(built.q, liveSignal);
      await live.cache.put(normalized, hits, now).catch(() => undefined);
    }

    const candidates = liveCandidates(hits, built.words, { excludeIds: staticPixabayIds(input.staticIndex), max: live.config.maxCandidates });
    summary.candidateCount = candidates.length;
    if (candidates.length === 0) return cont("skipped:no_candidates");

    const question = liveQuestion(candidates, input.ranked.slice(0, 3));
    let result;
    try {
      result = await deps.decisions.decide({ step: "coverPick", state: input.state, questions: { cover: question }, signal: withTimeout(signal, LIVE_DECISION_MS) });
    } catch {
      return done({ entry: null, source: "match", provider: null, model: null, newPhoto: false }, "failed:decision");
    }

    let chosen: PixabayHit | null;
    if (result.provider === "heuristic") {
      chosen = deterministicLivePick(candidates, built.words);
      if (!chosen) return done({ entry: null, source: "match", provider: "heuristic", model: result.model, newPhoto: false }, "static");
    } else {
      const key = chosenCoverKey(result.answers.cover, Object.keys(question.criteria as Record<string, string>), CHOICE_MIN_PROBABILITY, false);
      if (key === null) return done({ entry: null, source: "match", provider: result.provider, model: result.model, newPhoto: false }, "static");
      chosen = candidates.find(hit => dynamicKeyFor(hit.id) === key) ?? null;
      if (!chosen) {
        const entry = coverByKey(key, input.index);
        return done({ entry, source: entry ? "dipbot" : "match", provider: result.provider, model: result.model, newPhoto: false }, "static");
      }
    }
    try {
      const stored = await materialize(deps, chosen, input, liveSignal);
      return done({
        entry: toIndexEntry(stored.doc), source: result.provider === "heuristic" ? "match" : "dipbot", provider: result.provider,
        // A photo found beyond the library for this event (stored now or reused from an earlier pull) is announced either way.
        model: result.model, newPhoto: true,
      }, stored.stored ? "stored" : "reused");
    } catch (error) {
      // The model's pick could not be stored: answer from the library and report no model answer (the credit is refunded).
      return done({
        entry: null, source: "match", provider: result.provider === "heuristic" ? "heuristic" : null, model: null, newPhoto: false,
      }, `failed:${failureCode(error)}`);
    }
  } catch (error) {
    return cont(`failed:${failureCode(error)}`);
  }
}

/** Reuses the stored cover when it exists, otherwise downloads, processes, de-duplicates and stores the photo. */
async function materialize(deps: LiveRunDeps, hit: PixabayHit, input: LiveInput, signal: AbortSignal): Promise<Materialized> {
  const { live } = deps;
  const key = dynamicKeyFor(hit.id);
  const reuse = async (existing: DynamicCoverDoc | null): Promise<Materialized> => {
    if (!existing) throw new PixabayUnavailableError("missing");
    if (existing.status !== "active") throw new Removed();
    await live.writer.touch(existing.key, deps.now());
    return { doc: existing, stored: false };
  };

  const existing = await live.catalog.get(key);
  if (existing) return reuse(existing);

  const downloaded = await live.downloader.download(hit.largeImageURL, signal);
  const processed = await live.processor.process(downloaded);

  const duplicateKey = findNearDuplicate(processed.dHash, await live.catalog.hashes());
  if (duplicateKey) return reuse(await live.catalog.get(duplicateKey));

  const paths = await live.writer.putObjects(key, processed);
  const now = deps.now();
  const doc: DynamicCoverDoc = {
    key, status: "active", source: "pixabay", pixabayId: hit.id, pageURL: hit.pageURL, user: hit.user, userId: hit.user_id,
    license: pixabayLicense(hit), ...docFieldsFromHit(hit, queryThemes(input.query), input.staticIndex),
    width: processed.width, height: processed.height, dHash: processed.dHash, sha256: processed.sha256,
    bytes: { webp: processed.webp.length, jpeg: processed.jpeg.length }, storagePaths: paths, storedURL: dynamicCoverImagePath(key),
    createdAt: now, createdBy: { companyId: input.context.companyId, uid: input.context.uid }, usageCount: 1, lastUsedAt: now,
  };
  if (await live.writer.create(doc)) return { doc, stored: true };
  // A concurrent pick stored the same photo first.
  return reuse(await live.catalog.get(key));
}
