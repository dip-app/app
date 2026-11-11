import { randomBytes } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import type { App } from "firebase-admin/app";
import type { Storage } from "firebase-admin/storage";
import { AdminError } from "../domain/errors";
import type {
  AdminStore, AdminTransaction, Doc, GroupQuery, ListQuery, ObjectStore, RateLimiter, SessionRevoker,
} from "../application/ports";

/** Domain value -> Firestore value: Dates become Timestamps, markers become field values, undefined is dropped. */
export function toFirestore(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(toFirestore);
  if (value && typeof value === "object") {
    const marker = (value as { __op?: unknown }).__op;
    if (marker === "serverTime") return FieldValue.serverTimestamp();
    if (marker === "increment") return FieldValue.increment((value as { by: number }).by);
    if (marker === "deleteField") return FieldValue.delete();
    if (value instanceof Timestamp) return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = toFirestore(item);
    return out;
  }
  return value;
}

/** Firestore value -> domain value: Timestamps become Dates. */
export function fromFirestore(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(fromFirestore);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromFirestore(item)]));
  }
  return value;
}

const readDoc = (data: DocumentData | undefined): Doc | null => (data ? (fromFirestore(data) as Doc) : null);

/** Random opaque ids (base64url, matches the contract's ID pattern). */
export const randomId = () => randomBytes(15).toString("base64url");

/**
 * Admin SDK adapter. Admin access bypasses Security Rules, so every service authorizes before queueing a write.
 * Writes are buffered and applied at the end of the work function, after all reads (Firestore transaction rule).
 */
export class FirestoreAdminStore implements AdminStore {
  constructor(private readonly db: Firestore) {}

  private tx(transaction: Transaction, writes: Array<() => void> | null): AdminTransaction {
    const db = this.db;
    const queue = (apply: () => void) => {
      if (!writes) throw new AdminError("internal", "INVALID_STORED_DATA", "Write attempted in a read-only transaction.");
      writes.push(apply);
    };
    return {
      get: async path => readDoc((await transaction.get(db.doc(path))).data()),
      list: async (collectionPath, query: ListQuery) => {
        let ref = db.collection(collectionPath) as FirebaseFirestore.Query;
        for (const [field, value] of query.where ?? []) ref = ref.where(field, "==", value);
        ref = ref.orderBy(FieldPath.documentId());
        if (query.afterId) ref = ref.startAfter(query.afterId);
        const snap = await transaction.get(ref.limit(query.limit));
        return snap.docs.map(d => ({ id: d.id, data: readDoc(d.data()) ?? {} }));
      },
      count: async collectionPath => (await transaction.get(db.collection(collectionPath).count())).data().count,
      create: (path, data) => queue(() => { transaction.create(db.doc(path), toFirestore(data) as DocumentData); }),
      update: (path, data) => queue(() => { transaction.update(db.doc(path), toFirestore(data) as DocumentData); }),
      delete: path => queue(() => { transaction.delete(db.doc(path)); }),
    };
  }

  runTransaction<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async transaction => {
      const writes: Array<() => void> = [];
      const result = await work(this.tx(transaction, writes));
      for (const apply of writes) apply();
      return result;
      // Hot documents (an event's attendeeCount, a member's balance) can see bursts of admin writes.
    }, { maxAttempts: 10 });
  }

  runReadOnly<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async transaction => work(this.tx(transaction, null)), { readOnly: true });
  }

  async queryGroup(group: string, query: GroupQuery) {
    let ref = this.db.collectionGroup(group) as FirebaseFirestore.Query;
    for (const [field, op, value] of query.where) ref = ref.where(field, op, toFirestore(value));
    if (query.orderBy) ref = ref.orderBy(query.orderBy);
    const snap = await ref.limit(query.limit).get();
    return snap.docs.map(d => ({ path: d.ref.path, data: readDoc(d.data()) ?? {} }));
  }

  async deletePage(collectionPath: string, limit: number): Promise<number> {
    const snap = await this.db.collection(collectionPath).limit(limit).get();
    if (snap.empty) return 0;
    const batch = this.db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }
}

export class StorageObjects implements ObjectStore {
  constructor(private readonly storage: Storage) {}

  async remove(path: string): Promise<boolean> {
    try {
      await this.storage.bucket().file(path).delete({ ignoreNotFound: true });
      return true;
    } catch {
      return false;
    }
  }
}

export class AuthSessions implements SessionRevoker {
  constructor(private readonly app: App) {}
  async revoke(uid: string): Promise<void> {
    await getAuth(this.app).revokeRefreshTokens(uid);
  }
}

export const ADMIN_RATE_LIMIT = 120;
export const ADMIN_RATE_WINDOW_MS = 60_000;

/** One bounded server-only record per caller (adminRateLimits/{uid}); expiresAt supports an optional TTL policy. */
export class FirestoreAdminRateLimiter implements RateLimiter {
  constructor(private readonly db: Firestore, private readonly now: () => number = Date.now) {}

  async consume(uid: string): Promise<void> {
    const ref = this.db.collection("adminRateLimits").doc(uid);
    await this.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const windowStart = Math.floor(this.now() / ADMIN_RATE_WINDOW_MS) * ADMIN_RATE_WINDOW_MS;
      const storedWindow: unknown = snapshot.get("windowStart");
      const count: unknown = storedWindow === windowStart ? snapshot.get("calls") : 0;
      if ((typeof storedWindow === "number" && storedWindow > windowStart) || typeof count !== "number" || count < 0 || count >= ADMIN_RATE_LIMIT) {
        throw new AdminError("resource-exhausted", "RATE_LIMITED", "Too many requests. Try again later.");
      }
      tx.set(ref, { windowStart, calls: count + 1, expiresAt: Timestamp.fromMillis(windowStart + ADMIN_RATE_WINDOW_MS) });
    });
  }
}
