// @i18n-migrated
// What each form keeps in its draft, how an untrusted stored draft is cleaned, and what is re-checked when it comes back.
// Only the fields an admin typed or picked are stored: no tokens, ids of people, request ids, derived coordinates or
// server data. See docs/design/admin-drafts.md.

import { coverByURL } from "./covers";
import { type EventDraft, LIMITS, emptyDraft } from "./contract";
import { THEME_LIMITS, type ThemeDraft } from "./challenge";
import { THEME_URLS } from "./themes";
import { asNumber, asRecord, asString, asStringList } from "./formDraft";
import { defaultWhen } from "./when";

// ---------- Event

export interface EventSnapshot {
  title: string;
  description: string;
  tagIds: string[];
  coverImageURL: string;
  /** The cover URL Dipbot picked, when the admin kept it ("Dipbot picked this"). */
  coverBy: string | null;
  /** RFC 3339 UTC, re-checked on restore. */
  startTime: string;
  endTime: string;
  /** The Where section: typed text and the picked place's id. The map position is not kept: it is looked up again on save. */
  venue: { name: string; address: string; locality: string; placeId: string | null };
  isOutdoor: boolean;
  /** As typed ("12.50"), so a half-typed price survives. */
  price: string;
  costNote: string;
  /** Null while the field is empty. */
  capacity: number | null;
}

export function eventSnapshot(draft: EventDraft, price: string, coverBy: string | null): EventSnapshot {
  return {
    title: draft.title, description: draft.description, tagIds: [...draft.tagIds], coverImageURL: draft.coverImageURL,
    coverBy: coverBy && coverBy === draft.coverImageURL ? coverBy : null,
    startTime: draft.startTime, endTime: draft.endTime,
    venue: { name: draft.venue.name, address: draft.venue.address, locality: draft.venue.locality, placeId: draft.venue.placeId ?? null },
    isOutdoor: draft.isOutdoor, price, costNote: draft.costNote,
    capacity: Number.isFinite(draft.capacity) ? draft.capacity : null,
  };
}

/** Worth keeping: the admin wrote or picked something beyond the page's defaults. Times alone, or the default capacity, are not. */
export function eventMeaningful(s: EventSnapshot): boolean {
  return Boolean(
    s.title.trim() || s.description.trim() || s.tagIds.length || s.coverImageURL || s.venue.name.trim() || s.venue.address.trim()
    || s.venue.locality.trim() || s.price.trim() || s.costNote.trim() || s.isOutdoor || (s.capacity !== null && s.capacity !== emptyDraft().capacity),
  );
}

export function parseEventSnapshot(raw: unknown): EventSnapshot | null {
  const o = asRecord(raw);
  const venue = asRecord(o?.venue);
  if (!o || !venue) return null;
  const capacity = o.capacity === null ? null : asNumber(o.capacity, Number.NaN);
  const snapshot: EventSnapshot = {
    title: asString(o.title, LIMITS.titleMax),
    description: asString(o.description, LIMITS.descriptionMax),
    tagIds: asStringList(o.tagIds, 50, 128),
    coverImageURL: asString(o.coverImageURL, 200),
    coverBy: typeof o.coverBy === "string" ? asString(o.coverBy, 200) : null,
    startTime: asString(o.startTime, 40),
    endTime: asString(o.endTime, 40),
    venue: {
      name: asString(venue.name, 200), address: asString(venue.address, 500), locality: asString(venue.locality, 200),
      placeId: typeof venue.placeId === "string" ? asString(venue.placeId, 300) : null,
    },
    isOutdoor: o.isOutdoor === true,
    price: asString(o.price, 20),
    costNote: asString(o.costNote, 500),
    capacity: capacity !== null && Number.isNaN(capacity) ? null : capacity,
  };
  return eventMeaningful(snapshot) ? snapshot : null;
}

export interface RestoredEvent {
  draft: EventDraft;
  price: string;
  coverBy: string | null;
  /** The saved times were in the past (or unreadable) and were replaced by the next free hour: the form says so. */
  datesReset: boolean;
}

/**
 * Turns a snapshot back into form state. Dates are re-validated: a start that has passed is never kept silently.
 * A cover that is no longer in the library is dropped, and tags are kept only when the loaded catalog still has them.
 */
export function restoreEvent(s: EventSnapshot, options: { now?: Date; knownTagIds?: readonly string[] } = {}): RestoredEvent {
  const now = options.now ?? new Date();
  const start = Date.parse(s.startTime);
  const end = Date.parse(s.endTime);
  const datesReset = !(start > now.getTime() && end > start);
  const when = datesReset ? defaultWhen(now) : { startTime: s.startTime, endTime: s.endTime };
  const known = options.knownTagIds;
  const cover = coverByURL(s.coverImageURL) ? s.coverImageURL : "";
  const base = emptyDraft();
  return {
    draft: {
      ...base,
      title: s.title, description: s.description,
      tagIds: known ? s.tagIds.filter((id) => known.includes(id)) : s.tagIds,
      coverImageURL: cover,
      ...when,
      venue: { ...base.venue, name: s.venue.name, address: s.venue.address, locality: s.venue.locality, placeId: s.venue.placeId },
      isOutdoor: s.isOutdoor, costNote: s.costNote,
      capacity: s.capacity ?? Number.NaN,
    },
    price: s.price,
    coverBy: cover && s.coverBy === cover ? cover : null,
    datesReset,
  };
}

// ---------- Theme

export interface ThemeSnapshot {
  title: string;
  description: string;
  tagIds: string[];
  coverImageURL: string;
  goal: number | null;
  goalUnit: string;
  pointsReward: number | null;
  startDate: string;
  endDate: string;
}

export function themeSnapshot(d: ThemeDraft): ThemeSnapshot {
  return {
    title: d.title, description: d.description, tagIds: [...d.tagIds], coverImageURL: d.coverImageURL,
    goal: Number.isFinite(d.goal) ? d.goal : null, goalUnit: d.goalUnit,
    pointsReward: Number.isFinite(d.pointsReward) ? d.pointsReward : null, startDate: d.startDate, endDate: d.endDate,
  };
}

export function parseThemeSnapshot(raw: unknown): ThemeSnapshot | null {
  const o = asRecord(raw);
  if (!o) return null;
  const cover = asString(o.coverImageURL, 200);
  if (!THEME_URLS.includes(cover)) return null;
  const num = (value: unknown) => (value === null ? null : asNumber(value, Number.NaN));
  const goal = num(o.goal);
  const points = num(o.pointsReward);
  return {
    title: asString(o.title, THEME_LIMITS.titleMax), description: asString(o.description, THEME_LIMITS.descriptionMax),
    tagIds: asStringList(o.tagIds, THEME_LIMITS.maxTags, 128), coverImageURL: cover,
    goal: goal !== null && Number.isNaN(goal) ? null : goal, goalUnit: asString(o.goalUnit, THEME_LIMITS.goalUnitMax),
    pointsReward: points !== null && Number.isNaN(points) ? null : points,
    startDate: asString(o.startDate, 40), endDate: asString(o.endDate, 40),
  };
}

export function restoreTheme(s: ThemeSnapshot, knownTagIds?: readonly string[]): ThemeDraft {
  return {
    title: s.title, description: s.description, type: "weekly", coverImageURL: s.coverImageURL,
    tagIds: knownTagIds ? s.tagIds.filter((id) => knownTagIds.includes(id)) : s.tagIds,
    goal: s.goal ?? Number.NaN, goalUnit: s.goalUnit, pointsReward: s.pointsReward ?? Number.NaN,
    startDate: s.startDate, endDate: s.endDate,
  };
}
