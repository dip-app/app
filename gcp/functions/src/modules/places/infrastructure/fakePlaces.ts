import type { DetailsTier, LocationBias, LocationProvider, NearbyQuery, PlaceDetails, RawSuggestion } from "../application/ports";
import { haversineMeters } from "../domain/geo";

/** Deterministic Pittsburgh data for the emulator, the demo and tests. No network. */
export const FAKE_PLACES: readonly PlaceDetails[] = [
  { placeId: "fake_addr_grant", name: null, address: "500 Grant St", locality: "Pittsburgh", latitude: 40.4406, longitude: -79.9959, types: ["street_address"], primaryType: "street_address" },
  { placeId: "fake_park_schenley", name: "Schenley Park", address: "4100 Forbes Ave", locality: "Pittsburgh", latitude: 40.4343, longitude: -79.9420, types: ["park", "tourist_attraction", "point_of_interest", "establishment"], primaryType: "park" },
  { placeId: "fake_park_point", name: "Point State Park", address: "601 Commonwealth Pl", locality: "Pittsburgh", latitude: 40.4413, longitude: -80.0107, types: ["park", "point_of_interest", "establishment"], primaryType: "park" },
  { placeId: "fake_rest_primanti", name: "Primanti Bros.", address: "46 18th St", locality: "Pittsburgh", latitude: 40.4553, longitude: -79.9779, types: ["sandwich_shop", "restaurant", "food", "point_of_interest", "establishment"], primaryType: "sandwich_shop" },
  { placeId: "fake_cafe_commonplace", name: "Commonplace Coffee", address: "5500 Walnut St", locality: "Pittsburgh", latitude: 40.4512, longitude: -79.9330, types: ["coffee_shop", "cafe", "food", "point_of_interest", "establishment"], primaryType: "coffee_shop" },
  { placeId: "fake_museum_warhol", name: "The Andy Warhol Museum", address: "117 Sandusky St", locality: "Pittsburgh", latitude: 40.4486, longitude: -80.0027, types: ["museum", "tourist_attraction", "point_of_interest", "establishment"], primaryType: "museum" },
  { placeId: "fake_bowl_arsenal", name: "Arsenal Lanes", address: "300 39th St", locality: "Pittsburgh", latitude: 40.4668, longitude: -79.9594, types: ["bowling_alley", "point_of_interest", "establishment"], primaryType: "bowling_alley" },
  { placeId: "fake_bar_church", name: "Church Brew Works", address: "3525 Liberty Ave", locality: "Pittsburgh", latitude: 40.4627, longitude: -79.9605, types: ["brewpub", "bar", "restaurant", "point_of_interest", "establishment"], primaryType: "brewpub" },
  { placeId: "fake_zoo_pgh", name: "Pittsburgh Zoo and Aquarium", address: "7370 Baker St", locality: "Pittsburgh", latitude: 40.4833, longitude: -79.9183, types: ["zoo", "aquarium", "tourist_attraction", "point_of_interest", "establishment"], primaryType: "zoo" },
  { placeId: "fake_gym_downtown", name: "Downtown Fitness", address: "301 5th Ave", locality: "Pittsburgh", latitude: 40.4392, longitude: -79.9975, types: ["gym", "health", "point_of_interest", "establishment"], primaryType: "gym" },
];

const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const matches = (place: PlaceDetails, input: string) => {
  const haystack = `${place.name ?? ""} ${place.address} ${place.locality}`.toLowerCase();
  const tokens = words(input);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
};

export interface FakeCall { method: "autocomplete" | "details" | "searchTextIds" | "searchNearby"; args: unknown }

export class FakePlaces implements LocationProvider {
  readonly calls: FakeCall[] = [];
  /** Set to make every call throw this error. */
  failWith: Error | null = null;
  /** Place ids that no longer exist (details returns null). */
  gone = new Set<string>();
  /** Places whose coordinates the next details calls report (the refresh job tests). */
  moved = new Map<string, { latitude: number; longitude: number }>();

  private enter(method: FakeCall["method"], args: unknown) {
    this.calls.push({ method, args });
    if (this.failWith) throw this.failWith;
  }

  async autocomplete(query: { input: string; sessionToken: string; bias: LocationBias | null }): Promise<RawSuggestion[]> {
    this.enter("autocomplete", query);
    return FAKE_PLACES.filter(place => matches(place, query.input)).slice(0, 5).map(place => ({
      placeId: place.placeId, primary: place.name ?? place.address, secondary: place.name ? `${place.address}, ${place.locality}, PA` : `${place.locality}, PA`,
      isPlace: place.name !== null,
    }));
  }

  async details(placeId: string, options: { tier: DetailsTier; sessionToken?: string | undefined }): Promise<PlaceDetails | null> {
    this.enter("details", { placeId, ...options });
    const place = FAKE_PLACES.find(item => item.placeId === placeId);
    if (!place || this.gone.has(placeId)) return null;
    const at = this.moved.get(placeId);
    return { ...place, ...(at ?? {}), name: options.tier === "pro" ? place.name : null };
  }

  async searchTextIds(query: string, bias: LocationBias | null): Promise<string[]> {
    this.enter("searchTextIds", { query, bias });
    return FAKE_PLACES.filter(place => matches(place, query)).slice(0, 3).map(place => place.placeId);
  }

  async searchNearby(query: NearbyQuery): Promise<PlaceDetails[]> {
    this.enter("searchNearby", query);
    const wanted = new Set(query.includedTypes);
    return FAKE_PLACES
      .filter(place => place.name !== null && place.types.some(type => wanted.has(type)))
      .filter(place => haversineMeters(query.latitude, query.longitude, place.latitude, place.longitude) <= query.radiusMeters)
      .slice(0, query.maxResults);
  }
}
