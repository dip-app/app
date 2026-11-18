import type { AdminStore, Doc } from "../../admin/application/ports";
import { AdminError } from "../../admin/domain/errors";
import { dayKey } from "../../ai/domain/paths";
import { placesPaths } from "../domain/paths";
import { PlacesUnavailableError } from "./ports";

export const DEFAULT_PLACES_DAILY_LIMIT = 400;
const USAGE_TTL_MS = 3 * 24 * 3_600_000;

/**
 * Counts `calls` Google Places calls against the company's daily cap (UTC day) before they are made. Over the cap nothing
 * is counted and the request fails with PLACES_LIMIT. Atomic, so parallel requests cannot overshoot by more than their own size.
 */
export async function consumePlacesQuota(store: AdminStore, companyId: string, now: Date, limit: number, calls = 1): Promise<void> {
  await store.runTransaction(async tx => {
    const path = placesPaths.usage(companyId, dayKey(now));
    const usage = await tx.get(path);
    const count = typeof usage?.count === "number" ? usage.count : 0;
    if (count + calls > limit) throw new AdminError("resource-exhausted", "PLACES_LIMIT", "The daily place lookup limit was reached. Try again tomorrow.");
    const data: Doc = { count: count + calls, updatedAt: now, expireAt: new Date(now.getTime() + USAGE_TTL_MS) };
    if (usage) tx.update(path, data); else tx.create(path, data);
  });
}

/** A provider failure as a callable error with a fixed message (the code only goes to the log). */
export function placesUnavailable(): AdminError {
  return new AdminError("unavailable", "PLACES_UNAVAILABLE", "Place search is unavailable right now. Try again later.");
}

export const placesErrorCode = (error: unknown): string => (error instanceof PlacesUnavailableError ? error.code : "upstream");
