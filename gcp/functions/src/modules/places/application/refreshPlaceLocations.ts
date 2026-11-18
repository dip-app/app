import type { AdminStore, Doc } from "../../admin/application/ports";
import { DELETE_FIELD } from "../../admin/domain/ops";
import type { AiLog } from "../../ai/application/ports";
import type { LocationProvider } from "./ports";

/**
 * Google's terms allow caching latitude/longitude for at most 30 consecutive days. The job runs daily and touches anything
 * older than 25 days, which leaves five days of retries when Google is down.
 */
export const REFRESH_AFTER_DAYS = 25;
export const DEFAULT_BATCH = 200;
const DAY_MS = 86_400_000;

export interface RefreshDeps {
  store: AdminStore;
  /** Null (or `enabled` false) when Places is off: ended events are still retired, nothing is refreshed. */
  places: LocationProvider | null;
  enabled: boolean;
  log?: AiLog;
  now: () => Date;
  /** Documents per collection per run (default 200). */
  batch?: number;
}

export interface RefreshSummary {
  eventsRefreshed: number;
  eventsRetired: number;
  eventsSkipped: number;
  officesRefreshed: number;
  officesRetired: number;
  officesSkipped: number;
}

const isDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const asRecord = (value: unknown): Doc | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : null);

/** Coordinates leave the document; the place ID stays (it may be stored indefinitely). */
async function retireEvent(store: AdminStore, path: string, expectedAt: Date): Promise<boolean> {
  return store.runTransaction(async tx => {
    const event = await tx.get(path);
    const venue = asRecord(event?.venue);
    // An organizer edit in between replaces venueLocationAt: leave it for the next run.
    if (!event || !venue || !isDate(event.venueLocationAt) || event.venueLocationAt.getTime() !== expectedAt.getTime()) return false;
    tx.update(path, { venue: { ...venue, latitude: 0, longitude: 0 }, venueLocationAt: DELETE_FIELD });
    return true;
  });
}

async function refreshEvent(store: AdminStore, path: string, expectedAt: Date, at: { latitude: number; longitude: number }, now: Date): Promise<boolean> {
  return store.runTransaction(async tx => {
    const event = await tx.get(path);
    const venue = asRecord(event?.venue);
    if (!event || !venue || !isDate(event.venueLocationAt) || event.venueLocationAt.getTime() !== expectedAt.getTime()) return false;
    tx.update(path, { venue: { ...venue, latitude: at.latitude, longitude: at.longitude }, venueLocationAt: now });
    return true;
  });
}

/**
 * refreshPlaceLocations (daily): events whose venue coordinates are older than 25 days. A scheduled event that has not ended gets
 * fresh coordinates (Place Details, location field only) and a new `venueLocationAt`; an ended or cancelled event, or a place Google no
 * longer knows, has its coordinates set to the legacy 0/0 and `venueLocationAt` removed (the `venue.placeId` stays). Companies whose
 * office coordinates are older than 25 days are refreshed the same way (a vanished place clears the office coordinates, which
 * means "office not set"). A Google failure skips the document until the next run. Bounded per run; counts only in the log.
 */
export async function refreshPlaceLocations(deps: RefreshDeps): Promise<RefreshSummary> {
  const now = deps.now();
  const cutoff = new Date(now.getTime() - REFRESH_AFTER_DAYS * DAY_MS);
  const limit = deps.batch ?? DEFAULT_BATCH;
  const summary: RefreshSummary = { eventsRefreshed: 0, eventsRetired: 0, eventsSkipped: 0, officesRefreshed: 0, officesRetired: 0, officesSkipped: 0 };
  const provider = deps.enabled ? deps.places : null;

  const events = await deps.store.queryDocs({ group: "events" }, { where: [["venueLocationAt", "<", cutoff]], limit });
  for (const { path, data } of events) {
    const at = data.venueLocationAt;
    const venue = asRecord(data.venue);
    const placeId = typeof venue?.placeId === "string" ? venue.placeId : null;
    if (!isDate(at) || !venue) { summary.eventsSkipped++; continue; }
    const endTime = data.endTime;
    const ended = data.status !== "scheduled" || (isDate(endTime) && endTime.getTime() <= now.getTime());
    try {
      if (ended || placeId === null) {
        if (await retireEvent(deps.store, path, at)) summary.eventsRetired++; else summary.eventsSkipped++;
        continue;
      }
      if (!provider) { summary.eventsSkipped++; continue; }
      const place = await provider.details(placeId, { tier: "location" });
      if (place) {
        if (await refreshEvent(deps.store, path, at, place, now)) summary.eventsRefreshed++; else summary.eventsSkipped++;
      } else if (await retireEvent(deps.store, path, at)) summary.eventsRetired++; else summary.eventsSkipped++;
    } catch {
      summary.eventsSkipped++;
    }
  }

  const offices = await deps.store.queryDocs({ collection: "companies" }, { where: [["officeLocationAt", "<", cutoff]], limit });
  for (const { path, data } of offices) {
    const placeId = data.officePlaceId;
    const at = data.officeLocationAt;
    if (!isDate(at) || typeof placeId !== "string" || !provider) { summary.officesSkipped++; continue; }
    try {
      const place = await provider.details(placeId, { tier: "location" });
      const done = await deps.store.runTransaction(async tx => {
        const company = await tx.get(path);
        if (!company || !isDate(company.officeLocationAt) || company.officeLocationAt.getTime() !== at.getTime()) return null;
        if (place) { tx.update(path, { officeLatitude: place.latitude, officeLongitude: place.longitude, officeLocationAt: now }); return "refreshed"; }
        tx.update(path, { officeLatitude: 0, officeLongitude: 0, officeLocationAt: DELETE_FIELD });
        return "retired";
      });
      if (done === "refreshed") summary.officesRefreshed++; else if (done === "retired") summary.officesRetired++; else summary.officesSkipped++;
    } catch {
      summary.officesSkipped++;
    }
  }
  deps.log?.("places.refresh", { ...summary, enabled: provider !== null });
  return summary;
}
