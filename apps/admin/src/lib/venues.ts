// Dipbot venues (findVenuesV1 / setCompanyOfficeV1). Wire types mirror contracts/v1/models.schema.json
// (FindVenuesRequest, VenueOption, CompanyOffice). The portal shows name, kind, distance and a short reason line only:
// never ratings, hours or prices.

export interface CompanyOffice { address: string; locality: string; latitude: number; longitude: number }

export type VenueKind =
  | "park" | "garden" | "beach" | "trail" | "playground" | "restaurant" | "cafe" | "bar" | "brewery" | "food_court" | "museum" | "gallery"
  | "theatre" | "cinema" | "music_venue" | "bowling" | "escape_room" | "arcade" | "mini_golf" | "climbing" | "sports_centre" | "fitness"
  | "swimming" | "zoo" | "aquarium" | "community_centre" | "event_venue" | "library" | "hotel" | "other";

export type VenueReason = "theme_match" | "outdoor_fit" | "indoor_fit" | "close" | "group_fit";
export type VenueSetting = "outdoor" | "indoor" | "unknown";

export interface VenueOption {
  id: string;
  name: string;
  address: string;
  locality: string;
  latitude: number;
  longitude: number;
  kind: VenueKind;
  setting: VenueSetting;
  distanceMiles: number;
  /** Always null: the portal never shows websites. */
  website: string | null;
  reasons: VenueReason[];
  placeId: string;
}

export interface FindVenuesInput {
  requestId: string;
  title: string;
  description?: string;
  tagIds?: string[];
  isOutdoor?: boolean;
  capacity?: number;
  costCents?: number;
  radiusMiles?: number;
}

export interface FindVenuesResult {
  venues: VenueOption[];
  provider: string | null;
  /** Served from saved results: no credit was used. */
  cached: boolean;
  charged: boolean;
  radiusMiles: number;
  office: CompanyOffice;
}

export const RADIUS_CHOICES = [1, 3, 5, 10, 25] as const;
export const DEFAULT_RADIUS = 5;

const RADIUS_KEY = "dip.venueRadius.v1";

/** The radius remembered in this browser; the default when none or when storage is blocked. */
export function readRadius(store?: Pick<Storage, "getItem">): number {
  try {
    const value = Number((store ?? window.localStorage).getItem(RADIUS_KEY));
    return (RADIUS_CHOICES as readonly number[]).includes(value) ? value : DEFAULT_RADIUS;
  } catch { return DEFAULT_RADIUS; }
}

export function saveRadius(miles: number, store?: Pick<Storage, "setItem">): void {
  try { (store ?? window.localStorage).setItem(RADIUS_KEY, String(miles)); } catch { /* remembering is a convenience */ }
}

/** The request for one click: trimmed title, only the hints that are set, a fresh requestId. */
export function buildVenueRequest(event: { title: string; description?: string; tagIds?: readonly string[]; isOutdoor?: boolean; capacity?: number; costCents?: number }, radiusMiles: number, requestId: string): FindVenuesInput | null {
  const title = event.title.trim().slice(0, 120);
  if (!title) return null;
  const description = event.description?.trim().slice(0, 600);
  return {
    requestId, title, radiusMiles,
    ...(description ? { description } : {}),
    ...(event.tagIds && event.tagIds.length ? { tagIds: [...event.tagIds] } : {}),
    ...(typeof event.isOutdoor === "boolean" ? { isOutdoor: event.isOutdoor } : {}),
    ...(Number.isInteger(event.capacity) && (event.capacity as number) > 0 ? { capacity: event.capacity } : {}),
    ...(Number.isInteger(event.costCents) && (event.costCents as number) >= 0 ? { costCents: event.costCents } : {}),
  };
}

/** Haversine distance in miles; used by the mock. */
export function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
