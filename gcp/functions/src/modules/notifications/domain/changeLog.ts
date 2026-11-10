/**
 * Event change history (`changeLog` on the event document). Only user-visible fields are diffed, so writes
 * that touch nothing else (changeLog itself, attendeeCount, revision/updatedBy bookkeeping, RSVP counters)
 * produce no entry: that is the self-trigger loop guard.
 */
export const CHANGE_LOG_LIMIT = 50;
/** Long text values are shortened so 50 entries stay far below the 1 MiB document limit. */
export const CHANGE_VALUE_MAX = 200;
export const UNKNOWN_EDITOR = "organizer";

export const TRACKED_FIELDS = [
  "title", "description", "tagIds", "coverImageURL", "startTime", "endTime",
  "venue.name", "venue.address", "venue.locality", "costCents", "costNote", "capacity", "isOutdoor", "status",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export interface FieldChange { field: TrackedField; from: string | null; to: string | null }
export interface ChangeLogEntry { at: Date; by: string; revision: number; changes: FieldChange[] }

type Doc = Record<string, unknown>;

function truncate(text: string): string {
  return text.length <= CHANGE_VALUE_MAX ? text : `${text.slice(0, CHANGE_VALUE_MAX - 1)}…`;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate(): unknown }).toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function raw(doc: Doc, field: TrackedField): unknown {
  if (field.startsWith("venue.")) {
    const venue = doc.venue;
    return venue && typeof venue === "object" ? (venue as Doc)[field.slice("venue.".length)] : undefined;
  }
  return doc[field];
}

/** Normalized display value: RFC3339 UTC for times, sorted comma list for tags, decimal/boolean text otherwise. */
export function displayValue(doc: Doc, field: TrackedField): string | null {
  const value = raw(doc, field);
  if (value === undefined || value === null) return null;
  if (field === "startTime" || field === "endTime") return asDate(value)?.toISOString() ?? null;
  if (field === "tagIds") {
    return Array.isArray(value) ? [...value].filter((tag): tag is string => typeof tag === "string").sort().join(", ") : null;
  }
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function diffEvent(before: Doc, after: Doc): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    // Compare full values (not the truncated display) so edits beyond the preview length still count.
    const full = (doc: Doc) => {
      const value = raw(doc, field);
      if (field === "startTime" || field === "endTime") return asDate(value)?.toISOString() ?? null;
      if (field === "tagIds") return Array.isArray(value) ? JSON.stringify([...value].sort()) : null;
      return value === undefined ? null : JSON.stringify(value);
    };
    if (full(before) !== full(after)) changes.push({ field, from: displayValue(before, field), to: displayValue(after, field) });
  }
  return changes;
}

const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/**
 * Builds the entry for one update, or null when nothing user-visible changed. `by` is the organizer UID that
 * updateEventV1 recorded in `updatedBy` for this revision; other writers fall back to "organizer".
 */
export function buildEntry(before: Doc, after: Doc, at: Date): ChangeLogEntry | null {
  const changes = diffEvent(before, after);
  if (changes.length === 0) return null;
  const revision = integer(after.revision) && after.revision >= 1 ? after.revision : 1;
  const bumped = integer(before.revision) && integer(after.revision) && after.revision > before.revision;
  const by = bumped && typeof after.updatedBy === "string" && after.updatedBy.length > 0 ? after.updatedBy : UNKNOWN_EDITOR;
  return { at, by, revision, changes };
}

/**
 * Appends idempotently: an entry with the same revision and identical changes is a retry/duplicate delivery.
 * Entries are kept in revision order (stable for equal revisions) and capped to the latest CHANGE_LOG_LIMIT.
 * Existing entries are passed through untouched (their `at` keeps its stored Timestamp type).
 */
export function mergeChangeLog(existing: unknown, entry: Pick<ChangeLogEntry, "revision" | "changes">): { log: unknown[]; appended: boolean } {
  const current = Array.isArray(existing) ? existing.filter((item) => item && typeof item === "object") : [];
  const key = JSON.stringify(entry.changes);
  const duplicate = current.some((item) => {
    const stored = item as Partial<ChangeLogEntry>;
    return stored.revision === entry.revision && JSON.stringify(stored.changes) === key;
  });
  if (duplicate) return { log: current, appended: false };
  const revisionOf = (item: unknown) => {
    const value = (item as Partial<ChangeLogEntry>).revision;
    return integer(value) ? value : 0;
  };
  const log = [...current, entry].sort((a, b) => revisionOf(a) - revisionOf(b));
  return { log: log.slice(Math.max(0, log.length - CHANGE_LOG_LIMIT)), appended: true };
}

const LABELS: Record<TrackedField, string> = {
  title: "name", description: "details", tagIds: "tags", coverImageURL: "photo", startTime: "time", endTime: "time",
  "venue.name": "location", "venue.address": "location", "venue.locality": "location",
  costCents: "cost", costNote: "cost", capacity: "spots", isOutdoor: "indoor/outdoor", status: "status",
};

/** One-line push body for an event change. Values are deliberately omitted (no timezone context server-side). */
export function summarizeChanges(changes: readonly FieldChange[]): string {
  const status = changes.find((change) => change.field === "status");
  if (status?.to === "cancelled") return "This activity was cancelled.";
  if (status?.from === "cancelled" && status.to === "scheduled") return "This activity is back on.";
  const labels = [...new Set(changes.filter((change) => change.field !== "status").map((change) => LABELS[change.field]))];
  return labels.length ? `Updated: ${labels.join(", ")}.` : "This activity was updated.";
}
