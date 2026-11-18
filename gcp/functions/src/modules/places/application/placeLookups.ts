import { z } from "zod";
import type { AutocompletePlacesResponse, ResolvedPlace, ResolvePlaceResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminStore, Caller, RateLimiter } from "../../admin/application/ports";
import { AdminError, invalid } from "../../admin/domain/errors";
import type { AiLog } from "../../ai/application/ports";
import { fieldsOf } from "../../ai/domain/request";
import { kindOf, settingOf } from "../domain/categories";
import { officeOf } from "../domain/office";
import type { LocationBias, LocationProvider, PlaceDetails } from "./ports";
import { consumePlacesQuota, DEFAULT_PLACES_DAILY_LIMIT, placesErrorCode, placesUnavailable } from "./quota";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const MAX_SUGGESTIONS = 5;
/** Typeahead is biased (not restricted) to this radius around the office. */
export const BIAS_RADIUS_METERS = 30_000;

export interface PlaceLookupDeps {
  store: AdminStore;
  /** Null when no provider is configured. */
  places: LocationProvider | null;
  /** The kill switch (PLACES_ENABLED, or the emulator demo). False fails with PLACES_DISABLED. */
  enabled: boolean;
  /** Google Places calls per company per UTC day across typeahead and resolves (default 400). */
  dailyLimit?: number;
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
}

export const AutocompleteRequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  sessionToken: z.string().min(1).max(128),
  input: z.string().transform(value => value.trim()).pipe(z.string().min(3).max(200)),
});

export const ResolveRequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  sessionToken: z.string().min(1).max(128).optional(),
  placeId: z.string().regex(PLACE_ID_PATTERN).optional(),
  query: z.string().transform(value => value.trim()).pipe(z.string().min(3).max(300)).optional(),
}).refine(value => (value.placeId === undefined) !== (value.query === undefined), { message: "placeId or query", path: ["placeId"] });

/** The shared front of the lookup callables: caller, authorization (event.manage), burst limit, kill switch. */
export async function guardLookup(deps: Pick<PlaceLookupDeps, "store" | "places" | "enabled" | "limiter">, rawCaller: Caller | null, companyId: string) {
  const caller = requireCaller(rawCaller);
  await deps.store.runReadOnly(tx => authorize(tx, caller, companyId, "event.manage"));
  await deps.limiter?.consume(caller.uid);
  if (!deps.enabled || !deps.places) throw new AdminError("failed-precondition", "PLACES_DISABLED", "Place search is not available right now.");
  return { caller, places: deps.places };
}

/** The company office as a location bias, or null when no office is set. */
export async function officeBias(store: AdminStore, companyId: string): Promise<LocationBias | null> {
  const office = officeOf(await store.getDoc(`companies/${companyId}`));
  return office ? { latitude: office.latitude, longitude: office.longitude, radiusMeters: BIAS_RADIUS_METERS } : null;
}

/** Fits a provider place to the contract's ResolvedPlace (name only when the tier returned one). */
export function toResolvedPlace(place: PlaceDetails): ResolvedPlace {
  const kind = kindOf(place.types, place.primaryType);
  return {
    placeId: place.placeId, name: place.name ? place.name.slice(0, 120) : null, address: place.address.slice(0, 200), locality: place.locality.slice(0, 120),
    latitude: place.latitude, longitude: place.longitude, kind, setting: settingOf(kind),
  };
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, deps: Pick<PlaceLookupDeps, "log">, event: string, uid: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const fields = fieldsOf(parsed.error);
    // Field names only, never the typed text.
    deps.log?.(event, { uid, fields: fields.join(",") }, "warn");
    throw invalid(fields);
  }
  return parsed.data;
}

/**
 * autocompletePlacesV1: typeahead for the event editor and the office setting. event.manage (organizer, admin), biased to the
 * office when set, at most 5 suggestions. Free to admins, capped per company per day. Only the typed text, the session token
 * and the office bias reach Google. The typed text is never logged or stored; suggestions are returned, never stored.
 */
export async function autocompletePlaces(deps: PlaceLookupDeps, rawCaller: Caller | null, data: unknown): Promise<AutocompletePlacesResponse> {
  const caller = requireCaller(rawCaller);
  const request = parseOrThrow(AutocompleteRequestSchema, data, deps, "places.autocomplete_invalid", caller.uid);
  const { places } = await guardLookup(deps, caller, request.companyId);
  await consumePlacesQuota(deps.store, request.companyId, deps.now(), deps.dailyLimit ?? DEFAULT_PLACES_DAILY_LIMIT);
  try {
    const bias = await officeBias(deps.store, request.companyId);
    const suggestions = (await places.autocomplete({ input: request.input, sessionToken: request.sessionToken, bias })).slice(0, MAX_SUGGESTIONS);
    deps.log?.("places.autocomplete", { companyId: request.companyId, suggestionCount: suggestions.length, biased: bias !== null, outcome: "ok" });
    return { contractVersion: 1, suggestions };
  } catch (error) {
    deps.log?.("places.autocomplete", { companyId: request.companyId, suggestionCount: 0, outcome: `places_${placesErrorCode(error)}` }, "warn");
    throw placesUnavailable();
  }
}

/**
 * resolvePlaceV1: resolves a picked suggestion (placeId: Place Details Pro with the session token, which ends the autocomplete
 * session) or a typed address (query: a text search for the id only, then Place Details Essentials on the top id, so no name).
 * Nothing found answers without `place`. Same permission, limiter and daily cap as autocompletePlacesV1; a query counts two calls.
 */
export async function resolvePlace(deps: PlaceLookupDeps, rawCaller: Caller | null, data: unknown): Promise<ResolvePlaceResponse> {
  const caller = requireCaller(rawCaller);
  const request = parseOrThrow(ResolveRequestSchema, data, deps, "places.resolve_invalid", caller.uid);
  const { places } = await guardLookup(deps, caller, request.companyId);
  await consumePlacesQuota(deps.store, request.companyId, deps.now(), deps.dailyLimit ?? DEFAULT_PLACES_DAILY_LIMIT, request.placeId ? 1 : 2);
  try {
    let place: PlaceDetails | null;
    if (request.placeId) {
      place = await places.details(request.placeId, { tier: "pro", sessionToken: request.sessionToken });
    } else {
      const ids = await places.searchTextIds(request.query!, await officeBias(deps.store, request.companyId));
      place = ids[0] ? await places.details(ids[0], { tier: "essentials" }) : null;
      if (place) place = { ...place, name: null };
    }
    deps.log?.("places.resolve", { companyId: request.companyId, mode: request.placeId ? "placeId" : "query", found: place !== null, outcome: "ok" });
    return place ? { contractVersion: 1, place: toResolvedPlace(place) } : { contractVersion: 1 };
  } catch (error) {
    deps.log?.("places.resolve", { companyId: request.companyId, mode: request.placeId ? "placeId" : "query", found: false, outcome: `places_${placesErrorCode(error)}` }, "warn");
    throw placesUnavailable();
  }
}
