import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompanyOffice, FindVenuesResponse, VenueOption } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminStore, AdminTransaction, Caller, Doc, RateLimiter } from "../../admin/application/ports";
import { AdminError, invalid } from "../../admin/domain/errors";
import { loadLedger } from "../../ai/application/credits";
import type { AiLog, DecisionPort } from "../../ai/application/ports";
import { chargeCredits, CREDIT_COSTS, creditsExhausted, ledgerDocument, refundCredits } from "../../ai/domain/credits";
import { aiPaths, dayKey } from "../../ai/domain/paths";
import { fieldsOf } from "../../ai/domain/request";
import { deriveTypes } from "../domain/categories";
import { haversineMeters, METERS_PER_MILE, milesOf } from "../domain/geo";
import { officeOf } from "../domain/office";
import { capacityBucket, rankVenues, type RankedVenue } from "../domain/ranking";
import { applyVenueAnswer, MAX_OPTIONS, MAX_RESULTS, venueQuestion, venueState } from "../domain/venueQuestion";
import { MAX_RADIUS_METERS } from "../infrastructure/googlePlaces";
import type { LocationProvider } from "./ports";
import { consumePlacesQuota, DEFAULT_PLACES_DAILY_LIMIT, placesErrorCode } from "./quota";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_RADIUS_MILES = 5;
export const DEFAULT_DAILY_LIMIT = 40;
/** Nearby Search returns at most 20 places per call. */
export const SEARCH_LIMIT = 20;
const CACHE_TTL_MS = 24 * 3_600_000;
const USAGE_TTL_MS = 3 * 24 * 3_600_000;
const DECISION_TIMEOUT_MS = 20_000;

/** Strict schema of findVenuesV1 (contract FindVenuesRequest). */
export const FindVenuesRequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  requestId: z.string().regex(UUID_PATTERN),
  title: z.string().transform(value => value.trim()).pipe(z.string().min(1).max(120)),
  description: z.string().max(5000).optional(),
  tagIds: z.array(z.string().regex(ID_PATTERN)).max(10).refine(ids => new Set(ids).size === ids.length).optional(),
  isOutdoor: z.boolean().optional(),
  capacity: z.number().int().min(1).max(10000).optional(),
  costCents: z.number().int().min(0).max(10_000_000).optional(),
  radiusMiles: z.number().min(0.5).max(25).optional(),
});

/**
 * Makes the optional hints forgiving before the strict schema runs (they only steer the search): a null, a wrong type,
 * an out-of-range number, a malformed or duplicate tag id or an over-long text never fails the request. Required fields
 * stay strict; a title over the limit is cut. Pure; never logs values.
 */
export function relaxFindVenuesRequest(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const raw: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  if (typeof raw.description !== "string" || raw.description.trim() === "") delete raw.description;
  else raw.description = raw.description.slice(0, 5000);
  if (typeof raw.title === "string") raw.title = raw.title.trim().slice(0, 120);
  if (typeof raw.isOutdoor !== "boolean") delete raw.isOutdoor;
  const inRange = (key: string, min: number, max: number, integer: boolean) => {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) delete raw[key];
  };
  inRange("capacity", 1, 10000, true);
  inRange("costCents", 0, 10_000_000, true);
  inRange("radiusMiles", 0.5, 25, false);
  if (!Array.isArray(raw.tagIds)) delete raw.tagIds;
  else {
    const ids = [...new Set(raw.tagIds.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(item => ID_PATTERN.test(item)))].slice(0, 10);
    if (ids.length === 0) delete raw.tagIds; else raw.tagIds = ids;
  }
  return raw;
}

export interface FindVenuesDeps {
  store: AdminStore;
  decisions: DecisionPort;
  /** Null when no places provider is configured. */
  places: LocationProvider | null;
  /** The kill switch: AI_VENUES_ENABLED and PLACES_ENABLED (or the emulator demo). False fails with AI_VENUES_DISABLED. */
  enabled: boolean;
  /** Provider searches per company per UTC day (default 40). */
  dailyLimit?: number;
  /** Google Places calls per company per UTC day shared with typeahead (cached-venue re-fetches count here; default 400). */
  placesDailyLimit?: number;
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
}

type Provider = "jev" | "openai" | "heuristic" | null;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Cache key: office rounded to about 100 m, radius, normalized title, description hash, sorted tags and the buckets. */
export function searchCacheKey(office: CompanyOffice, radiusMiles: number, query: {
  title: string; description?: string | undefined; tagIds?: readonly string[] | undefined; isOutdoor?: boolean | undefined; capacity?: number | undefined; costCents?: number | undefined;
}): string {
  const cost = query.costCents === undefined ? "-" : query.costCents === 0 ? "free" : query.costCents <= 1500 ? "low" : query.costCents <= 5000 ? "medium" : "high";
  return sha(JSON.stringify([
    office.latitude.toFixed(3), office.longitude.toFixed(3), radiusMiles, query.title.trim().toLowerCase().replace(/\s+/g, " "),
    sha(query.description ?? ""), [...(query.tagIds ?? [])].sort(), query.isOutdoor ?? null,
    query.capacity === undefined ? "-" : capacityBucket(query.capacity), cost,
  ]));
}

function put(tx: AdminTransaction, path: string, existing: Doc | null, data: Doc): void {
  if (existing) tx.update(path, data); else tx.create(path, data);
}

async function refund(deps: FindVenuesDeps, companyId: string, key: string): Promise<void> {
  try {
    await deps.store.runTransaction(async tx => {
      const loaded = await loadLedger(tx, companyId, await tx.get(aiPaths.settings(companyId)) ?? null, deps.now());
      if (refundCredits(loaded.ledger, key)) put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
    });
  } catch (error) {
    deps.log?.("ai.venue_search_refund_failed", { companyId, error: error instanceof Error ? error.name : "unknown" }, "warn");
  }
}

/** What the 24 h cache keeps: place ids and derived ranking data only (Google's terms forbid storing names, addresses or coordinates). */
interface CachedRank { placeId: string; kind: VenueOption["kind"]; setting: VenueOption["setting"]; reasons: VenueOption["reasons"] }

function cachedRanks(value: unknown): CachedRank[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: CachedRank[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { placeId, kind, setting, reasons } = item as Record<string, unknown>;
    if (typeof placeId !== "string" || typeof kind !== "string" || typeof setting !== "string" || !Array.isArray(reasons)) return null;
    out.push({ placeId, kind: kind as CachedRank["kind"], setting: setting as CachedRank["setting"], reasons: reasons as CachedRank["reasons"] });
  }
  return out;
}

/** Re-fetches the cached ids (Place Details Pro, counted against the places daily cap). Null when any id is gone or a call fails: a cache miss. */
async function refetchCached(deps: FindVenuesDeps, companyId: string, office: CompanyOffice, ranks: readonly CachedRank[]): Promise<VenueOption[] | null> {
  await consumePlacesQuota(deps.store, companyId, deps.now(), deps.placesDailyLimit ?? DEFAULT_PLACES_DAILY_LIMIT, ranks.length);
  try {
    const places = await Promise.all(ranks.map(rank => deps.places!.details(rank.placeId, { tier: "pro" })));
    const out: VenueOption[] = [];
    for (const [index, place] of places.entries()) {
      const rank = ranks[index]!;
      if (!place || !place.name || place.placeId.length > 128) return null;
      out.push({
        id: place.placeId, placeId: place.placeId, name: place.name.slice(0, 120), address: place.address.slice(0, 200), locality: place.locality.slice(0, 120),
        latitude: place.latitude, longitude: place.longitude, kind: rank.kind, setting: rank.setting,
        distanceMiles: milesOf(haversineMeters(office.latitude, office.longitude, place.latitude, place.longitude)), website: null, reasons: rank.reasons,
      });
    }
    return out;
  } catch {
    deps.log?.("ai.venue_search_cache_refetch_failed", { companyId }, "warn");
    return null;
  }
}

/**
 * findVenuesV1: Dipbot venue finder (ai.generate, admin). Order: caller, strict parse, authorization against the caller's own
 * membership, the shared burst limiter, the kill switch, the office, the 24 h cache (free, no provider call), then the
 * daily provider-search cap and the credit charge in ONE transaction (so a refused search spends neither), the places search,
 * the heuristic ranking and one Jev/OpenAI ranking call. The credit is refunded unless a model ranked the results, and on any
 * failure. Only place types, the office coordinates and the radius reach Google; event text reaches only the
 * decision provider. Only model-ranked results are cached. Writes no events.
 */
export async function findVenues(deps: FindVenuesDeps, rawCaller: Caller | null, data: unknown): Promise<FindVenuesResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = FindVenuesRequestSchema.safeParse(relaxFindVenuesRequest(data));
  if (!parsed.success) {
    const fields = fieldsOf(parsed.error);
    deps.log?.("ai.venue_search_invalid", { uid: caller.uid, fields: fields.join(",") }, "warn");
    throw invalid(fields);
  }
  const { companyId, requestId, title, description, tagIds, isOutdoor, capacity, costCents } = parsed.data;
  const radiusMiles = parsed.data.radiusMiles ?? DEFAULT_RADIUS_MILES;
  await deps.store.runReadOnly(tx => authorize(tx, caller, companyId, "ai.generate"));
  await deps.limiter?.consume(caller.uid);
  if (!deps.enabled || !deps.places) throw new AdminError("failed-precondition", "AI_VENUES_DISABLED", "Venue search is not available right now.");
  const office = officeOf(await deps.store.getDoc(`companies/${companyId}`));
  if (!office) throw new AdminError("failed-precondition", "OFFICE_NOT_SET", "Set the office location before searching for venues.");

  const facts = { title, description, tagIds, isOutdoor, capacity, costCents };
  const now = deps.now();
  const cachePath = aiPaths.venueSearch(companyId, searchCacheKey(office, radiusMiles, facts));
  let cached: Doc | null = null;
  try { cached = await deps.store.getDoc(cachePath); } catch { deps.log?.("ai.venue_search_cache_read_failed", { companyId }, "warn"); }
  const ranks = cached && cached.expireAt instanceof Date && cached.expireAt.getTime() > now.getTime() ? cachedRanks(cached.ranked) : null;
  if (ranks) {
    const refreshed = await refetchCached(deps, companyId, office, ranks);
    if (refreshed) {
      const cachedProvider = typeof cached?.provider === "string" ? cached.provider : null;
      deps.log?.("ai.venueSearch", { companyId, requestId, cached: true, provider: cachedProvider, resultCount: refreshed.length, outcome: "cache_hit" });
      return { contractVersion: 1, venues: refreshed.slice(0, MAX_RESULTS), provider: cachedProvider, cached: true, charged: false, radiusMiles, office };
    }
  }

  const chargeKey = `venueSearch_${caller.uid}_${requestId.toLowerCase()}`;
  const limit = deps.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  await deps.store.runTransaction(async tx => {
    const usagePath = aiPaths.venueUsage(companyId, dayKey(now));
    const usage = await tx.get(usagePath);
    const count = typeof usage?.count === "number" ? usage.count : 0;
    if (count >= limit) throw new AdminError("resource-exhausted", "VENUE_SEARCH_LIMIT", "The daily venue search limit was reached. Try again tomorrow.");
    const loaded = await loadLedger(tx, companyId, await tx.get(aiPaths.settings(companyId)) ?? null, now);
    const outcome = chargeCredits(loaded.ledger, chargeKey, CREDIT_COSTS.venueSearch);
    if (outcome === "insufficient") throw creditsExhausted(loaded.ledger);
    if (outcome === "charged") put(tx, loaded.path, loaded.doc, ledgerDocument(loaded.ledger));
    put(tx, usagePath, usage, { count: count + 1, updatedAt: now, expireAt: new Date(now.getTime() + USAGE_TTL_MS) });
  });

  const derived = deriveTypes({ title, description, tagIds, isOutdoor });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS + 10_000);
  let venues: VenueOption[] = [];
  let ordered: RankedVenue[] = [];
  let provider: Provider = null;
  let candidateCount = 0;
  try {
    let candidates;
    try {
      candidates = await deps.places.searchNearby({
        latitude: office.latitude, longitude: office.longitude, radiusMeters: Math.min(MAX_RADIUS_METERS, Math.round(radiusMiles * METERS_PER_MILE)),
        includedTypes: derived.includedTypes, maxResults: SEARCH_LIMIT,
      }, controller.signal);
    } catch (error) {
      const code = placesErrorCode(error);
      deps.log?.("ai.venueSearch", { companyId, requestId, cached: false, provider: null, candidateCount: 0, resultCount: 0, outcome: `places_${code}` }, "warn");
      throw new AdminError("unavailable", "VENUES_UNAVAILABLE", "Venue search is unavailable right now. Try again later.");
    }
    const ranked = rankVenues(candidates, { themeKinds: derived.kinds, isOutdoor, capacity }, office);
    candidateCount = ranked.length;
    ordered = ranked.slice(0, MAX_RESULTS);
    if (ranked.length > 1) {
      try {
        const result = await deps.decisions.decide({
          step: "venuePick", state: venueState(facts), questions: { venue: venueQuestion(ranked.slice(0, MAX_OPTIONS)) }, signal: controller.signal,
        });
        provider = result.provider;
        if (result.provider !== "heuristic") ordered = applyVenueAnswer(ranked, result.answers.venue).venues;
      } catch {
        provider = null;
      }
    }
    venues = ordered.map(item => item.option);
  } catch (error) {
    // Any failure gives the credit back (idempotent: a second refund of the same key does nothing).
    await refund(deps, companyId, chargeKey);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const modelRanked = provider === "jev" || provider === "openai";
  if (!modelRanked) await refund(deps, companyId, chargeKey);
  if (modelRanked) {
    try {
      await deps.store.setDoc(cachePath, { ranked: ordered.map(item => ({ placeId: item.option.placeId, kind: item.option.kind, setting: item.option.setting, reasons: item.option.reasons })), provider, radiusMiles, createdAt: now, expireAt: new Date(now.getTime() + CACHE_TTL_MS) });
    } catch {
      deps.log?.("ai.venue_search_cache_write_failed", { companyId }, "warn");
    }
  }
  deps.log?.("ai.venueSearch", {
    companyId, requestId, cached: false, provider, candidateCount, resultCount: venues.length, charged: modelRanked, outcome: venues.length === 0 ? "empty" : "ok",
  });
  return { contractVersion: 1, venues, provider, cached: false, charged: modelRanked, radiusMiles, office };
}
