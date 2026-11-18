import { z } from "zod";
import type { ImportCoverPhotoResponse, SearchCoverPhotosResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminStore, Caller, RateLimiter } from "../../admin/application/ports";
import { AdminError, invalid } from "../../admin/domain/errors";
import type { AiLog } from "../../ai/application/ports";
import { fieldsOf } from "../../ai/domain/request";
import { COVER_INDEX } from "../domain/catalog.generated";
import { dynamicCoverURL, DYNAMIC_KEY_PATTERN, dynamicKeyFor, pixabayIdOfKey, staticPixabayIds } from "../domain/dynamicCovers";
import { isAllowedPixabayImageURL } from "../domain/imageGuards";
import { liveCandidates } from "../domain/liveFallback";
import { buildPixabayQuery, coverVocabulary } from "../domain/liveQuery";
import { hitTags } from "../domain/pixabayRules";
import { materializeCover } from "./liveCover";
import { PixabayRateLimitedError, type LiveCoverDeps, type PixabayHit } from "./livePorts";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 12;
const MAX_TAGS = 8;
const SEARCH_BUDGET_MS = 20_000;
const IMPORT_BUDGET_MS = 40_000;

/** Strict schema of searchCoverPhotosV1 (contract SearchCoverPhotosRequest). */
export const SearchCoverPhotosRequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  requestId: z.string().regex(UUID_PATTERN),
  query: z.string().transform(value => value.trim()).pipe(z.string().min(1).max(60)),
});

/** Strict schema of importCoverPhotoV1 (contract ImportCoverPhotoRequest): the client names a key, never a URL. */
export const ImportCoverPhotoRequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  requestId: z.string().regex(UUID_PATTERN),
  key: z.string().regex(DYNAMIC_KEY_PATTERN),
});

export interface SearchCoverDeps {
  store: AdminStore;
  /** AI_EVENTS_ENABLED; the feature is off (COVER_SEARCH_UNAVAILABLE) without it. */
  aiEnabled: boolean;
  /** The live Pixabay deps; absent (no key, demo provider, fallback disabled) means unavailable. */
  live?: LiveCoverDeps;
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
}

const unavailable = () => new AdminError("failed-precondition", "COVER_SEARCH_UNAVAILABLE", "More cover photos are not available right now.");

let vocabulary: Set<string> | null = null;

/** Authorization (ai.generate, own company), the shared burst limit, then the feature switch. */
async function gate(deps: SearchCoverDeps, caller: Caller, companyId: string): Promise<LiveCoverDeps> {
  await deps.store.runReadOnly(tx => authorize(tx, caller, companyId, "ai.generate"));
  await deps.limiter?.consume(caller.uid);
  if (!deps.aiEnabled || !deps.live || !deps.live.config.enabled) throw unavailable();
  return deps.live;
}

/**
 * searchCoverPhotosV1: the admin's own search text (treated as a title, PII-stripped like the live fallback's query) finds
 * up to 12 Pixabay photos to preview. Free (no credits); a Pixabay call counts against the live daily quotas only on a cache
 * miss. The shown hits are remembered for 24 hours so importCoverPhotoV1 can only fetch API-returned photos. Pixabay
 * failures never throw: they come back as a status.
 */
export async function searchCoverPhotos(deps: SearchCoverDeps, rawCaller: Caller | null, data: unknown): Promise<SearchCoverPhotosResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = SearchCoverPhotosRequestSchema.safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  const { companyId, requestId, query } = parsed.data;
  const live = await gate(deps, caller, companyId);
  const started = Date.now();
  let cacheHit: boolean | null = null;
  const finish = (status: SearchCoverPhotosResponse["status"], candidates: SearchCoverPhotosResponse["candidates"] = []): SearchCoverPhotosResponse => {
    deps.log?.("ai.coverSearch", { companyId, requestId, status, cacheHit, candidateCount: candidates.length, durationMs: Date.now() - started });
    return { contractVersion: 1, candidates, status };
  };

  vocabulary ??= coverVocabulary(COVER_INDEX);
  const built = buildPixabayQuery({ title: query }, vocabulary);
  if (!built) return finish("ok");
  const now = deps.now();
  const normalized = built.words.join(" ");
  try {
    let hits = await live.cache.get(normalized, now).catch(() => null);
    cacheHit = hits !== null;
    if (hits === null) {
      const denial = await live.quota.tryConsume(companyId, now);
      if (denial) return finish(denial === "instance_rate" ? "rate_limited" : "quota");
      hits = await live.search.search(built.q, AbortSignal.timeout(SEARCH_BUDGET_MS));
      await live.cache.put(normalized, hits, now).catch(() => undefined);
    }
    const shown = liveCandidates(hits.filter(hit => isAllowedPixabayImageURL(hit.webformatURL)), built.words, {
      excludeIds: staticPixabayIds(COVER_INDEX), max: MAX_CANDIDATES,
    });
    if (shown.length === 0) return finish("ok");
    if (!live.cache.rememberCandidates) return finish("unavailable");
    await live.cache.rememberCandidates(shown, now);
    const candidates = await Promise.all(shown.map(async hit => ({
      key: dynamicKeyFor(hit.id), previewURL: hit.webformatURL, tags: hitTags(hit).slice(0, MAX_TAGS), width: hit.imageWidth, height: hit.imageHeight,
      stored: await Promise.resolve(live.catalog.has(dynamicKeyFor(hit.id))).catch(() => false),
    })));
    return finish("ok", candidates);
  } catch (error) {
    return finish(error instanceof PixabayRateLimitedError ? "rate_limited" : "unavailable");
  }
}

/**
 * importCoverPhotoV1: stores a photo the admin picked from the search results as a dynamic cover. The client sends only the
 * key; the hit must have been remembered by a search within the last 24 hours, so no client-supplied URL is ever fetched. An
 * existing active stored cover is reused without a download.
 */
export async function importCoverPhoto(deps: SearchCoverDeps, rawCaller: Caller | null, data: unknown): Promise<ImportCoverPhotoResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = ImportCoverPhotoRequestSchema.safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  const { companyId, requestId, key } = parsed.data;
  const live = await gate(deps, caller, companyId);
  const id = pixabayIdOfKey(key);
  const hit: PixabayHit | null = id !== null && live.cache.candidate ? await live.cache.candidate(id, deps.now()).catch(() => null) : null;
  if (!hit) throw new AdminError("not-found", "COVER_CANDIDATE_EXPIRED", "That photo is no longer available. Search again.");
  try {
    const stored = await materializeCover({ live, now: deps.now }, hit, { companyId, uid: caller.uid, themes: [], staticIndex: COVER_INDEX }, AbortSignal.timeout(IMPORT_BUDGET_MS));
    deps.log?.("ai.coverImport", { companyId, requestId, outcome: stored.stored ? "stored" : "reused" });
    return { contractVersion: 1, coverImageURL: dynamicCoverURL(stored.doc.key), coverAlt: stored.doc.alt.slice(0, 160), newPhoto: stored.stored };
  } catch (error) {
    deps.log?.("ai.coverImport", { companyId, requestId, outcome: "failed", error: error instanceof Error ? error.name : "unknown" }, "warn");
    throw new AdminError("unavailable", "COVER_IMPORT_FAILED", "The photo could not be imported. Try another one.");
  }
}
