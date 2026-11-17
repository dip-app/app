import { summarizeInterests, type InterestSummary } from "../domain/tagCounts";
import type { TagCatalog, TagStatsStore } from "./ports";

/** Aggregated interests for one company, with small-cell suppression. This is the helper the AI idea flow (S2) consumes.
 * `companyId` MUST come from the caller's server-side membership, never from a client payload. Reads only that company's stats. */
export async function getInterestSummary(
  deps: { catalog: TagCatalog; store: TagStatsStore },
  companyId: string,
  options?: { limit?: number; minCount?: number },
): Promise<InterestSummary> {
  if (typeof companyId !== "string" || companyId.length === 0 || companyId.length > 200 || companyId.includes("/")) {
    throw new Error("Invalid company id.");
  }
  const [stats, catalog] = await Promise.all([deps.store.listStats(companyId), deps.catalog.tags()]);
  return summarizeInterests(stats, catalog, options);
}
