import { FieldPath, type Firestore } from "firebase-admin/firestore";
import type { AlbumPhoto, AlbumReader } from "../application/socialTriggers";

const PAGE = 500;

/** Admin SDK reads for the album triggers. Paths come from trigger parameters only. */
export class FirestoreAlbum implements AlbumReader {
  constructor(private readonly db: Firestore) {}

  private event(companyId: string, eventId: string) {
    return this.db.collection("companies").doc(companyId).collection("events").doc(eventId);
  }

  async photo(companyId: string, eventId: string, photoId: string): Promise<AlbumPhoto | null> {
    const snap = await this.event(companyId, eventId).collection("photos").doc(photoId).get();
    if (!snap.exists) return null;
    const { companyId: photoCompany, uploaderId, uploaderName, eventTitle } = snap.data() as Record<string, unknown>;
    if (typeof photoCompany !== "string" || typeof uploaderId !== "string") return null;
    return {
      companyId: photoCompany, uploaderId,
      uploaderName: typeof uploaderName === "string" ? uploaderName : "", eventTitle: typeof eventTitle === "string" ? eventTitle : "",
    };
  }

  async goingAttendees(companyId: string, eventId: string, limit: number): Promise<string[]> {
    const uids: string[] = [];
    let query = this.event(companyId, eventId).collection("rsvps")
      .where("status", "==", "going").orderBy(FieldPath.documentId()).select("companyId").limit(Math.min(PAGE, limit));
    for (;;) {
      const snap = await query.get();
      // The RSVP row must carry this company (same guard as RecipientDirectory.going).
      for (const doc of snap.docs) if (doc.get("companyId") === companyId) uids.push(doc.id);
      if (snap.size < Math.min(PAGE, limit) || uids.length >= limit) return uids.slice(0, limit);
      query = query.startAfter(snap.docs[snap.docs.length - 1]!);
    }
  }
}
