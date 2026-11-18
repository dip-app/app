import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { RateLimiter } from "../../admin/application/ports";
import { AdminError } from "../../admin/domain/errors";

/** Per-user burst limit of the place lookups: tolerant of debounced typing (about one request per second), separate from the admin bucket. */
export const PLACES_RATE_LIMIT = 60;
export const PLACES_RATE_WINDOW_MS = 60_000;

/** One bounded server-only record per caller (placesRateLimits/{uid}); expiresAt supports an optional TTL policy. */
export class FirestorePlacesRateLimiter implements RateLimiter {
  constructor(private readonly db: Firestore, private readonly now: () => number = Date.now) {}

  async consume(uid: string): Promise<void> {
    const ref = this.db.collection("placesRateLimits").doc(uid);
    await this.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const windowStart = Math.floor(this.now() / PLACES_RATE_WINDOW_MS) * PLACES_RATE_WINDOW_MS;
      const storedWindow: unknown = snapshot.get("windowStart");
      const count: unknown = storedWindow === windowStart ? snapshot.get("calls") : 0;
      if ((typeof storedWindow === "number" && storedWindow > windowStart) || typeof count !== "number" || count < 0 || count >= PLACES_RATE_LIMIT) {
        throw new AdminError("resource-exhausted", "RATE_LIMITED", "Too many requests. Try again later.");
      }
      tx.set(ref, { windowStart, calls: count + 1, expiresAt: Timestamp.fromMillis(windowStart + PLACES_RATE_WINDOW_MS) });
    });
  }
}
