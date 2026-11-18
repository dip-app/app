import type { Venue } from "../contract";
import type { VenueOption } from "../venues";
import type { PlaceSuggestion, ResolvedPlace } from "./types";

// Pure mapping from a picked place (or a Dipbot venue) to the event form. No React, so it is unit tested directly.

export interface VenueFill {
  /** Fields to merge into the event's venue (coordinates and placeId stay hidden in the draft). */
  patch: Venue;
  /** Outdoors per the server's `setting`: the form turns the Outdoor toggle on and says Dipbot did. */
  outdoor: boolean;
  /** Primary and secondary lines for the summary row. */
  primary: string;
  secondary: string;
}

/** What a resolved pick fills: the venue name only for a named place (a street address keeps the name already typed), street, city / area, position and place id. */
export function placeToVenue(place: ResolvedPlace, current: Pick<Venue, "name">, suggestion?: Pick<PlaceSuggestion, "primary" | "secondary">): VenueFill {
  return {
    patch: { name: place.name ?? current.name, address: place.address, locality: place.locality, latitude: place.latitude, longitude: place.longitude, placeId: place.placeId },
    outdoor: place.setting === "outdoor",
    primary: suggestion?.primary ?? place.name ?? place.address,
    secondary: suggestion?.secondary ?? (place.name ? `${place.address}, ${place.locality}` : place.locality),
  };
}

/** What a clicked Dipbot venue fills. Its name always replaces the venue name. */
export function venueOptionToVenue(o: VenueOption): VenueFill {
  return {
    patch: { name: o.name, address: o.address, locality: o.locality, latitude: o.latitude, longitude: o.longitude, placeId: o.placeId },
    outdoor: o.setting === "outdoor",
    primary: o.name,
    secondary: [o.address, o.locality].filter(Boolean).join(", "),
  };
}
