import { FieldPath, FieldValue, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import type {
  ChangeLogStore, ClaimStore, DeviceDirectory, DeviceRegistry, DeviceRegistryTransaction, DeviceToken, EventReader,
  EventSummary, RecipientDirectory, SubscriptionStore, UpcomingEvents,
} from "../application/ports";
import { mergeChangeLog } from "../domain/changeLog";
import { isSubscriptionLevel, DEFAULT_LEVEL_ON_JOIN } from "../domain/subscription";
import { MAX_DEVICES_PER_USER } from "../domain/device";

const PAGE = 500;
const GET_ALL_CHUNK = 100;
const PARALLEL_USERS = 20;
/** Push receipts only need to outlive trigger redelivery and the reminder windows. Enable a TTL policy on
 * `pushReceipts.expireAt` at deployment to purge them (optional; they are tiny). */
const RECEIPT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const ALREADY_EXISTS = 6;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

/** Firestore Timestamp values become Date so domain code never depends on the Admin SDK. */
export function plainEvent(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  for (const key of ["startTime", "endTime", "createdAt"]) if (data[key] instanceof Timestamp) result[key] = (data[key] as Timestamp).toDate();
  return result;
}

/**
 * Admin SDK adapters for the notifications module. Admin access bypasses Security Rules: every path here is
 * derived from trigger parameters or the verified caller UID, never from client payload fields.
 */
export class FirestoreNotificationsStore implements
  DeviceDirectory, RecipientDirectory, ClaimStore, EventReader, UpcomingEvents, ChangeLogStore, SubscriptionStore, DeviceRegistry {
  constructor(private readonly db: Firestore, private readonly now: () => Date = () => new Date()) {}

  private event(companyId: string, eventId: string): DocumentReference {
    return this.db.collection("companies").doc(companyId).collection("events").doc(eventId);
  }

  private device(uid: string, tokenHash: string): DocumentReference {
    return this.db.collection("users").doc(uid).collection("devices").doc(tokenHash);
  }

  async tokensFor(uids: readonly string[]): Promise<DeviceToken[]> {
    const result: DeviceToken[] = [];
    for (const group of chunks(uids, PARALLEL_USERS)) {
      const snaps = await Promise.all(group.map((uid) =>
        this.db.collection("users").doc(uid).collection("devices").limit(MAX_DEVICES_PER_USER).get()));
      snaps.forEach((snap, index) => {
        for (const doc of snap.docs) {
          const token: unknown = doc.get("token");
          if (typeof token === "string" && token.length > 0) result.push({ uid: group[index]!, tokenHash: doc.id, token });
        }
      });
    }
    return result;
  }

  async remove(devices: readonly DeviceToken[]): Promise<void> {
    for (const group of chunks(devices, PAGE)) {
      const batch = this.db.batch();
      for (const device of group) batch.delete(this.device(device.uid, device.tokenHash));
      await batch.commit();
    }
  }

  async subscribers(companyId: string, eventId: string, levels: readonly string[]): Promise<string[]> {
    const uids: string[] = [];
    let query = this.event(companyId, eventId).collection("subscriptions")
      .where("level", "in", [...levels]).orderBy(FieldPath.documentId()).select().limit(PAGE);
    for (;;) {
      const snap = await query.get();
      uids.push(...snap.docs.map((doc) => doc.id));
      if (snap.size < PAGE) return uids;
      query = query.startAfter(snap.docs[snap.docs.length - 1]!);
    }
  }

  async going(companyId: string, eventId: string, uids: readonly string[]): Promise<Set<string>> {
    const going = new Set<string>();
    const rsvps = this.event(companyId, eventId).collection("rsvps");
    for (const group of chunks(uids, GET_ALL_CHUNK)) {
      if (group.length === 0) continue;
      const snaps = await this.db.getAll(...group.map((uid) => rsvps.doc(uid)));
      for (const snap of snaps) if (snap.exists && snap.get("status") === "going" && snap.get("companyId") === companyId) going.add(snap.id);
    }
    return going;
  }

  async claim(companyId: string, eventId: string, key: string): Promise<boolean> {
    try {
      await this.event(companyId, eventId).collection("pushReceipts").doc(key).create({
        createdAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(this.now().getTime() + RECEIPT_TTL_MS),
      });
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === ALREADY_EXISTS) return false;
      throw error;
    }
  }

  private summary(companyId: string, eventId: string, data: Record<string, unknown> | undefined): EventSummary | null {
    if (!data) return null;
    const startTime = toDate(data.startTime);
    const endTime = toDate(data.endTime);
    if (!startTime || !endTime || typeof data.status !== "string") return null;
    return { companyId, eventId, title: typeof data.title === "string" ? data.title : "", status: data.status, startTime, endTime };
  }

  async get(companyId: string, eventId: string): Promise<EventSummary | null> {
    return this.summary(companyId, eventId, (await this.event(companyId, eventId).get()).data());
  }

  async scheduledStartingIn(from: Date, to: Date): Promise<EventSummary[]> {
    const result: EventSummary[] = [];
    let query = this.db.collectionGroup("events")
      .where("status", "==", "scheduled")
      .where("startTime", ">", Timestamp.fromDate(from))
      .where("startTime", "<=", Timestamp.fromDate(to))
      .orderBy("startTime").limit(PAGE);
    for (;;) {
      const snap = await query.get();
      for (const doc of snap.docs) {
        // Only companies/{c}/events/{e}; ignore any other collection that happens to be called "events".
        const company = doc.ref.parent.parent;
        if (!company || company.parent.id !== "companies" || company.parent.parent !== null) continue;
        const summary = this.summary(company.id, doc.id, doc.data());
        if (summary && doc.get("companyId") === company.id) result.push(summary);
      }
      if (snap.size < PAGE) return result;
      query = query.startAfter(snap.docs[snap.docs.length - 1]!);
    }
  }

  async append(companyId: string, eventId: string, entry: Parameters<ChangeLogStore["append"]>[2]): Promise<boolean> {
    const ref = this.event(companyId, eventId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const stored = { at: Timestamp.fromDate(entry.at), by: entry.by, revision: entry.revision, changes: entry.changes };
      const { log, appended } = mergeChangeLog(snap.get("changeLog"), stored);
      // Only changeLog is written, so the trigger it causes finds no user-visible change and stops.
      if (appended) tx.update(ref, { changeLog: log });
      return appended;
    });
  }

  async reconcile(companyId: string, eventId: string, uid: string, decide: Parameters<SubscriptionStore["reconcile"]>[3]) {
    const event = this.event(companyId, eventId);
    const rsvpRef = event.collection("rsvps").doc(uid);
    const subscriptionRef = event.collection("subscriptions").doc(uid);
    return this.db.runTransaction(async (tx) => {
      const [rsvp, subscription] = await tx.getAll(rsvpRef, subscriptionRef);
      const level: unknown = subscription?.get("level");
      const decision = decide({
        rsvpStatus: rsvp?.exists && rsvp.get("companyId") === companyId ? String(rsvp.get("status")) : null,
        subscriptionLevel: subscription?.exists ? (isSubscriptionLevel(level) ? level : "none") : null,
        subscriptionUpdatedAt: subscription?.exists ? toDate(subscription.get("updatedAt")) : null,
      });
      if (decision === "create-default") tx.create(subscriptionRef, { level: DEFAULT_LEVEL_ON_JOIN, updatedAt: FieldValue.serverTimestamp() });
      if (decision === "delete") tx.delete(subscriptionRef);
      return decision;
    });
  }

  runTransaction<T>(work: (tx: DeviceRegistryTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const tx: DeviceRegistryTransaction = {
        getMember: async (uid) => {
          const snap = await transaction.get(this.db.collection("users").doc(uid));
          if (!snap.exists) return null;
          const companyId: unknown = snap.get("companyId");
          const role: unknown = snap.get("role");
          return { companyId: typeof companyId === "string" ? companyId : "", role: typeof role === "string" ? role : "" };
        },
        listDevices: async (uid) => {
          const snap = await transaction.get(this.db.collection("users").doc(uid).collection("devices").limit(MAX_DEVICES_PER_USER * 2));
          return snap.docs.map((doc) => ({ tokenHash: doc.id, updatedAt: toDate(doc.get("updatedAt")) }));
        },
        ownersOf: async (tokenHash) => {
          const snap = await transaction.get(this.db.collectionGroup("devices").where("tokenHash", "==", tokenHash).limit(10));
          return snap.docs
            .filter((doc) => doc.ref.parent.parent?.parent.id === "users" && doc.id === tokenHash)
            .map((doc) => doc.ref.parent.parent!.id);
        },
        exists: async (uid, tokenHash) => (await transaction.get(this.device(uid, tokenHash))).exists,
        upsert: (uid, tokenHash, device) => {
          transaction.set(this.device(uid, tokenHash), {
            token: device.token, tokenHash, platform: device.platform, appVersion: device.appVersion,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
        remove: (uid, tokenHash) => { transaction.delete(this.device(uid, tokenHash)); },
      };
      return work(tx);
    });
  }
}
