import { FieldValue, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import type { DirectoryMember, Document, InviteStore, InviteTransaction } from "../application/ports";
import { nextBudget, inviteIdFor } from "../domain/invitePolicy";

const toDate = (value: unknown) => (value instanceof Timestamp ? value.toDate() : null);
const text = (value: unknown) => (typeof value === "string" ? value : "");

export class FirestoreInviteStore implements InviteStore {
  constructor(private readonly db: Firestore) {}

  private event(companyId: string, eventId: string) {
    return this.db.collection("companies").doc(companyId).collection("events").doc(eventId);
  }
  private invite(companyId: string, inviteId: string) {
    return this.db.collection("companies").doc(companyId).collection("invites").doc(inviteId);
  }
  private budget(key: string) {
    return this.db.collection("inviteRateLimits").doc(key);
  }

  runTransaction<T>(work: (tx: InviteTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const rsvp = (company: string, event: string, uid: string) => this.event(company, event).collection("rsvps").doc(uid);
      const tx: InviteTransaction = {
        getMember: async (uid) => (await transaction.get(this.db.collection("users").doc(uid))).data() ?? null,
        getEvent: async (company, event) => {
          const data = (await transaction.get(this.event(company, event))).data();
          return data ? { ...data, startTime: toDate(data.startTime) } : null;
        },
        getRsvp: async (company, event, uid) => (await transaction.get(rsvp(company, event, uid))).data() ?? null,
        createRsvp: (company, event, uid, data) => { transaction.create(rsvp(company, event, uid), { ...data, createdAt: FieldValue.serverTimestamp() }); },
        updateRsvp: (company, event, uid, data) => { transaction.update(rsvp(company, event, uid), data); },
        setCount: (company, event, count) => { transaction.update(this.event(company, event), { attendeeCount: count }); },
        getInvite: async (company, id) => (await transaction.get(this.invite(company, id))).data() ?? null,
        createInvite: (company, id, data) => {
          const eventStartTime = data.eventStartTime instanceof Date ? Timestamp.fromDate(data.eventStartTime) : data.eventStartTime;
          transaction.create(this.invite(company, id), { ...data, eventStartTime, createdAt: FieldValue.serverTimestamp() });
        },
        markResponded: (company, id, status) => {
          transaction.update(this.invite(company, id), { status, respondedAt: FieldValue.serverTimestamp() });
        },
        createNotification: (uid, id, data) => {
          // Deterministic id per invitation, written only when the invitation itself is created: set, so a re-created invitation never fails on a leftover notice.
          transaction.set(this.db.collection("users").doc(uid).collection("notifications").doc(id),
            { ...data, createdAt: FieldValue.serverTimestamp() });
        },
        getBudget: async (key) => (await transaction.get(this.budget(key))).data() ?? null,
        setBudget: (key, state, expiresAt) => {
          transaction.set(this.budget(key), { windowStart: state.windowStart, count: state.count, expiresAt: Timestamp.fromDate(expiresAt) });
        },
      };
      return work(tx);
    });
  }

  async getMember(uid: string): Promise<Document | null> {
    return (await this.db.collection("users").doc(uid).get()).data() ?? null;
  }

  async getEvent(companyId: string, eventId: string): Promise<Document | null> {
    const data = (await this.event(companyId, eventId).get()).data();
    return data ? { ...data, startTime: toDate(data.startTime) } : null;
  }

  async listMembers(companyId: string, cap: number): Promise<{ members: DirectoryMember[]; complete: boolean }> {
    // Only the four directory fields are selected; nothing else of a profile is ever read into the response path.
    const snapshot = await this.db.collection("users").where("companyId", "==", companyId)
      .select("displayName", "avatarId", "department", "role", "status").limit(cap + 1).get();
    const members: DirectoryMember[] = [];
    for (const doc of snapshot.docs.slice(0, cap)) {
      const data = doc.data();
      if (typeof data.displayName !== "string") continue;
      members.push({
        userId: doc.id, displayName: data.displayName, avatarId: text(data.avatarId), department: text(data.department),
        member: { companyId, role: data.role, status: data.status },
      });
    }
    return { members, complete: snapshot.size <= cap };
  }

  async memberStates(companyId: string, eventId: string, uids: readonly string[]): Promise<Map<string, "going" | "invited">> {
    const states = new Map<string, "going" | "invited">();
    if (uids.length === 0) return states;
    const rsvpRefs: DocumentReference[] = uids.map((uid) => this.event(companyId, eventId).collection("rsvps").doc(uid));
    const inviteRefs: DocumentReference[] = uids.map((uid) => this.invite(companyId, inviteIdFor(eventId, uid)));
    const [rsvps, invites] = await Promise.all([this.db.getAll(...rsvpRefs), this.db.getAll(...inviteRefs)]);
    uids.forEach((uid, index) => {
      if (invites[index]?.exists) states.set(uid, "invited");
      if (rsvps[index]?.exists && rsvps[index]?.get("status") === "going") states.set(uid, "going");
    });
    return states;
  }

  async consumeBudget(key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
    const ref = this.budget(key);
    return this.db.runTransaction(async (transaction) => {
      const next = nextBudget((await transaction.get(ref)).data(), nowMs, limit, windowMs);
      if (!next) return false;
      transaction.set(ref, { windowStart: next.windowStart, count: next.count, expiresAt: Timestamp.fromMillis(next.windowStart + windowMs) });
      return true;
    });
  }
}
