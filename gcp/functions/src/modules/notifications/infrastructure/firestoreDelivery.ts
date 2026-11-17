import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { DeliveryReceipts, PushRateLimiter } from "../application/routerPorts";
import { nextCounts, type RateLimitState } from "../domain/rateLimit";

const ALREADY_EXISTS = 6;
const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const PARALLEL_TRANSACTIONS = 20;

/** `notificationReceipts/{sha256(key)}`: create-once markers (server-only; enable a TTL policy on `expireAt`). */
export class FirestoreDeliveryReceipts implements DeliveryReceipts {
  constructor(private readonly db: Firestore, private readonly now: () => Date = () => new Date()) {}

  async claim(notificationId: string): Promise<boolean> {
    try {
      await this.db.collection("notificationReceipts").doc(createHash("sha256").update(notificationId, "utf8").digest("hex")).create({
        createdAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(this.now().getTime() + RECEIPT_TTL_MS),
      });
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === ALREADY_EXISTS) return false;
      throw error;
    }
  }
}

function readState(data: Record<string, unknown> | undefined): RateLimitState | null {
  if (!data) return null;
  const { hourKey, hourCount, dayKey, dayCount } = data;
  if (typeof hourKey !== "string" || typeof dayKey !== "string" || typeof hourCount !== "number" || typeof dayCount !== "number") return null;
  return { hourKey, hourCount, dayKey, dayCount };
}

/** `pushRateLimits/{uid}`: one transaction per user (server-only; enable a TTL policy on `expireAt`). */
export class FirestorePushRateLimiter implements PushRateLimiter {
  constructor(private readonly db: Firestore) {}

  private admitOne(uid: string, now: Date): Promise<boolean> {
    const ref = this.db.collection("pushRateLimits").doc(uid);
    return this.db.runTransaction(async (tx) => {
      const { admitted, state } = nextCounts(readState((await tx.get(ref)).data()), now);
      tx.set(ref, { ...state, expireAt: Timestamp.fromMillis(now.getTime() + RATE_LIMIT_TTL_MS) });
      return admitted;
    });
  }

  async admit(uids: readonly string[], now: Date): Promise<Set<string>> {
    const unique = [...new Set(uids)];
    const allowed = new Set<string>();
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const uid = unique[next++]!;
        if (await this.admitOne(uid, now)) allowed.add(uid);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_TRANSACTIONS, unique.length) }, worker));
    return allowed;
  }
}
