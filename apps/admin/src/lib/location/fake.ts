import { LocationError, type LocationProvider, type PlaceSuggestion, type ResolveRequest, type ResolvedPlace } from "./types";

// Offline stand-in used by the mock api (mock mode) and tests: canned Pittsburgh places with ids and coordinates.
// Not a geocoder: a free-typed query matches a canned address, or a Pittsburgh-looking address gets a downtown point.

const place = (id: string, name: string | null, address: string, over: Partial<ResolvedPlace> = {}): ResolvedPlace => ({
  placeId: `fake-${id}`, name, address, locality: "Pittsburgh, PA", latitude: 40.44, longitude: -79.99, kind: "other", setting: "unknown", ...over,
});

export const FAKE_PLACES: readonly ResolvedPlace[] = [
  place("schenley", "Schenley Park", "Panther Hollow Rd", { latitude: 40.4354, longitude: -79.9433, kind: "park", setting: "outdoor" }),
  place("primanti", "Primanti Bros.", "46 18th St", { latitude: 40.4551, longitude: -79.9797, kind: "restaurant", setting: "indoor" }),
  place("forbes", null, "412 Forbes Avenue", { latitude: 40.4388, longitude: -79.9964 }),
  place("phipps", "Phipps Conservatory", "1 Schenley Dr", { latitude: 40.4393, longitude: -79.9477, kind: "garden", setting: "indoor" }),
  place("pointstate", "Point State Park", "601 Commonwealth Pl", { latitude: 40.4414, longitude: -80.0107, kind: "park", setting: "outdoor" }),
  place("penn", null, "900 Penn Avenue", { latitude: 40.4443, longitude: -79.9937 }),
  place("butler", null, "3200 Butler Street", { latitude: 40.4655, longitude: -79.9606 }),
  place("smallman", "Smallman Galley", "54 21st St", { latitude: 40.4573, longitude: -79.9757, kind: "food_court", setting: "indoor" }),
];

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export const toSuggestion = (p: ResolvedPlace): PlaceSuggestion => ({
  placeId: p.placeId, primary: p.name ?? p.address, secondary: p.name ? `${p.address}, ${p.locality}` : p.locality, isPlace: p.name !== null,
});

/** Street addresses typed into the autocomplete, kept so a pick of one resolves by id (like a Places id would). */
const typedPlaces = new Map<string, ResolvedPlace>();

/** A typed "number street[, city]" address as Places would offer it: one suggestion, a deterministic downtown point. */
function typedAddress(input: string): ResolvedPlace | null {
  const [street = "", ...rest] = input.split(",");
  if (!/^\s*\d+[a-z]?\s+[a-z]{2,}/i.test(street)) return null;
  const address = street.trim().replace(/\s+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const locality = rest.join(",").trim() || "Pittsburgh, PA";
  const found = place("typed", null, address, { placeId: `fake-typed-${words(`${address} ${locality}`).join("-")}`, locality, latitude: 40.4406, longitude: -79.9959 });
  typedPlaces.set(found.placeId, found);
  return found;
}

/**
 * Every typed word must start a word of the result ("pitt park" matches Schenley Park, Pittsburgh). At most 5. When no
 * canned place matches, a typed street address ("600 Grant Street") comes back as one suggestion, as Google would.
 */
export function fakeAutocomplete(input: string, limit = 5): PlaceSuggestion[] {
  const typed = words(input);
  if (!typed.length) return [];
  const canned = FAKE_PLACES.map(toSuggestion)
    .filter((s) => { const have = words(`${s.primary} ${s.secondary}`); return typed.every((w) => have.some((h) => h.startsWith(w))); })
    .slice(0, limit);
  if (canned.length) return canned;
  const street = typedAddress(input);
  return street ? [toSuggestion(street)] : [];
}

/** By id, or by a free-typed "street, city" query. Null when nothing matches. */
export function fakeResolve(request: ResolveRequest): ResolvedPlace | null {
  if ("placeId" in request) return FAKE_PLACES.find((p) => p.placeId === request.placeId) ?? typedPlaces.get(request.placeId) ?? null;
  const query = request.query.toLowerCase();
  const canned = FAKE_PLACES.find((p) => query.includes(p.address.toLowerCase()) || (p.name !== null && query.includes(p.name.toLowerCase())));
  if (canned) return canned;
  // A street number plus Pittsburgh reads as an address: a deterministic downtown point.
  if (/\d/.test(query) && /pittsburgh|, pa\b/.test(query)) {
    const [address = request.query, ...rest] = request.query.split(",");
    return place("typed", null, address.trim(), { placeId: `fake-typed-${words(address).join("-")}`, locality: rest.join(",").trim() || "Pittsburgh, PA", latitude: 40.4406, longitude: -79.9959 });
  }
  return null;
}

/** A LocationProvider over the canned data, for tests and previews. `fail` makes every call throw that kind. */
export function createFakeProvider(options: { delayMs?: number; fail?: "disabled" | "limit" | "failed" } = {}): LocationProvider {
  const delay = options.delayMs ?? 0;
  const later = <T,>(work: () => T, signal?: AbortSignal) => new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      if (options.fail) reject(new LocationError(options.fail)); else resolve(work());
    }, delay);
    function onAbort() { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return {
    name: "fake",
    autocomplete: (input, { signal }) => later(() => fakeAutocomplete(input), signal),
    resolve: (request) => later(() => fakeResolve(request)),
  };
}
