import { FieldPath, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { MemberPager, WeeklyTheme, WeeklyThemeReader } from "../application/routerPorts";

const MAX_THEMES = 200;
const ACTIVE_ROLES = ["member", "admin"];

/** Admin SDK adapter: weekly themes across companies and paged company members (server-side only). */
export class FirestoreThemes implements WeeklyThemeReader, MemberPager {
  constructor(private readonly db: Firestore) {}

  /**
   * Collection-group query on `challenges` (`type == "weekly"`, range on `startDate`): needs the composite
   * collection-group index (type ASC, startDate ASC). Documents that fail the shape check are skipped.
   */
  async startedBetween(from: Date, to: Date): Promise<WeeklyTheme[]> {
    const snapshot = await this.db.collectionGroup("challenges")
      .where("type", "==", "weekly")
      .where("startDate", ">", Timestamp.fromDate(from))
      .where("startDate", "<=", Timestamp.fromDate(to))
      .orderBy("startDate").limit(MAX_THEMES).get();
    const themes: WeeklyTheme[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const companyId = doc.ref.parent.parent?.parent.id === "companies" ? doc.ref.parent.parent.id : null;
      if (!companyId || data.companyId !== companyId || typeof data.title !== "string") continue;
      const start = data.startDate instanceof Timestamp ? data.startDate.toDate() : null;
      const end = data.endDate instanceof Timestamp ? data.endDate.toDate() : null;
      if (!start || !end) continue;
      themes.push({ companyId, challengeId: doc.id, title: data.title, startDate: start, endDate: end });
    }
    return themes;
  }

  async page(companyId: string, afterUid: string | null, limit: number): Promise<{ uids: string[]; last: string | null }> {
    let query = this.db.collection("users").where("companyId", "==", companyId)
      .orderBy(FieldPath.documentId()).select("role", "status").limit(limit);
    if (afterUid) query = query.startAfter(afterUid);
    const snapshot = await query.get();
    const uids = snapshot.docs.filter((doc) => doc.get("status") !== "deactivated" && ACTIVE_ROLES.includes(doc.get("role"))).map((doc) => doc.id);
    const last = snapshot.size < limit ? null : snapshot.docs[snapshot.size - 1]!.id;
    return { uids, last };
  }
}
