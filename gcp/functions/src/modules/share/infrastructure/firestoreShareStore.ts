import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { ShareEventStore } from "../application/getSharePage";
import type { ShareEvent } from "../domain/sharePage";

/** Top-level, server-owned index `eventShares/{eventId}` -> `{ companyId }` (docs/design/share-links.md). */
export const EVENT_SHARES = "eventShares";

/** Firestore field mask: the event's venue, tags, counts and audit fields are never read. */
const EVENT_FIELDS = ["companyId", "title", "description", "startTime", "coverImageURL", "status"];

/**
 * Admin SDK adapter. Two bounded reads per request: the index document, then the event with a field
 * mask. The company id comes from the server-owned index, never from the request.
 */
export class FirestoreShareEventStore implements ShareEventStore {
  constructor(private readonly db: Firestore) {}

  async findEvent(eventId: string): Promise<ShareEvent | null> {
    const index = await this.db.collection(EVENT_SHARES).doc(eventId).get();
    const companyId: unknown = index.get("companyId");
    if (!index.exists || typeof companyId !== "string" || companyId === "" || companyId.includes("/")) return null;
    const ref = this.db.collection("companies").doc(companyId).collection("events").doc(eventId);
    const [snap] = await this.db.getAll(ref, { fieldMask: EVENT_FIELDS });
    if (!snap || !snap.exists || snap.get("companyId") !== companyId) return null;
    const title: unknown = snap.get("title");
    const description: unknown = snap.get("description");
    const startTime: unknown = snap.get("startTime");
    const coverImageURL: unknown = snap.get("coverImageURL");
    const status: unknown = snap.get("status");
    return {
      title: typeof title === "string" ? title : "",
      description: typeof description === "string" ? description : "",
      startTime: startTime instanceof Timestamp ? startTime.toDate() : null,
      coverImageURL: typeof coverImageURL === "string" ? coverImageURL : "",
      status: typeof status === "string" ? status : "",
    };
  }
}
