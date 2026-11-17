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

export interface StatDoc {
  tagId: string;
  memberCount: number;
  updatedAtMs: number | null;
  /** Opaque document version (Firestore update time) used as the write precondition. */
  version: unknown;
}

/** Reads and guarded writes used by the reconcile job. Writes return "concurrent" when the document changed (or appeared) since it was read. */
export interface TagReconcileStore {
  listCompanyIds(after: string | null, limit: number): Promise<string[]>;
  /** Members of the company holding the tag: companyId == c and not deactivated (a missing status counts). */
  countMembersWithTag(companyId: string, tagId: string): Promise<number>;
  listStatDocs(companyId: string): Promise<StatDoc[]>;
  writeCorrection(companyId: string, tagId: string, to: number, existingVersion: unknown | null): Promise<"written" | "concurrent">;
  deleteOrphan(companyId: string, tagId: string, version: unknown): Promise<"deleted" | "concurrent">;
}
