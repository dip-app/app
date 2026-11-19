import { FieldValue, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type {
  CapStore, ClaimResult, CompanyEmailSettings, CompanySettingsReader, EmailPreferencesStore, NewOutboxEntry, OutboxReaper, OutboxStore,
  Recipient, RecipientDirectory, SuppressionStore,
} from "../application/ports";
import type { EmailCategory } from "../domain/categories";
import {
  CAPS_COLLECTION, COMPANY_DAILY_CAP_DEFAULT, canCountOpen, COMPANY_SETTINGS_COLLECTION, OUTBOX_COLLECTION, OUTBOX_TTL_DAYS,
  SUPPRESSIONS_COLLECTION, categoryOf, type OutboxDocument, type OutboxStatus,
} from "../domain/outbox";

const ALREADY_EXISTS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COMPANY_CAP = 50_000;

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; } catch { return null; }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toOutbox(id: string, data: DocumentData): OutboxDocument {
  const doc: OutboxDocument = {
    id,
    uid: data["uid"],
    companyId: data["companyId"],
    category: data["category"],
    template: data["template"],
    variables: data["variables"],
    status: data["status"],
    attempts: typeof data["attempts"] === "number" ? data["attempts"] : 0,
    notAfter: toDate(data["notAfter"]),
    createdAt: toDate(data["createdAt"]) ?? new Date(0),
    expireAt: toDate(data["expireAt"]) ?? new Date(0),
    leaseUntil: toDate(data["leaseUntil"]),
  };
  if (typeof data["reason"] === "string") doc.reason = data["reason"];
  if (typeof data["providerMessageId"] === "string") doc.providerMessageId = data["providerMessageId"];
  if (typeof data["toHash"] === "string") doc.toHash = data["toHash"];
  return doc;
}

class FirestoreOutboxStore implements OutboxStore {
  constructor(private readonly db: Firestore) {}

  async create(entry: NewOutboxEntry, now: Date): Promise<boolean> {
    try {
      await this.db.collection(OUTBOX_COLLECTION).doc(entry.id).create({
        uid: entry.uid,
        companyId: entry.companyId,
        category: categoryOf(entry.template),
        template: entry.template,
        variables: entry.variables,
        status: "queued",
        attempts: 0,
        notAfter: entry.notAfter === null ? null : Timestamp.fromDate(entry.notAfter),
        createdAt: Timestamp.fromDate(now),
        expireAt: Timestamp.fromDate(new Date(now.getTime() + OUTBOX_TTL_DAYS * DAY_MS)),
        leaseUntil: null,
      });
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === ALREADY_EXISTS) return false;
      throw error;
    }
  }

  async claim(id: string, now: Date, leaseMs: number): Promise<ClaimResult> {
    const ref = this.db.collection(OUTBOX_COLLECTION).doc(id);
    return this.db.runTransaction(async (tx): Promise<ClaimResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: "missing" };
      const data = snap.data()!;
      const status = data["status"] as OutboxStatus;
      if (status === "queued") {
        const lease = Timestamp.fromDate(new Date(now.getTime() + leaseMs));
        const attempts = (typeof data["attempts"] === "number" ? data["attempts"] : 0) + 1;
        tx.update(ref, { status: "sending", attempts, leaseUntil: lease, updatedAt: Timestamp.fromDate(now) });
        return { kind: "claimed", doc: toOutbox(id, { ...data, status: "sending", attempts, leaseUntil: lease }) };
      }
      if (status === "sending") {
        const lease = toDate(data["leaseUntil"]);
        if (lease === null || lease.getTime() <= now.getTime()) {
          tx.update(ref, { status: "unknown", reason: "abandoned", leaseUntil: null, updatedAt: Timestamp.fromDate(now) });
          return { kind: "abandoned" };
        }
      }
      return { kind: "not_queued", status };
    });
  }

  async finish(id: string, status: Exclude<OutboxStatus, "sending">,
    fields: { reason?: string; providerMessageId?: string; toHash?: string }, now: Date): Promise<void> {
    const ref = this.db.collection(OUTBOX_COLLECTION).doc(id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("status") !== "sending") return;
      const update: Record<string, unknown> = { status, leaseUntil: null, updatedAt: Timestamp.fromDate(now) };
      if (fields.reason !== undefined) update["reason"] = fields.reason;
      if (fields.providerMessageId !== undefined) update["providerMessageId"] = fields.providerMessageId;
      if (fields.toHash !== undefined) update["toHash"] = fields.toHash;
      if (status === "sent") update["sentAt"] = Timestamp.fromDate(now);
      tx.update(ref, update);
    });
  }

  async recordOpen(id: string, now: Date): Promise<boolean> {
    const ref = this.db.collection(OUTBOX_COLLECTION).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("status") !== "sent") return false;
      const sentAt = toDate(snap.get("sentAt")) ?? toDate(snap.get("updatedAt"));
      if (sentAt !== null && now.getTime() < sentAt.getTime()) return false;
      const opens: unknown = snap.get("openCount");
      if (!canCountOpen(opens)) return false; // replays stop writing
      const stamp = Timestamp.fromDate(now);
      const update: Record<string, unknown> = { openCount: FieldValue.increment(1), lastOpenedAt: stamp };
      if (toDate(snap.get("firstOpenedAt")) === null) update["firstOpenedAt"] = stamp;
      tx.update(ref, update);
      return true;
    });
  }

  async get(id: string): Promise<OutboxDocument | null> {
    const snap = await this.db.collection(OUTBOX_COLLECTION).doc(id).get();
    return snap.exists ? toOutbox(id, snap.data()!) : null;
  }
}

class FirestoreOutboxReaper implements OutboxReaper {
  constructor(private readonly db: Firestore) {}

  private get col() { return this.db.collection(OUTBOX_COLLECTION); }

  async expiredSendingIds(now: Date, limit: number): Promise<string[]> {
    // Single-field range on leaseUntil (auto-indexed). Only `sending` documents carry a lease; every finish() nulls it.
    const snap = await this.col.where("leaseUntil", "<=", Timestamp.fromDate(now)).orderBy("leaseUntil").limit(limit).get();
    return snap.docs.map((d) => d.id);
  }

  async staleQueuedIds(cutoff: Date, limit: number): Promise<string[]> {
    // Needs the composite index emailOutbox(status ASC, createdAt ASC).
    const snap = await this.col.where("status", "==", "queued").where("createdAt", "<", Timestamp.fromDate(cutoff)).orderBy("createdAt").limit(limit).get();
    return snap.docs.map((d) => d.id);
  }

  async markAbandoned(id: string, now: Date): Promise<boolean> {
    const ref = this.col.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("status") !== "sending") return false;
      const lease = toDate(snap.get("leaseUntil"));
      if (lease !== null && lease.getTime() > now.getTime()) return false;
      tx.update(ref, { status: "unknown", reason: "abandoned", leaseUntil: null, updatedAt: Timestamp.fromDate(now) });
      return true;
    });
  }

  async markStaleQueued(id: string, cutoff: Date, now: Date): Promise<boolean> {
    const ref = this.col.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("status") !== "queued") return false;
      const touched = toDate(snap.get("updatedAt")) ?? toDate(snap.get("createdAt"));
      if (touched !== null && touched.getTime() >= cutoff.getTime()) return false; // a retry is still in flight
      tx.update(ref, { status: "failed", reason: "stale_queued", updatedAt: Timestamp.fromDate(now) });
      return true;
    });
  }
}

class FirestoreRecipientDirectory implements RecipientDirectory {
  constructor(private readonly db: Firestore) {}

  async get(uid: string): Promise<Recipient | null> {
    const snap = await this.db.collection("users").doc(uid).get();
    if (!snap.exists) return null;
    return {
      uid,
      companyId: str(snap.get("companyId")),
      email: str(snap.get("email")),
      displayName: str(snap.get("displayName")),
      status: str(snap.get("status")),
      role: str(snap.get("role")),
      locale: str(snap.get("locale")),
    };
  }

  async uidsByEmail(email: string): Promise<string[]> {
    const trimmed = email.trim();
    const uids = new Set<string>();
    for (const form of new Set([trimmed, trimmed.toLowerCase()])) {
      const snap = await this.db.collection("users").where("email", "==", form).limit(5).get();
      for (const doc of snap.docs) uids.add(doc.id);
    }
    return [...uids].slice(0, 5);
  }
}

class FirestoreCompanySettings implements CompanySettingsReader {
  constructor(private readonly db: Firestore) {}

  async get(companyId: string): Promise<CompanyEmailSettings | null> {
    const snap = await this.db.collection(COMPANY_SETTINGS_COLLECTION).doc(companyId).get();
    if (!snap.exists) return null;
    const cap: unknown = snap.get("dailyCap");
    return {
      enabled: snap.get("enabled") === true,
      dailyCap: typeof cap === "number" && Number.isInteger(cap) && cap > 0 && cap <= MAX_COMPANY_CAP ? cap : COMPANY_DAILY_CAP_DEFAULT,
      timeZone: validTimeZone(snap.get("timeZone")),
    };
  }
}

class FirestoreSuppressions implements SuppressionStore {
  constructor(private readonly db: Firestore) {}

  async isSuppressed(emailHash: string): Promise<boolean> {
    return (await this.db.collection(SUPPRESSIONS_COLLECTION).doc(emailHash).get()).exists;
  }

  async suppress(emailHash: string, reason: "hard_bounce" | "complaint" | "provider_unsubscribe" | "provider_rejected", now: Date): Promise<void> {
    const ref = this.db.collection(SUPPRESSIONS_COLLECTION).doc(emailHash);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const ts = Timestamp.fromDate(now);
      if (snap.exists) tx.update(ref, { lastEventAt: ts, count: FieldValue.increment(1) });
      else tx.create(ref, { reason, createdAt: ts, lastEventAt: ts, count: 1 });
    });
  }
}

class FirestoreCaps implements CapStore {
  constructor(private readonly db: Firestore) {}

  async consume(uid: string, companyId: string, day: string, memberLimit: number, companyLimit: number, now: Date, outboxId: string):
    Promise<"ok" | "member_cap" | "company_cap"> {
    const marker = this.db.collection(CAPS_COLLECTION).doc(`cap_${uid}_${day}_${outboxId}`);
    const member = this.db.collection(CAPS_COLLECTION).doc(`member_${uid}_${day}`);
    const company = this.db.collection(CAPS_COLLECTION).doc(`company_${companyId}_${day}`);
    return this.db.runTransaction(async (tx) => {
      const [m, c, done] = await Promise.all([tx.get(member), tx.get(company), tx.get(marker)]);
      if (done.exists) return "ok"; // this outbox email already consumed its unit (retry after a transient failure)
      const memberCount: unknown = m.get("count");
      const companyCount: unknown = c.get("count");
      const mc = typeof memberCount === "number" ? memberCount : 0;
      const cc = typeof companyCount === "number" ? companyCount : 0;
      if (mc >= memberLimit) return "member_cap";
      if (cc >= companyLimit) return "company_cap";
      const expireAt = Timestamp.fromDate(new Date(now.getTime() + 2 * DAY_MS));
      tx.set(member, { count: mc + 1, expireAt }, { merge: true });
      tx.set(company, { count: cc + 1, expireAt }, { merge: true });
      tx.create(marker, { uid, day, expireAt });
      return "ok";
    });
  }
}

class FirestoreEmailPreferences implements EmailPreferencesStore {
  constructor(private readonly db: Firestore) {}

  private doc(uid: string) {
    return this.db.collection("users").doc(uid).collection("settings").doc("notifications");
  }

  async getEmailMap(uid: string): Promise<Record<string, unknown> | null> {
    const snap = await this.doc(uid).get();
    const map: unknown = snap.exists ? snap.get("email") : null;
    return typeof map === "object" && map !== null && !Array.isArray(map) ? (map as Record<string, unknown>) : null;
  }

  async disable(uid: string, categories: readonly EmailCategory[]): Promise<boolean> {
    if (!(await this.db.collection("users").doc(uid).get()).exists) return false;
    const email: Record<string, boolean> = {};
    for (const category of categories) email[category] = false;
    await this.doc(uid).set({ contractVersion: 1, email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  }
}

/**
 * Admin SDK adapters for the email module, grouped in one facade. The ports cannot be implemented by a single class
 * because `OutboxStore.get`, `RecipientDirectory.get` and `CompanySettingsReader.get` share a name with different
 * meanings, so each port is a property: `store.outbox`, `store.recipients`, `store.companies`, ...
 */
export class FirestoreEmailStore {
  readonly outbox: OutboxStore;
  readonly reaper: OutboxReaper;
  readonly recipients: RecipientDirectory;
  readonly companies: CompanySettingsReader;
  readonly suppressions: SuppressionStore;
  readonly caps: CapStore;
  readonly preferences: EmailPreferencesStore;

  constructor(db: Firestore) {
    this.outbox = new FirestoreOutboxStore(db);
    this.reaper = new FirestoreOutboxReaper(db);
    this.recipients = new FirestoreRecipientDirectory(db);
    this.companies = new FirestoreCompanySettings(db);
    this.suppressions = new FirestoreSuppressions(db);
    this.caps = new FirestoreCaps(db);
    this.preferences = new FirestoreEmailPreferences(db);
  }
}
