import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { TagCatalog, TagStatsStore } from "../application/ports";
import type { TagDeltas } from "../domain/tagCounts";

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALREADY_EXISTS = 6;

export class FirestoreTagStatsStore implements TagStatsStore {
  constructor(private readonly db: Firestore, private readonly now: () => number = Date.now) {}

  async applyDeltas(receiptId: string, receiptCompanyId: string, deltas: TagDeltas): Promise<"applied" | "duplicate"> {
    const batch = this.db.batch();
    batch.create(this.db.doc(`companies/${receiptCompanyId}/tagStatReceipts/${receiptId}`), {
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(this.now() + RECEIPT_TTL_MS),
    });
    for (const [companyId, tags] of deltas) {
      for (const [tagId, delta] of tags) {
        batch.set(this.db.doc(`companies/${companyId}/tagStats/${tagId}`),
          { tagId, memberCount: FieldValue.increment(delta), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
    try {
      await batch.commit();
      return "applied";
    } catch (error) {
      // The create() of an existing receipt aborts the whole batch, so nothing was double counted.
      const code = (error as { code?: unknown }).code;
      if (code === ALREADY_EXISTS || code === "already-exists") return "duplicate";
      throw error;
    }
  }

  async listStats(companyId: string): Promise<{ tagId: string; memberCount: number }[]> {
    const snapshot = await this.db.collection(`companies/${companyId}/tagStats`).limit(500).get();
    return snapshot.docs.map((doc) => {
      const value = doc.get("memberCount");
      return { tagId: doc.id, memberCount: typeof value === "number" ? value : 0 };
    });
  }
}

export class FirestoreTagCatalog implements TagCatalog {
  private cache: { at: number; tags: { id: string; name: string }[] } | null = null;
  constructor(private readonly db: Firestore, private readonly ttlMs: number = 10 * 60 * 1000, private readonly now: () => number = Date.now) {}

  async tags(): Promise<{ id: string; name: string }[]> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.tags;
    const snapshot = await this.db.collection("tags").get();
    const tags = snapshot.docs.map((doc) => {
      const name: unknown = doc.get("name");
      return { id: doc.id, name: typeof name === "string" ? name : doc.id };
    });
    this.cache = { at: this.now(), tags };
    return tags;
  }

  async tagIds(): Promise<ReadonlySet<string>> {
    return new Set((await this.tags()).map((tag) => tag.id));
  }
}
