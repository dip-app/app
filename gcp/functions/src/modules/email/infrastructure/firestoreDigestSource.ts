import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { DigestSource, FinishedImport, RosterJoin } from "../application/adminDigest";
import { COMPANY_SETTINGS_COLLECTION } from "../domain/outbox";

const ADMIN_LIMIT = 200;
const FINISHED = new Set(["completed", "completed_with_errors"]);
const INVITED_SOURCES = new Set(["manual", "import"]);

const toDate = (value: unknown): Date | null => (value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

/**
 * Admin SDK reads for the admin roster digest. Every query is a single-field range (`claimedAt`, `updatedAt`) inside one
 * company, so no composite index is needed; the remaining filters (source, status) run in memory on a bounded page.
 */
export class FirestoreDigestSource implements DigestSource {
  constructor(private readonly db: Firestore) {}

  async listEmailCompanies(limit: number): Promise<string[]> {
    const snap = await this.db.collection(COMPANY_SETTINGS_COLLECTION).where("enabled", "==", true).limit(limit).get();
    return snap.docs.map((doc) => doc.id);
  }

  async listAdmins(companyId: string): Promise<string[]> {
    const snap = await this.db.collection("users").where("companyId", "==", companyId).where("role", "==", "admin").limit(ADMIN_LIMIT).get();
    return snap.docs.filter((doc) => doc.get("status") !== "deactivated").map((doc) => doc.id);
  }

  async joinsBetween(companyId: string, from: Date, to: Date, limit: number): Promise<RosterJoin[]> {
    const snap = await this.db.collection("companies").doc(companyId).collection("roster")
      .where("claimedAt", ">=", Timestamp.fromDate(from)).where("claimedAt", "<", Timestamp.fromDate(to))
      .orderBy("claimedAt").select("companyId", "status", "source", "displayName", "claimedAt").limit(limit).get();
    const out: RosterJoin[] = [];
    for (const doc of snap.docs) {
      const claimedAt = toDate(doc.get("claimedAt"));
      if (doc.get("companyId") !== companyId || doc.get("status") !== "claimed" || !INVITED_SOURCES.has(doc.get("source")) || !claimedAt) continue;
      const name: unknown = doc.get("displayName");
      out.push({ displayName: typeof name === "string" ? name : "", claimedAt });
    }
    return out;
  }

  async importsFinishedBetween(companyId: string, from: Date, to: Date, limit: number): Promise<FinishedImport[]> {
    const snap = await this.db.collection("companies").doc(companyId).collection("importJobs")
      .where("updatedAt", ">=", Timestamp.fromDate(from)).where("updatedAt", "<", Timestamp.fromDate(to))
      .orderBy("updatedAt", "desc").select("companyId", "status", "progress", "updatedAt").limit(limit).get();
    const out: FinishedImport[] = [];
    for (const doc of snap.docs) {
      const finishedAt = toDate(doc.get("updatedAt"));
      if (doc.get("companyId") !== companyId || !FINISHED.has(doc.get("status")) || !finishedAt) continue;
      const progress = (doc.get("progress") ?? {}) as Record<string, unknown>;
      out.push({ invited: count(progress.created), updated: count(progress.updated), failed: count(progress.failed), finishedAt });
    }
    return out;
  }
}
