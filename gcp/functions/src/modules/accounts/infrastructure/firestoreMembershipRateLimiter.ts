import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { MembershipRateLimiter } from "../application/ports";
import { AccountsError } from "../domain/errors";

export const MEMBERSHIP_RATE_LIMIT = 5;
export const MEMBERSHIP_RATE_WINDOW_MS = 60_000;

/** One bounded server-only record per UID. expiresAt supports optional Firestore TTL cleanup. */
export class FirestoreMembershipRateLimiter implements MembershipRateLimiter {
  constructor(private readonly db: Firestore, private readonly now: () => number = Date.now) {}

  async consume(uid: string): Promise<void> {
    const ref = this.db.collection("accountRateLimits").doc(uid);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      // Read the clock after the record, on every retry: a delayed request must
      // never replace a newer window with the window when it first arrived.
      const windowStart = Math.floor(this.now() / MEMBERSHIP_RATE_WINDOW_MS) * MEMBERSHIP_RATE_WINDOW_MS;
      const storedWindow: unknown = snapshot.get("windowStart");
      const futureWindow = typeof storedWindow === "number" && storedWindow > windowStart;
      const count = storedWindow === windowStart ? snapshot.get("attempts") : 0;
      // Corrupt records fail closed until the next window.
      if (futureWindow || !Number.isInteger(count) || count < 0 || count >= MEMBERSHIP_RATE_LIMIT) {
        throw new AccountsError("resource-exhausted", "RATE_LIMITED", "Too many requests. Try again later.");
      }
      tx.set(ref, {
        windowStart,
        attempts: count + 1,
        expiresAt: Timestamp.fromMillis(windowStart + MEMBERSHIP_RATE_WINDOW_MS),
      });
    });
  }
}
