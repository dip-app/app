import { FieldPath, FieldValue, Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { StatDoc, TagReconcileStore } from "../application/ports";

const NOT_FOUND = 5;
const ALREADY_EXISTS = 6;
const FAILED_PRECONDITION = 9;
const codeOf = (error: unknown): unknown => (error as { code?: unknown }).code;
const isCode = (error: unknown, numeric: number, text: string) => codeOf(error) === numeric || codeOf(error) === text;

export class FirestoreTagReconcileStore implements TagReconcileStore {
  constructor(private readonly db: Firestore) {}

  async listCompanyIds(after: string | null, limit: number): Promise<string[]> {
    let query = this.db.collection("companies").orderBy(FieldPath.documentId()).select().limit(limit);
    if (after !== null) query = query.startAfter(after);
    return (await query.get()).docs.map((doc) => doc.id);
  }

  /** count(companyId == c, tag) - count(companyId == c, status == "deactivated", tag). Not `status != "deactivated"`, which drops docs without a status. */
  async countMembersWithTag(companyId: string, tagId: string): Promise<number> {
    const members = this.db.collection("users").where("companyId", "==", companyId);
    const [all, deactivated] = await Promise.all([
      members.where("interestTagIds", "array-contains", tagId).count().get(),
      members.where("status", "==", "deactivated").where("interestTagIds", "array-contains", tagId).count().get(),
    ]);
    // Two non-atomic reads can disagree by a concurrent write; never report a negative member count.
    return Math.max(0, all.data().count - deactivated.data().count);
  }

  async listStatDocs(companyId: string): Promise<StatDoc[]> {
    const docs: StatDoc[] = [];
    let last: QueryDocumentSnapshot | null = null;
    for (;;) {
      let query = this.db.collection(`companies/${companyId}/tagStats`).orderBy(FieldPath.documentId()).limit(500);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      for (const doc of page.docs) {
        const count: unknown = doc.get("memberCount");
        const updatedAt: unknown = doc.get("updatedAt");
        docs.push({
          tagId: doc.id,
          memberCount: typeof count === "number" ? count : 0,
          updatedAtMs: updatedAt instanceof Timestamp ? updatedAt.toMillis() : null,
          version: doc.updateTime,
        });
      }
      if (page.size < 500) return docs;
      last = page.docs[page.docs.length - 1]!;
    }
  }

  async writeCorrection(companyId: string, tagId: string, to: number, existingVersion: unknown | null): Promise<"written" | "concurrent"> {
    const ref = this.db.doc(`companies/${companyId}/tagStats/${tagId}`);
    try {
      if (existingVersion === null) {
        await ref.create({ tagId, memberCount: to, updatedAt: FieldValue.serverTimestamp(), reconciledAt: FieldValue.serverTimestamp() });
      } else {
        await ref.update({ memberCount: to, updatedAt: FieldValue.serverTimestamp(), reconciledAt: FieldValue.serverTimestamp() },
          { lastUpdateTime: existingVersion as Timestamp });
      }
      return "written";
    } catch (error) {
      if (isCode(error, ALREADY_EXISTS, "already-exists") || isCode(error, FAILED_PRECONDITION, "failed-precondition") || isCode(error, NOT_FOUND, "not-found")) return "concurrent";
      throw error;
    }
  }

  async deleteOrphan(companyId: string, tagId: string, version: unknown): Promise<"deleted" | "concurrent"> {
    try {
      await this.db.doc(`companies/${companyId}/tagStats/${tagId}`).delete({ lastUpdateTime: version as Timestamp });
      return "deleted";
    } catch (error) {
      if (isCode(error, FAILED_PRECONDITION, "failed-precondition") || isCode(error, NOT_FOUND, "not-found")) return "concurrent";
      throw error;
    }
  }
}
