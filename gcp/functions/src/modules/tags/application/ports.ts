import type { TagDeltas } from "../domain/tagCounts";

export interface TagCatalog {
  tagIds(): Promise<ReadonlySet<string>>;
  tags(): Promise<{ id: string; name: string }[]>;
}

export interface TagStatsStore {
  /** Applies all deltas and records the receipt in one atomic write. "duplicate" means the receipt already existed and nothing was written. */
  applyDeltas(receiptId: string, receiptCompanyId: string, deltas: TagDeltas): Promise<"applied" | "duplicate">;
  listStats(companyId: string): Promise<{ tagId: string; memberCount: number }[]>;
}
