const EARTH_RADIUS_M = 6_371_000;
export const METERS_PER_MILE = 1609.344;

/** Straight-line distance in meters between two coordinates. */
export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const milesOf = (meters: number): number => Math.round((meters / METERS_PER_MILE) * 10) / 10;
