import { t } from "../aiStrings";
import { ApiError, type Venue } from "../contract";
import { type ResolveRequest, type ResolvedPlace, hasCoordinates } from "./types";

// The save-time location step. Coordinates are never typed by the admin: they come from a pick (resolve by placeId) or, for
// free-typed text, from one resolve({query}) call just before saving. This file decides what to do and applies the answer;
// it is pure apart from the injected `resolve`, so every case is unit tested.

export interface ResolvedFor { address: string; locality: string }

export type Plan =
  /** The coordinates already belong to this text: send them untouched. */
  | { action: "keep" }
  /** Resolve the typed text first. `lenient`: an unchanged saved address, so a failed lookup must not block the save. */
  | { action: "resolve"; lenient: boolean };

const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const same = (a: ResolvedFor, b: ResolvedFor) => norm(a.address) === norm(b.address) && norm(a.locality) === norm(b.locality);

/**
 * `resolvedFor` is the text the venue's coordinates were resolved for (a pick, or the saved event's own address when it has
 * a map location); null when there is none. Editing an event whose address did not change never changes its coordinates.
 */
export function planLocation(venue: Venue, resolvedFor: ResolvedFor | null, editing: boolean): Plan {
  const matches = resolvedFor !== null && same(venue, resolvedFor);
  if (matches && hasCoordinates(venue)) return { action: "keep" };
  return { action: "resolve", lenient: editing && matches };
}

export type Outcome = { kind: "found"; place: ResolvedPlace } | { kind: "notFound" } | { kind: "disabled" } | { kind: "error" };

/** Runs the lookup for the typed "street, city"; never throws. */
export async function resolveTyped(resolve: (request: ResolveRequest) => Promise<ResolvedPlace | null>, venue: Venue): Promise<Outcome> {
  const query = [venue.address.trim(), venue.locality.trim()].filter(Boolean).join(", ");
  try {
    const place = await resolve({ query });
    return place ? { kind: "found", place } : { kind: "notFound" };
  } catch (error) {
    const reason = error instanceof ApiError ? error.reason : (error as { kind?: string } | null)?.kind === "disabled" ? "PLACES_DISABLED" : undefined;
    if (reason === "PLACE_NOT_FOUND" || (error as { kind?: string } | null)?.kind === "notFound") return { kind: "notFound" };
    return reason === "PLACES_DISABLED" ? { kind: "disabled" } : { kind: "error" };
  }
}

export interface Applied {
  venue: Venue;
  /** Set when the save must stop: shown on the address field. */
  error?: string;
  /** The event is saved without a map location (Places is off). */
  noMapLocation?: boolean;
}

/** Numbers only: an unset coordinate goes out as 0 ("no map location"), never NaN. */
const numeric = (venue: Venue): Venue => ({
  ...venue, latitude: Number.isFinite(venue.latitude) ? venue.latitude : 0, longitude: Number.isFinite(venue.longitude) ? venue.longitude : 0,
});

/** Turns the lookup's answer into the venue to save, or the reason to stop. The admin's own text fields are always kept as typed. */
export function applyOutcome(plan: Plan, outcome: Outcome | null, venue: Venue): Applied {
  if (plan.action === "keep" || outcome === null) return { venue: numeric(venue) };
  switch (outcome.kind) {
    case "found":
      return { venue: { ...venue, latitude: outcome.place.latitude, longitude: outcome.place.longitude, placeId: outcome.place.placeId } };
    case "disabled": {
      // Places is off: no map location (a legacy unchanged address keeps whatever it had).
      if (plan.lenient) return { venue: numeric(venue), noMapLocation: true };
      return { venue: { ...venue, latitude: 0, longitude: 0, placeId: null }, noMapLocation: true };
    }
    case "notFound":
      return plan.lenient ? { venue: numeric(venue) } : { venue, error: t("where.notFound") };
    case "error":
      return plan.lenient ? { venue: numeric(venue) } : { venue, error: t("where.checkFailed") };
  }
}
