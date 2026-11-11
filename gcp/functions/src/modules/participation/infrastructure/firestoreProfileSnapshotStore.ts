import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { ProfileSnapshotStore, SnapshotUpdate } from "../application/refreshProfileSnapshots";

export class FirestoreProfileSnapshotStore implements ProfileSnapshotStore {
  constructor(private readonly db: Firestore) {}

  private rsvpRef(companyId: string, eventId: string, uid: string) {
    return this.db.collection("companies").doc(companyId).collection("events").doc(eventId).collection("rsvps").doc(uid);
  }

  async recentEvents(companyId: string, cutoff: Date, limit: number) {
    // Single-field range on endTime: served by the automatic index, no collection-group query.
    const snapshot = await this.db.collection("companies").doc(companyId).collection("events")
      .where("endTime", ">=", Timestamp.fromDate(cutoff)).select("endTime").limit(limit).get();
    return snapshot.docs.map(doc => {
      const end = doc.get("endTime");
      return { eventId: doc.id, endTime: end instanceof Timestamp ? end.toDate() : null };
    });
  }

  async rsvpsFor(companyId: string, uid: string, eventIds: string[]) {
    const out: Array<{ eventId: string; data: Record<string, unknown> }> = [];
    for (let i = 0; i < eventIds.length; i += 100) {
      const chunk = eventIds.slice(i, i + 100);
      const docs = await this.db.getAll(...chunk.map(eventId => this.rsvpRef(companyId, eventId, uid)));
      docs.forEach((doc, index) => { if (doc.exists) out.push({ eventId: chunk[index] as string, data: doc.data() as Record<string, unknown> }); });
    }
    return out;
  }

  async applyUpdates(updates: SnapshotUpdate[]) {
    for (let i = 0; i < updates.length; i += 400) {
      const batch = this.db.batch();
      for (const update of updates.slice(i, i + 400)) batch.update(this.rsvpRef(update.companyId, update.eventId, update.uid), update.patch);
      await batch.commit();
    }
  }
}
