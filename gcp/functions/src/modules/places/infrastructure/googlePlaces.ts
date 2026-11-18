import { z } from "zod";
import {
  PlacesUnavailableError, type DetailsTier, type LocationBias, type LocationProvider, type NearbyQuery, type PlaceDetails, type RawSuggestion,
} from "../application/ports";

const BASE = "https://places.googleapis.com/v1";
export const GOOGLE_PLACES_TIMEOUT_MS = 8000;
/** Google rejects circle radii above 50,000 m. */
export const MAX_RADIUS_METERS = 50_000;
export const MAX_NEARBY_RESULTS = 20;

/** Field masks per tier. They decide the billing SKU (Essentials, Pro): keep them minimal. */
export const FIELD_MASKS = {
  pro: "id,displayName,formattedAddress,shortFormattedAddress,addressComponents,location,types,primaryType,businessStatus",
  essentials: "id,formattedAddress,addressComponents,location,types",
  location: "id,location",
  textSearchIds: "places.id",
  nearby: "places.id,places.displayName,places.shortFormattedAddress,places.formattedAddress,places.addressComponents,places.location,places.primaryType,places.types,places.businessStatus",
} as const;

export interface TokenSource {
  /** An OAuth 2.0 access token with the cloud-platform scope. Never log it. */
  getToken(): Promise<string>;
}

export interface GooglePlacesOptions {
  tokens: TokenSource;
  /** Billing project sent as X-Goog-User-Project. */
  projectId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const text = z.string().optional().catch(undefined);
const Component = z.object({ longText: text, shortText: text, types: z.array(z.string()).catch([]) });
const PlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: text }).optional().catch(undefined),
  formattedAddress: text,
  shortFormattedAddress: text,
  addressComponents: z.array(Component).catch([]),
  location: z.object({ latitude: z.number().finite(), longitude: z.number().finite() }).optional().catch(undefined),
  types: z.array(z.string()).catch([]),
  primaryType: text,
  businessStatus: text,
});
type RawPlace = z.infer<typeof PlaceSchema>;

const Suggestion = z.object({
  placePrediction: z.object({
    placeId: z.string().min(1),
    text: z.object({ text: text }).optional().catch(undefined),
    structuredFormat: z.object({
      mainText: z.object({ text: text }).optional().catch(undefined),
      secondaryText: z.object({ text: text }).optional().catch(undefined),
    }).optional().catch(undefined),
    types: z.array(z.string()).catch([]),
  }),
});

type Component_ = z.infer<typeof Component>;
const component = (components: readonly Component_[], type: string): Component_ | undefined => components.find(item => item.types.includes(type));

/** Street line from the address components ("123 Main St"); falls back to the first segment of the short or full address. */
export function streetLine(place: Pick<RawPlace, "addressComponents" | "shortFormattedAddress" | "formattedAddress">, isEstablishment: boolean): string {
  const number = component(place.addressComponents, "street_number")?.longText?.trim();
  const route = (component(place.addressComponents, "route")?.shortText ?? component(place.addressComponents, "route")?.longText)?.trim();
  if (route) return [number, route].filter(Boolean).join(" ");
  if (isEstablishment) return (place.shortFormattedAddress ?? place.formattedAddress ?? "").split(",")[0]!.trim();
  return (place.formattedAddress ?? "").split(",")[0]!.trim();
}

export function localityOf(components: readonly Component_[]): string {
  for (const type of ["locality", "postal_town", "sublocality", "sublocality_level_1", "administrative_area_level_2"]) {
    const value = component(components, type)?.longText?.trim();
    if (value) return value;
  }
  return "";
}

function toDetails(raw: RawPlace): PlaceDetails | null {
  if (!raw.location) return null;
  const isEstablishment = raw.types.includes("establishment") || raw.types.includes("point_of_interest");
  const name = raw.displayName?.text?.trim();
  return {
    placeId: raw.id,
    name: name ? name : null,
    address: streetLine(raw, isEstablishment),
    locality: localityOf(raw.addressComponents),
    latitude: raw.location.latitude,
    longitude: raw.location.longitude,
    types: raw.types,
    primaryType: raw.primaryType ?? null,
  };
}

const circle = (bias: LocationBias) => ({
  circle: { center: { latitude: bias.latitude, longitude: bias.longitude }, radius: Math.min(MAX_RADIUS_METERS, Math.max(1, bias.radiusMeters)) },
});

/**
 * Google Places API (New), called with the Functions service account's OAuth token (no API key anywhere). The token, the
 * request URL and response bodies never reach an error message or a log.
 */
export class GooglePlaces implements LocationProvider {
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;
  constructor(private readonly options: GooglePlacesOptions) {
    this.doFetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? GOOGLE_PLACES_TIMEOUT_MS;
  }

  private async request(method: "GET" | "POST", path: string, fieldMask: string | null, body: unknown, signal?: AbortSignal): Promise<unknown | null> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: globalThis.Response;
    try {
      const token = await this.options.tokens.getToken();
      response = await this.doFetch(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`, "X-Goog-User-Project": this.options.projectId, Accept: "application/json",
          ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: combined,
      });
    } catch (error) {
      if (error instanceof PlacesUnavailableError) throw error;
      // The thrown error can carry the URL or token; only its kind is kept.
      throw new PlacesUnavailableError(combined.aborted ? "timeout" : "upstream");
    }
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) throw new PlacesUnavailableError("auth");
    if (response.status === 429) throw new PlacesUnavailableError("rate_limited");
    if (!response.ok) throw new PlacesUnavailableError("upstream");
    try { return await response.json(); } catch { throw new PlacesUnavailableError(combined.aborted ? "timeout" : "malformed"); }
  }

  async autocomplete(query: { input: string; sessionToken: string; bias: LocationBias | null }, signal?: AbortSignal): Promise<RawSuggestion[]> {
    // Autocomplete (New) takes no field mask.
    const body = {
      input: query.input, sessionToken: query.sessionToken, languageCode: "en",
      ...(query.bias ? { locationBias: circle(query.bias) } : {}),
    };
    const json = await this.request("POST", "/places:autocomplete", null, body, signal);
    const parsed = z.object({ suggestions: z.array(z.unknown()).optional() }).safeParse(json ?? {});
    if (!parsed.success) throw new PlacesUnavailableError("malformed");
    const out: RawSuggestion[] = [];
    for (const raw of parsed.data.suggestions ?? []) {
      const item = Suggestion.safeParse(raw);
      if (!item.success) continue;
      const prediction = item.data.placePrediction;
      const primary = (prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "").trim();
      if (primary === "") continue;
      out.push({
        placeId: prediction.placeId, primary: primary.slice(0, 200), secondary: (prediction.structuredFormat?.secondaryText?.text ?? "").trim().slice(0, 200),
        isPlace: prediction.types.includes("establishment") || prediction.types.includes("point_of_interest"),
      });
    }
    return out;
  }

  async details(placeId: string, options: { tier: DetailsTier; sessionToken?: string | undefined }, signal?: AbortSignal): Promise<PlaceDetails | null> {
    const params = new URLSearchParams({ languageCode: "en" });
    if (options.sessionToken) params.set("sessionToken", options.sessionToken);
    const json = await this.request("GET", `/places/${encodeURIComponent(placeId)}?${params.toString()}`, FIELD_MASKS[options.tier], undefined, signal);
    if (json === null) return null;
    const parsed = PlaceSchema.safeParse(json);
    if (!parsed.success) throw new PlacesUnavailableError("malformed");
    if (parsed.data.businessStatus === "CLOSED_PERMANENTLY") return null;
    return toDetails(parsed.data);
  }

  async searchTextIds(query: string, bias: LocationBias | null, signal?: AbortSignal): Promise<string[]> {
    const body = { textQuery: query, languageCode: "en", pageSize: 3, ...(bias ? { locationBias: circle(bias) } : {}) };
    const json = await this.request("POST", "/places:searchText", FIELD_MASKS.textSearchIds, body, signal);
    const parsed = z.object({ places: z.array(z.object({ id: z.string().min(1) }).catch({ id: "" })).optional() }).safeParse(json ?? {});
    if (!parsed.success) throw new PlacesUnavailableError("malformed");
    return (parsed.data.places ?? []).map(place => place.id).filter(id => id !== "");
  }

  async searchNearby(query: NearbyQuery, signal?: AbortSignal): Promise<PlaceDetails[]> {
    const body = {
      includedTypes: query.includedTypes, maxResultCount: Math.min(MAX_NEARBY_RESULTS, Math.max(1, Math.floor(query.maxResults))), rankPreference: "POPULARITY",
      languageCode: "en", locationRestriction: circle({ latitude: query.latitude, longitude: query.longitude, radiusMeters: query.radiusMeters }),
    };
    const json = await this.request("POST", "/places:searchNearby", FIELD_MASKS.nearby, body, signal);
    const parsed = z.object({ places: z.array(z.unknown()).optional() }).safeParse(json ?? {});
    if (!parsed.success) throw new PlacesUnavailableError("malformed");
    const out: PlaceDetails[] = [];
    for (const raw of parsed.data.places ?? []) {
      const place = PlaceSchema.safeParse(raw);
      if (!place.success || place.data.businessStatus === "CLOSED_PERMANENTLY") continue;
      const details = toDetails(place.data);
      if (details) out.push(details);
    }
    return out;
  }
}
