import { countingMembership, interestFieldsChanged, receiptIdFor, tagCountDeltas } from "../domain/tagCounts";
import type { TagCatalog, TagStatsStore } from "./ports";

export interface ApplyResult { result: "skipped" | "unchanged" | "applied" | "duplicate"; companies: number; tags: number }

/** users/{uid} written: diff the interest fields and apply the count deltas once per trigger event. */
export async function applyUserInterestWrite(
  deps: { catalog: TagCatalog; store: TagStatsStore },
  input: { eventId: string; before: unknown; after: unknown },
): Promise<ApplyResult> {
  if (!interestFieldsChanged(input.before, input.after)) return { result: "skipped", companies: 0, tags: 0 };
  const catalog = await deps.catalog.tagIds();
  const deltas = tagCountDeltas(input.before, input.after, catalog);
  const receiptCompany = (countingMembership(input.after, catalog) ?? countingMembership(input.before, catalog))?.companyId;
  if (deltas.size === 0 || !receiptCompany) return { result: "unchanged", companies: 0, tags: 0 };
  const companies = deltas.size;
  const tags = [...deltas.values()].reduce((sum, perCompany) => sum + perCompany.size, 0);
  const result = await deps.store.applyDeltas(receiptIdFor(input.eventId), receiptCompany, deltas);
  return { result, companies, tags };
}
