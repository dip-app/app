import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { ShareEventStore } from "../application/getSharePage";
import type { ShareEvent } from "../domain/sharePage";
import { COMPANY_SETTINGS_COLLECTION } from "../../email/domain/outbox";

/** Top-level, server-owned index `eventShares/{eventId}` -> `{ companyId }` (docs/design/share-links.md). */
export const EVENT_SHARES = "eventShares";

/** Firestore field mask: the event's venue, tags, counts and audit fields are never read. */
const EVENT_FIELDS = ["companyId", "title", "description", "startTime", "coverImageURL", "status"];

/**
 * Admin SDK adapter. Bounded reads per request: the index document, then (in parallel) the event with a field mask and
 * the company's `emailSettings` time zone. The company id comes from the server-owned index, never from the request.
 */
export class FirestoreShareEventStore implements ShareEventStore {
  constructor(private readonly db: Firestore) {}

  async findEvent(eventId: string): Promise<ShareEvent | null> {
    const index = await this.db.collection(EVENT_SHARES).doc(eventId).get();
    const companyId: unknown = index.get("companyId");
    if (!index.exists || typeof companyId !== "string" || companyId === "" || companyId.includes("/")) return null;
    const ref = this.db.collection("companies").doc(companyId).collection("events").doc(eventId);
    // The company's time zone (server-only email settings) only localizes the coarse date; it is never rendered.
    const settingsRef = this.db.collection(COMPANY_SETTINGS_COLLECTION).doc(companyId);
    const [[snap], [settings]] = await Promise.all([
      this.db.getAll(ref, { fieldMask: EVENT_FIELDS }),
      this.db.getAll(settingsRef, { fieldMask: ["timeZone"] }).catch(() => [undefined]),
    ]);
    if (!snap || !snap.exists || snap.get("companyId") !== companyId) return null;
    const timeZone: unknown = settings?.exists ? settings.get("timeZone") : null;
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
      timeZone: typeof timeZone === "string" && timeZone.length <= 64 ? timeZone : null,
    };
  }
}
