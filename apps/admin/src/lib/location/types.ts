// The address search seam. Google Places is reached only through our callables (autocompletePlacesV1, resolvePlaceV1):
// the browser holds no provider key. The editor depends on LocationProvider only, so the callable-backed adapter (live)
// and the fake (mock mode, tests) are interchangeable. Pure types plus one error class; no network here.

/** One typeahead row. Shown only, never stored. Mirrors the contract's PlaceSuggestion. */
export interface PlaceSuggestion {
  placeId: string;
  /** The place name, or the street address for a plain address. */
  primary: string;
  /** City and region. */
  secondary: string;
  /** True for a named place (a park, a restaurant), false for a street address. */
  isPlace: boolean;
}

export type PlaceKind =
  | "park" | "garden" | "beach" | "trail" | "playground" | "restaurant" | "cafe" | "bar" | "brewery" | "food_court" | "museum" | "gallery"
  | "theatre" | "cinema" | "music_venue" | "bowling" | "escape_room" | "arcade" | "mini_golf" | "climbing" | "sports_centre" | "fitness"
  | "swimming" | "zoo" | "aquarium" | "community_centre" | "event_venue" | "library" | "hotel" | "other";

export type PlaceSetting = "outdoor" | "indoor" | "unknown";

/** A place with its position, as the server resolved it. Mirrors the contract's ResolvedPlace. */
export interface ResolvedPlace {
  placeId: string;
  /** The place name; null for a plain street address. */
  name: string | null;
  /** "123 Main St". */
  address: string;
  /** "Pittsburgh, PA". */
  locality: string;
  latitude: number;
  longitude: number;
  kind: PlaceKind;
  setting: PlaceSetting;
}

export type ResolveRequest = { placeId: string; sessionToken?: string } | { query: string };

export interface AutocompleteOptions {
  /** One per typing session (crypto.randomUUID()); the same token goes with the resolve that ends the session. */
  sessionToken: string;
  signal?: AbortSignal;
}

export interface LocationProvider {
  readonly name: "callable" | "fake";
  autocomplete(input: string, options: AutocompleteOptions): Promise<PlaceSuggestion[]>;
  /** A pick (placeId + session token) or a free-typed address (query). Null when the address is not found. */
  resolve(request: ResolveRequest): Promise<ResolvedPlace | null>;
}

/** disabled: the company has Places off (behaves like "not set up"). limit: today's allowance is used. notFound: a stale place id. failed: anything else. */
export type LocationErrorKind = "disabled" | "limit" | "notFound" | "failed";

export class LocationError extends Error {
  constructor(readonly kind: LocationErrorKind) {
    super(`Address search failed (${kind}).`);
    this.name = "LocationError";
  }
}

export const hasCoordinates = (s: { latitude: number; longitude: number }): boolean =>
  Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && !(s.latitude === 0 && s.longitude === 0);

export function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}
