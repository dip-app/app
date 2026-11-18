// Offline stand-in data for Dipbot venues (mock mode only). Deterministic: the same event text gives the same venues.

import { type CompanyOffice, type FindVenuesInput, type VenueOption, type VenueReason, milesBetween } from "./venues";

export const MOCK_OFFICE: CompanyOffice = { address: "500 Grant Street", locality: "Pittsburgh, PA", latitude: 40.4406, longitude: -79.9959 };

type Seed = Omit<VenueOption, "distanceMiles" | "reasons">;
const SEEDS: readonly Seed[] = [
  { id: "mock-v1", placeId: "fake-pointstate", name: "Point State Park", address: "601 Commonwealth Pl", locality: "Pittsburgh, PA", latitude: 40.4414, longitude: -80.0107, kind: "park", setting: "outdoor", website: null },
  { id: "mock-v2", placeId: "fake-smallman", name: "Smallman Galley", address: "54 21st St", locality: "Pittsburgh, PA", latitude: 40.4573, longitude: -79.9757, kind: "food_court", setting: "indoor", website: null },
  { id: "mock-v3", placeId: "fake-phipps", name: "Phipps Conservatory", address: "1 Schenley Dr", locality: "Pittsburgh, PA", latitude: 40.4393, longitude: -79.9477, kind: "garden", setting: "indoor", website: null },
  { id: "mock-v4", placeId: "fake-schenley", name: "Schenley Park", address: "Panther Hollow Rd", locality: "Pittsburgh, PA", latitude: 40.4354, longitude: -79.9433, kind: "park", setting: "outdoor", website: null },
  { id: "mock-v5", placeId: "fake-strip", name: "Strip District Bowl", address: "2300 Smallman St", locality: "Pittsburgh, PA", latitude: 40.4519, longitude: -79.9808, kind: "bowling", setting: "indoor", website: null },
];

/** The mock's venues for an event, nearest first, within the radius, with grounded reason codes. */
export function mockVenues(input: FindVenuesInput, office: CompanyOffice): VenueOption[] {
  const radius = input.radiusMiles ?? 5;
  return SEEDS
    .map((seed) => ({ seed, miles: Math.round(milesBetween(office, seed) * 10) / 10 }))
    .filter(({ miles }) => miles <= radius)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, 5)
    .map(({ seed, miles }, index): VenueOption => {
      const reasons: VenueReason[] = [];
      if (index === 0) reasons.push("theme_match");
      if (input.isOutdoor && seed.setting === "outdoor") reasons.push("outdoor_fit");
      if (input.isOutdoor === false && seed.setting === "indoor") reasons.push("indoor_fit");
      if (miles <= 1.5) reasons.push("close");
      if ((input.capacity ?? 0) >= 15 && (seed.kind === "food_court" || seed.kind === "park")) reasons.push("group_fit");
      if (!reasons.length) reasons.push("close");
      return { ...seed, distanceMiles: miles, reasons: reasons.slice(0, 3) };
    });
}
