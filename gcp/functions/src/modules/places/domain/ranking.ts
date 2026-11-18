import type { VenueOption } from "../../../generated/models";
import type { PlaceDetails } from "../application/ports";
import { kindOf, settingOf, type VenueKind } from "./categories";
import { haversineMeters, milesOf } from "./geo";

export interface RankingFacts {
  /** Kinds that match the event's themes (DerivedCategories.kinds). */
  themeKinds: ReadonlySet<VenueKind>;
  isOutdoor?: boolean | undefined;
  capacity?: number | undefined;
}

export interface RankedVenue {
  option: VenueOption;
  score: number;
}

export type CapacityBucket = "small" | "medium" | "large";

/** small up to 12 people, medium up to 39, large above. */
export const capacityBucket = (capacity: number): CapacityBucket => (capacity <= 12 ? "small" : capacity <= 39 ? "medium" : "large");

const GROUP_KINDS: Readonly<Record<CapacityBucket, ReadonlySet<VenueKind>>> = {
  small: new Set(["restaurant", "cafe", "bar", "escape_room", "gallery", "museum", "garden", "climbing", "library"]),
  medium: new Set(["bowling", "arcade", "mini_golf", "park", "restaurant", "brewery", "bar", "community_centre", "climbing", "cinema", "escape_room"]),
  large: new Set(["park", "event_venue", "community_centre", "sports_centre", "food_court", "hotel", "theatre", "beach", "music_venue", "zoo"]),
};

const NAME_MAX = 120;
const ADDRESS_MAX = 200;
const LOCALITY_MAX = 120;

const clip = (value: string, max: number) => (value.length <= max ? value : value.slice(0, max));

/** Drops nameless, unusable or duplicate places (same name and coordinates rounded to about 100 m). Keeps the first. */
export function normalizeCandidates(candidates: readonly PlaceDetails[]): PlaceDetails[] {
  const seen = new Set<string>();
  const out: PlaceDetails[] = [];
  for (const candidate of candidates) {
    const name = (candidate.name ?? "").trim();
    if (name === "" || candidate.placeId === "" || candidate.placeId.length > 128 || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) continue;
    if (Math.abs(candidate.latitude) > 90 || Math.abs(candidate.longitude) > 180) continue;
    const key = `${name.toLowerCase()}|${candidate.latitude.toFixed(3)}|${candidate.longitude.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...candidate, name });
  }
  return out;
}

/**
 * Heuristic ranking from facts only: theme match of the kind, setting fit with the outdoor flag, distance and group fit.
 * `reasons` are computed from the same facts, never from a model, and the response never carries invented ratings, hours or prices.
 */
export function rankVenues(candidates: readonly PlaceDetails[], facts: RankingFacts, center: { latitude: number; longitude: number }): RankedVenue[] {
  const bucket = facts.capacity === undefined ? null : capacityBucket(facts.capacity);
  const ranked = normalizeCandidates(candidates).map(candidate => {
    const kind = kindOf(candidate.types, candidate.primaryType);
    const setting = settingOf(kind);
    const distanceMeters = haversineMeters(center.latitude, center.longitude, candidate.latitude, candidate.longitude);
    const distanceMiles = milesOf(distanceMeters);
    const reasons: VenueOption["reasons"] = [];
    let score = 0;
    if (facts.themeKinds.has(kind)) { score += 4; reasons.push("theme_match"); }
    if (facts.isOutdoor === true) {
      if (setting === "outdoor") { score += 3; reasons.push("outdoor_fit"); } else if (setting === "indoor") score -= 1;
    } else if (facts.isOutdoor === false) {
      if (setting === "indoor") { score += 2; reasons.push("indoor_fit"); } else if (setting === "outdoor") score -= 2;
    }
    if (distanceMiles <= 1) { score += 2; reasons.push("close"); } else if (distanceMiles <= 2.5) score += 1;
    if (bucket !== null && GROUP_KINDS[bucket].has(kind)) { score += 1; reasons.push("group_fit"); }
    score -= distanceMeters / 16_093; // at most about one point per ten miles
    const option: VenueOption = {
      id: candidate.placeId, placeId: candidate.placeId, name: clip(candidate.name ?? "", NAME_MAX), address: clip(candidate.address, ADDRESS_MAX),
      locality: clip(candidate.locality, LOCALITY_MAX), latitude: candidate.latitude, longitude: candidate.longitude, kind, setting,
      distanceMiles, website: null, reasons,
    };
    return { option, score };
  });
  const unique = new Map<string, RankedVenue>();
  for (const item of ranked) if (!unique.has(item.option.id)) unique.set(item.option.id, item);
  return [...unique.values()].sort((a, b) => b.score - a.score || a.option.distanceMiles - b.option.distanceMiles || a.option.name.localeCompare(b.option.name));
}
