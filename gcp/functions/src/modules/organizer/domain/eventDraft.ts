import { createHash } from "node:crypto";
import type { CreateEventRequest, EventDraft, UpdateEventRequest, Venue } from "../../../generated/models";
import { OrganizerError } from "./errors";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

export const LIMITS = {
  titleMax: 120,
  descriptionMax: 5000,
  capacityMin: 1,
  capacityMax: 10_000,
  maxTags: 10,
  tagIdMax: 128,
  textMax: 500,
} as const;

/**
 * Approved default-image catalog (V1 has no uploads). The incoming URL must be one of these; the
 * design-approved catalog is still pending, so this list is a placeholder owned with the packet.
 */
export const APPROVED_COVER_URLS: ReadonlySet<string> = new Set([
  "catalog://default/fitness",
  "catalog://default/outdoors",
  "catalog://default/hiking",
  "catalog://default/games",
  "catalog://default/cooking",
]);

type Record_ = Record<string, unknown>;

function fail(fields: string[], message = "Check the highlighted fields."): never {
  throw new OrganizerError("invalid-argument", "VALIDATION_FAILED", message, fields);
}

function asRecord(value: unknown, path: string): Record_ {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail([path]);
  return value as Record_;
}

function exactKeys(record: Record_, allowed: readonly string[], path: string) {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key)).map((key) => (path ? `${path}.${key}` : key));
  const missing = allowed.filter((key) => !(key in record)).map((key) => (path ? `${path}.${key}` : key));
  if (unknown.length || missing.length) fail([...unknown, ...missing].sort());
}

function str(record: Record_, key: string, path: string, min: number, max: number, trim = true): string {
  const value = record[key];
  if (typeof value !== "string") fail([`${path}${key}`]);
  const text = trim ? (value as string).trim() : (value as string);
  if (text.length < min || text.length > max) fail([`${path}${key}`]);
  return text;
}

function utcInstant(record: Record_, key: string): Date {
  const value = record[key];
  if (typeof value !== "string" || !RFC3339_UTC.test(value)) fail([key]);
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) fail([key]);
  return date;
}

export interface ParsedDraft extends Omit<EventDraft, "startTime" | "endTime"> {
  startTime: Date;
  endTime: Date;
}

/** Validates and normalizes an untrusted EventDraft (docs/contracts/callables.md). No store access. */
export function parseEventDraft(data: unknown): ParsedDraft {
  const record = asRecord(data, "event");
  exactKeys(record, ["title", "description", "tagIds", "coverImageURL", "startTime", "endTime", "venue", "costCents", "costNote", "capacity", "isOutdoor"], "event");
  const prefix = "";
  const title = str(record, "title", prefix, 1, LIMITS.titleMax);
  const description = str(record, "description", prefix, 1, LIMITS.descriptionMax);
  const costNote = str(record, "costNote", prefix, 0, LIMITS.textMax);

  const tags = record.tagIds;
  if (!Array.isArray(tags) || tags.length > LIMITS.maxTags) fail(["tagIds"]);
  const tagIds = (tags as unknown[]).map((tag) => {
    if (typeof tag !== "string" || !ID_PATTERN.test(tag)) fail(["tagIds"]);
    return tag as string;
  });
  if (new Set(tagIds).size !== tagIds.length) fail(["tagIds"]);

  const coverImageURL = record.coverImageURL;
  if (typeof coverImageURL !== "string" || !APPROVED_COVER_URLS.has(coverImageURL)) fail(["coverImageURL"]);

  const startTime = utcInstant(record, "startTime");
  const endTime = utcInstant(record, "endTime");
  if (endTime.getTime() <= startTime.getTime()) fail(["endTime"]);

  const costCents = record.costCents;
  if (!Number.isInteger(costCents) || (costCents as number) < 0) fail(["costCents"]);
  const capacity = record.capacity;
  if (!Number.isInteger(capacity) || (capacity as number) < LIMITS.capacityMin || (capacity as number) > LIMITS.capacityMax) fail(["capacity"]);
  if (typeof record.isOutdoor !== "boolean") fail(["isOutdoor"]);

  return {
    title,
    description,
    tagIds,
    coverImageURL: coverImageURL as string,
    startTime,
    endTime,
    venue: parseVenue(record.venue),
    costCents: costCents as number,
    costNote,
    capacity: capacity as number,
    isOutdoor: record.isOutdoor as boolean,
  };
}

function parseVenue(data: unknown): Venue {
  const record = asRecord(data, "venue");
  const allowed = ["name", "address", "locality", "latitude", "longitude", "fsqPlaceId", "phone", "website"];
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key)).map((key) => `venue.${key}`);
  const required = ["name", "address", "locality", "latitude", "longitude"].filter((key) => !(key in record)).map((key) => `venue.${key}`);
  if (unknown.length || required.length) fail([...unknown, ...required].sort());
  const venue: Venue = {
    name: str(record, "name", "venue.", 1, LIMITS.textMax),
    address: str(record, "address", "venue.", 1, LIMITS.textMax),
    locality: str(record, "locality", "venue.", 1, LIMITS.textMax),
    latitude: record.latitude as number,
    longitude: record.longitude as number,
  };
  if (typeof venue.latitude !== "number" || !(venue.latitude >= -90 && venue.latitude <= 90)) fail(["venue.latitude"]);
  if (typeof venue.longitude !== "number" || !(venue.longitude >= -180 && venue.longitude <= 180)) fail(["venue.longitude"]);
  for (const key of ["fsqPlaceId", "phone", "website"] as const) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.length > LIMITS.textMax) fail([`venue.${key}`]);
    venue[key] = value as string;
  }
  return venue;
}

function companyIdOf(record: Record_): string {
  const value = record.companyId;
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(["companyId"]);
  return value as string;
}

export interface ParsedCreate { companyId: string; requestId: string; event: ParsedDraft }
export interface ParsedUpdate { companyId: string; eventId: string; expectedRevision: number; event: ParsedDraft; status: "scheduled" | "cancelled" }

export function parseCreateEventRequest(data: unknown): ParsedCreate {
  const record = asRecord(data, "request");
  exactKeys(record, ["contractVersion", "companyId", "requestId", "event"], "");
  if (record.contractVersion !== 1) fail(["contractVersion"]);
  const requestId = record.requestId;
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) fail(["requestId"]);
  return { companyId: companyIdOf(record), requestId: (requestId as string).toLowerCase(), event: parseEventDraft(record.event) };
}

export function parseUpdateEventRequest(data: unknown): ParsedUpdate {
  const record = asRecord(data, "request");
  exactKeys(record, ["contractVersion", "companyId", "eventId", "expectedRevision", "event", "status"], "");
  if (record.contractVersion !== 1) fail(["contractVersion"]);
  const eventId = record.eventId;
  if (typeof eventId !== "string" || !ID_PATTERN.test(eventId)) fail(["eventId"]);
  const expected = record.expectedRevision;
  if (!Number.isInteger(expected) || (expected as number) < 1) fail(["expectedRevision"]);
  if (record.status !== "scheduled" && record.status !== "cancelled") fail(["status"]);
  return {
    companyId: companyIdOf(record),
    eventId: eventId as string,
    expectedRevision: expected as number,
    event: parseEventDraft(record.event),
    status: record.status as "scheduled" | "cancelled",
  };
}

/** Stable digest of the normalized draft, so a reused requestId with different content is detectable. */
export function draftHash(draft: ParsedDraft): string {
  const venue = draft.venue;
  const canonical = JSON.stringify([
    draft.title, draft.description, draft.tagIds, draft.coverImageURL,
    draft.startTime.toISOString(), draft.endTime.toISOString(),
    [venue.name, venue.address, venue.locality, venue.latitude, venue.longitude, venue.fsqPlaceId ?? null, venue.phone ?? null, venue.website ?? null],
    draft.costCents, draft.costNote, draft.capacity, draft.isOutdoor,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type { CreateEventRequest, UpdateEventRequest };
