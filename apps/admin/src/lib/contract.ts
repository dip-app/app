// Mirrors contracts/v1/models.schema.json (Event, EventDraft, Venue) and docs/contracts/callables.md.
// Replace with the generated types once the organizer callables exist.

import { t } from "./aiStrings";
import { TAG_IDS } from "./catalog";

export type EventStatus = "scheduled" | "cancelled";

export interface Venue {
  name: string;
  address: string;
  locality: string;
  /** Hidden in the editor: resolved from the address on pick or at save. Never typed. */
  latitude: number;
  longitude: number;
  /** The Google place the position was resolved for; absent for free-typed or legacy venues. */
  placeId?: string | null;
}

export interface EventDraft {
  title: string;
  description: string;
  tagIds: string[];
  coverImageURL: string;
  startTime: string; // RFC 3339 UTC
  endTime: string;
  venue: Venue;
  costCents: number;
  costNote: string;
  capacity: number;
  isOutdoor: boolean;
}

export interface AdminEvent extends EventDraft {
  id: string;
  companyId: string;
  status: EventStatus;
  attendeeCount: number;
  pointsValue: number;
  createdBy: string;
  createdAt: string;
  revision: number;
}

export type ApiErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "invalid-argument"
  | "not-found"
  | "aborted"
  | "failed-precondition"
  | "resource-exhausted";

/** Mirrors the callable error mapping in docs/contracts/callables.md. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly fields: FieldErrors = {},
    /** Stable machine reason from HttpsError `details.reason` (e.g. CHALLENGE_WINDOW_OVERLAP), when the server sent one. */
    readonly reason?: string,
    /** CHALLENGE_WINDOW_OVERLAP only: the same-company theme whose window is in the way (`details.conflict`). */
    readonly conflict?: WindowConflict,
  ) {
    super(message);
  }
}

export interface WindowConflict {
  challengeId: string;
  startDate: string;
  endDate: string;
}

export type FieldErrors = Partial<Record<string, string>>;

export const LIMITS = {
  titleMax: 120,
  descriptionMax: 5000,
  capacityMin: 1,
  capacityMax: 10000,
} as const;

export function emptyDraft(): EventDraft {
  return {
    title: "",
    description: "",
    tagIds: [],
    coverImageURL: "",
    startTime: "",
    endTime: "",
    // Coordinates start unset (NaN, like capacity can be): the address search or Advanced fills them.
    venue: { name: "", address: "", locality: "", latitude: Number.NaN, longitude: Number.NaN },
    costCents: 0,
    costNote: "",
    capacity: 20,
    isOutdoor: false,
  };
}

/** A draft read back from JSON (the editor stash): an unset coordinate was written as null (JSON has no NaN), so restore it. */
export function reviveStashedDraft(draft: EventDraft): EventDraft {
  const { latitude, longitude } = draft.venue as { latitude: number | null; longitude: number | null };
  return { ...draft, venue: { ...draft.venue, latitude: latitude ?? Number.NaN, longitude: longitude ?? Number.NaN } };
}

/**
 * Client-side mirror of the server rules so errors show before submitting. The server stays the
 * authority: UI visibility and this validation are never the authorization boundary.
 */
export function validateDraft(
  draft: EventDraft,
  options: { requireFuture: boolean; now?: Date; minCapacity?: number; knownTagIds?: string[] },
): FieldErrors {
  const errors: FieldErrors = {};
  const title = draft.title.trim();
  if (title.length < 1 || title.length > LIMITS.titleMax) {
    errors.title = `Title must be 1 to ${LIMITS.titleMax} characters.`;
  }
  const description = draft.description.trim();
  if (description.length < 1 || description.length > LIMITS.descriptionMax) {
    errors.description = `Description must be 1 to ${LIMITS.descriptionMax} characters.`;
  }
  const start = Date.parse(draft.startTime);
  const end = Date.parse(draft.endTime);
  if (Number.isNaN(start)) errors.startTime = "Choose a start time.";
  if (Number.isNaN(end)) errors.endTime = "Choose an end time.";
  if (!errors.startTime && !errors.endTime && end <= start) errors.endTime = "End must be after start.";
  if (!errors.startTime && options.requireFuture && start <= (options.now ?? new Date()).getTime()) {
    errors.startTime = "New events must start in the future.";
  }
  if (!draft.venue.name.trim()) errors["venue.name"] = "Add the venue name.";
  if (!draft.venue.address.trim()) errors["venue.address"] = "Add the street address.";
  if (!draft.venue.locality.trim()) errors["venue.locality"] = "Add the city or area.";
  // Coordinates are resolved at pick or save time, so unset (NaN) is fine here. Out-of-range ones are a safety net on the address.
  const { latitude, longitude } = draft.venue;
  if ((!Number.isNaN(latitude) && !(latitude >= -90 && latitude <= 90)) || (!Number.isNaN(longitude) && !(longitude >= -180 && longitude <= 180))) {
    errors["venue.address"] ??= t("where.notFound");
  }
  if (!Number.isInteger(draft.costCents) || draft.costCents < 0) errors.costCents = "Price must be zero or more.";
  const minCapacity = Math.max(LIMITS.capacityMin, options.minCapacity ?? 0);
  if (!Number.isInteger(draft.capacity) || draft.capacity < minCapacity || draft.capacity > LIMITS.capacityMax) {
    errors.capacity =
      minCapacity > LIMITS.capacityMin
        ? `Capacity can’t be below the ${minCapacity} people already going (max ${LIMITS.capacityMax}).`
        : `Capacity must be ${LIMITS.capacityMin} to ${LIMITS.capacityMax}.`;
  }
  const known = options.knownTagIds ?? TAG_IDS;
  if (draft.tagIds.some((id) => !known.includes(id)) || new Set(draft.tagIds).size !== draft.tagIds.length) {
    errors.tagIds = "Choose tags from the list.";
  }
  if (!draft.coverImageURL) errors.coverImageURL = "Pick a cover image.";
  return errors;
}

/**
 * The wire payload: exactly the EventDraft fields, trimmed. Callers often hold a full event (id, status,
 * revision...); the server rejects unknown keys, so the projection is explicit.
 */
export function normalizeDraft(draft: EventDraft): EventDraft {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    tagIds: [...draft.tagIds],
    coverImageURL: draft.coverImageURL,
    startTime: draft.startTime,
    endTime: draft.endTime,
    venue: {
      name: draft.venue.name.trim(),
      address: draft.venue.address.trim(),
      locality: draft.venue.locality.trim(),
      latitude: draft.venue.latitude,
      longitude: draft.venue.longitude,
      ...(draft.venue.placeId ? { placeId: draft.venue.placeId } : {}),
    },
    costCents: draft.costCents,
    costNote: draft.costNote.trim(),
    capacity: draft.capacity,
    isOutdoor: draft.isOutdoor,
  };
}

export function formatPrice(costCents: number): string {
  return costCents === 0 ? "Free" : (costCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Classification uses timestamps and status, never labels. */
export function classify(event: AdminEvent, now: Date = new Date()): "upcoming" | "past" | "cancelled" {
  if (event.status === "cancelled") return "cancelled";
  return Date.parse(event.endTime) <= now.getTime() ? "past" : "upcoming";
}

/** "2 hr 30 min", "45 min"; empty when the times are not both valid. */
export function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "Mon, Nov 16 · 9:00 to 11:00 AM": date plus start and end, so date, time and length read at a glance. */
export function formatWhen(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) return "";
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const from = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (Number.isNaN(end.getTime())) return `${day} · ${from}`;
  const to = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay ? `${day} · ${from} to ${to}` : `${day} ${from} to ${end.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${to}`;
}
