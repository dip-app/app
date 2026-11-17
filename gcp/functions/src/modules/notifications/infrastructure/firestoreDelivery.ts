import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { DeliveryReceipts, MembershipReader, PushRateLimiter } from "../application/routerPorts";
import { isDeactivated } from "../../admin/domain/member";
import { nextCounts, type RateClass, type RateCounter, type RateLimitState } from "../domain/rateLimit";

const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A claim whose sender crashed becomes claimable again after this lease. */
export const RECEIPT_LEASE_MS = 5 * 60 * 1000;
const RATE_LIMIT_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const PARALLEL_TRANSACTIONS = 20;

/**
 * `notificationReceipts/{sha256(key)}`: two-phase markers (server-only; enable a TTL policy on `expireAt`).
 * `claim` writes `state: "processing"` + `leaseUntil`; `complete` sets `state: "done"`. Receipts written before
 * two-phase have no `state` and are treated as done.
 */
export class FirestoreDeliveryReceipts implements DeliveryReceipts {
  constructor(private readonly db: Firestore, private readonly now: () => Date = () => new Date()) {}

  private ref(notificationId: string) {
    return this.db.collection("notificationReceipts").doc(createHash("sha256").update(notificationId, "utf8").digest("hex"));
  }

  async claim(notificationId: string): Promise<boolean> {
    const ref = this.ref(notificationId);
    const nowMs = this.now().getTime();
    const lease = Timestamp.fromMillis(nowMs + RECEIPT_LEASE_MS);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.create(ref, {
          createdAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(nowMs + RECEIPT_TTL_MS),
          state: "processing", leaseUntil: lease,
        });
        return true;
      }
      const leaseUntil: unknown = snap.get("leaseUntil");
      const expired = snap.get("state") === "processing" && leaseUntil instanceof Timestamp && leaseUntil.toMillis() <= nowMs;
      if (!expired) return false;
      tx.update(ref, { leaseUntil: lease, attempts: FieldValue.increment(1) });
      return true;
    });
  }

  async complete(notificationId: string): Promise<void> {
    await this.ref(notificationId).set({ state: "done", completedAt: FieldValue.serverTimestamp(), leaseUntil: FieldValue.delete() }, { merge: true });
  }

  async isDone(notificationId: string): Promise<boolean> {
    const snap = await this.ref(notificationId).get();
    return snap.exists && snap.get("state") !== "processing";
  }
}

function readCounter(data: unknown): RateCounter | null {
  if (!data || typeof data !== "object") return null;
  const { hourKey, hourCount, dayKey, dayCount } = data as Record<string, unknown>;
  if (typeof hourKey !== "string" || typeof dayKey !== "string" || typeof hourCount !== "number" || typeof dayCount !== "number") return null;
  return { hourKey, hourCount, dayKey, dayCount };
}

function readState(data: Record<string, unknown> | undefined): RateLimitState | null {
  const base = readCounter(data);
  if (!base) return null;
  const raw = (data?.buckets ?? {}) as Record<string, unknown>;
  const chat = readCounter(raw.chat);
  const changes = readCounter(raw.changes);
  return chat || changes ? { ...base, buckets: { ...(chat ? { chat } : {}), ...(changes ? { changes } : {}) } } : base;
}

/** `pushRateLimits/{uid}`: one transaction per user (server-only; enable a TTL policy on `expireAt`). */
export class FirestorePushRateLimiter implements PushRateLimiter {
  constructor(private readonly db: Firestore) {}

  private admitOne(uid: string, now: Date, rateClass: RateClass): Promise<boolean> {
    const ref = this.db.collection("pushRateLimits").doc(uid);
    return this.db.runTransaction(async (tx) => {
      const { admitted, state } = nextCounts(readState((await tx.get(ref)).data()), now, rateClass);
      tx.set(ref, { ...state, expireAt: Timestamp.fromMillis(now.getTime() + RATE_LIMIT_TTL_MS) });
      return admitted;
    });
  }

  async admit(uids: readonly string[], now: Date, rateClass: RateClass = "shared"): Promise<Set<string>> {
    if (rateClass === "exempt") return new Set(uids);
    const unique = [...new Set(uids)];
    const allowed = new Set<string>();
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const uid = unique[next++]!;
        if (await this.admitOne(uid, now, rateClass)) allowed.add(uid);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_TRANSACTIONS, unique.length) }, worker));
    return allowed;
  }
}

const MEMBER_READ_CHUNK = 100;

/** Send-time membership check against `users/{uid}`: same company and not deactivated (missing status means active). */
export class FirestoreMembership implements MembershipReader {
  constructor(private readonly db: Firestore) {}

  async activeIn(companyId: string, uids: readonly string[]): Promise<Set<string>> {
    const unique = [...new Set(uids)];
    const active = new Set<string>();
    for (let offset = 0; offset < unique.length; offset += MEMBER_READ_CHUNK) {
      const refs = unique.slice(offset, offset + MEMBER_READ_CHUNK).map((uid) => this.db.collection("users").doc(uid));
      for (const snap of await this.db.getAll(...refs)) {
        if (snap.exists && snap.get("companyId") === companyId && !isDeactivated({ status: snap.get("status") })) active.add(snap.id);
      }
    }
    return active;
  }
}
