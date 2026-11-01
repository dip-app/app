import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { AccountsError } from "../domain/errors";

export const JOIN_RATE_LIMIT = 5;
export const JOIN_RATE_WINDOW_MS = 60_000;

/** One bounded server-only record per UID. expiresAt supports optional Firestore TTL cleanup. */
export class FirestoreJoinRateLimiter {
  constructor(private readonly db: Firestore, private readonly now: () => number = Date.now) {}

  async consume(uid: string): Promise<void> {
    const now = this.now();
    const windowStart = Math.floor(now / JOIN_RATE_WINDOW_MS) * JOIN_RATE_WINDOW_MS;
    const ref = this.db.collection("accountRateLimits").doc(uid);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const count = snapshot.get("windowStart") === windowStart ? snapshot.get("attempts") : 0;
      // Corrupt records fail closed until the next window.
      if (!Number.isInteger(count) || count < 0 || count >= JOIN_RATE_LIMIT) {
        throw new AccountsError("resource-exhausted", "RATE_LIMITED", "Too many requests. Try again later.");
      }
      tx.set(ref, {
        windowStart,
        attempts: count + 1,
        expiresAt: Timestamp.fromMillis(windowStart + JOIN_RATE_WINDOW_MS),
      });
    });
  }
}
