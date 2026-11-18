/**
 * Server-side location provider (Google Places API New, called only from Cloud Functions with the service account).
 * One port for typeahead, details, address geocoding and point-of-interest search, so the provider can change without
 * touching the application layer (docs/design/smart-location.md).
 */
export interface LocationBias {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/** One typeahead suggestion. Shown to the user, never stored. */
export interface RawSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
  isPlace: boolean;
}

/** A resolved place. Only `placeId` may be stored indefinitely; coordinates at most 30 days (see the refresh job). */
export interface PlaceDetails {
  placeId: string;
  /** Business or landmark name; null for a plain street address or when the tier does not include it. */
  name: string | null;
  /** Street line ("123 Main St"), possibly empty. */
  address: string;
  locality: string;
  latitude: number;
  longitude: number;
  types: string[];
  primaryType: string | null;
}

/**
 * Field-mask tiers of Place Details (billing SKU):
 * - "pro": names and types (Place Details Pro), used for the picked suggestion that ends an autocomplete session.
 * - "essentials": address and location only (Place Details Essentials), used for typed addresses and the office.
 * - "location": coordinates only (Essentials), used by the daily refresh job.
 */
export type DetailsTier = "pro" | "essentials" | "location";

export interface NearbyQuery {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Google Table A place types. */
  includedTypes: readonly string[];
  /** At most 20. */
  maxResults: number;
}

export interface LocationProvider {
  autocomplete(query: { input: string; sessionToken: string; bias: LocationBias | null }, signal?: AbortSignal): Promise<RawSuggestion[]>;
  /** Null when the place does not exist (any more). */
  details(placeId: string, options: { tier: DetailsTier; sessionToken?: string | undefined }, signal?: AbortSignal): Promise<PlaceDetails | null>;
  /** Place ids only (Essentials IDs Only SKU), best match first. */
  searchTextIds(query: string, bias: LocationBias | null, signal?: AbortSignal): Promise<string[]>;
  searchNearby(query: NearbyQuery, signal?: AbortSignal): Promise<PlaceDetails[]>;
}

export type PlacesErrorCode = "auth" | "rate_limited" | "upstream" | "timeout" | "malformed";

/** Any failure of the places provider. The message is a fixed string per code: never a URL, a token or a response body. */
export class PlacesUnavailableError extends Error {
  constructor(readonly code: PlacesErrorCode) {
    super(`Places provider unavailable (${code})`);
    this.name = "PlacesUnavailableError";
  }
}
