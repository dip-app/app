// Mirrors contracts/v1/models.schema.json (Event, EventDraft, Venue) and docs/contracts/callables.md.
// Replace with the generated types once the organizer callables exist.

// @i18n-migrated
import { t as tAi } from "./aiStrings";
import { TAG_IDS } from "./catalog";
import { formatDate, formatNumber, formatTime, t } from "./i18n";

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
    /** Stable catalog key from `details.messageKey` (e.g. "errors.memberNotFound"), when the server sent one. */
    readonly messageKey?: string,
    readonly messageParams?: Readonly<Record<string, string | number>>,
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
    errors.title = t("events.error.title", { max: LIMITS.titleMax });
  }
  const description = draft.description.trim();
  if (description.length < 1 || description.length > LIMITS.descriptionMax) {
    errors.description = t("events.error.description", { max: LIMITS.descriptionMax });
  }
  const start = Date.parse(draft.startTime);
  const end = Date.parse(draft.endTime);
  if (Number.isNaN(start)) errors.startTime = t("events.error.startTime");
  if (Number.isNaN(end)) errors.endTime = t("events.error.endTime");
  if (!errors.startTime && !errors.endTime && end <= start) errors.endTime = t("events.error.endBeforeStart");
  if (!errors.startTime && options.requireFuture && start <= (options.now ?? new Date()).getTime()) {
    errors.startTime = t("events.error.startFuture");
  }
  if (!draft.venue.name.trim()) errors["venue.name"] = t("events.error.venueName");
  if (!draft.venue.address.trim()) errors["venue.address"] = t("events.error.venueAddress");
  if (!draft.venue.locality.trim()) errors["venue.locality"] = t("events.error.venueLocality");
  // Coordinates are resolved at pick or save time, so unset (NaN) is fine here. Out-of-range ones are a safety net on the address.
  const { latitude, longitude } = draft.venue;
  if ((!Number.isNaN(latitude) && !(latitude >= -90 && latitude <= 90)) || (!Number.isNaN(longitude) && !(longitude >= -180 && longitude <= 180))) {
    errors["venue.address"] ??= tAi("where.notFound");
  }
  if (!Number.isInteger(draft.costCents) || draft.costCents < 0) errors.costCents = t("events.error.price");
  const minCapacity = Math.max(LIMITS.capacityMin, options.minCapacity ?? 0);
  if (!Number.isInteger(draft.capacity) || draft.capacity < minCapacity || draft.capacity > LIMITS.capacityMax) {
    errors.capacity =
      minCapacity > LIMITS.capacityMin
        ? t("events.error.capacityMin", { min: minCapacity, max: LIMITS.capacityMax })
        : t("events.error.capacityRange", { min: LIMITS.capacityMin, max: LIMITS.capacityMax });
  }
  const known = options.knownTagIds ?? TAG_IDS;
  if (draft.tagIds.some((id) => !known.includes(id)) || new Set(draft.tagIds).size !== draft.tagIds.length) {
    errors.tagIds = t("events.error.tags");
  }
  if (!draft.coverImageURL) errors.coverImageURL = t("events.error.cover");
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
  return costCents === 0 ? t("events.price.free") : formatNumber(costCents / 100, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
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
  if (hours === 0) return t("events.duration.minutes", { minutes: rest });
  return rest === 0 ? t("events.duration.hours", { hours }) : t("events.duration.hoursMinutes", { hours, minutes: rest });
}

/** "Mon, Nov 16 · 9:00 to 11:00 AM": date plus start and end, so date, time and length read at a glance. */
export function formatWhen(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) return "";
  const dayFormat: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  const timeFormat: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const day = formatDate(start, dayFormat);
  const from = formatTime(start, timeFormat);
  if (Number.isNaN(end.getTime())) return t("events.when.startOnly", { day, from });
  const to = formatTime(end, timeFormat);
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay ? t("events.when.sameDay", { day, from, to }) : t("events.when.multiDay", { day, from, endDay: formatDate(end, dayFormat), to });
}
