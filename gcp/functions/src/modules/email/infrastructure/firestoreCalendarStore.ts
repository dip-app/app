import { createHash } from "node:crypto";
import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type {
  InviteEligibility, InviteEvent, InviteEventReader, InviteEventState, InviteIntent, InviteSequenceStore,
} from "../application/ports";
import { inviteEventFromDoc } from "../application/calendarInvites";

/** `emailInviteState/{sha256(companyId|eventId|uid)}`: server-only (deny-all rules), Firestore TTL on `expireAt`. */
export const INVITE_STATE_COLLECTION = "emailInviteState";

/** Timestamps become Dates so the application layer never sees the Admin SDK. */
export function plainDoc(data: DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of ["startTime", "endTime"]) if (data[key] instanceof Timestamp) out[key] = (data[key] as Timestamp).toDate();
  return out;
}

const stateId = (companyId: string, eventId: string, uid: string): string =>
  createHash("sha256").update(`${companyId}|${eventId}|${uid}`, "utf8").digest("hex");

class FirestoreInviteSequences implements InviteSequenceStore {
  constructor(private readonly db: Firestore) {}

  private ref(companyId: string, eventId: string, uid: string) {
    return this.db.collection(INVITE_STATE_COLLECTION).doc(stateId(companyId, eventId, uid));
  }

  async assign(companyId: string, eventId: string, uid: string, intent: InviteIntent, key: string, retainUntil: Date, now: Date): Promise<number | null> {
    const ref = this.ref(companyId, eventId, uid);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() ?? {};
      // Same trigger write again: hand back the first answer without moving the counter or the active flag.
      if (data["lastKey"] === key && data["lastIntent"] === intent && typeof data["lastSequence"] === "number") return data["lastSequence"];
      const active = data["active"] === true;
      if ((intent === "update" || intent === "cancel") && !active) return null;
      const previous = typeof data["sequence"] === "number" ? data["sequence"] : -1;
      const sequence = previous + 1;
      tx.set(ref, {
        companyId, eventId, uid, sequence, active: intent !== "cancel", delivered: data["delivered"] === true,
        lastKey: key, lastIntent: intent, lastSequence: sequence,
        updatedAt: Timestamp.fromDate(now), expireAt: Timestamp.fromDate(retainUntil),
      });
      return sequence;
    });
  }

  async isDelivered(companyId: string, eventId: string, uid: string): Promise<boolean> {
    return (await this.ref(companyId, eventId, uid).get()).get("delivered") === true;
  }

  async setDelivered(companyId: string, eventId: string, uid: string, delivered: boolean, now: Date): Promise<void> {
    await this.ref(companyId, eventId, uid).set({ delivered, updatedAt: Timestamp.fromDate(now) }, { merge: true });
  }
}

class FirestoreInviteEvents implements InviteEventReader, InviteEligibility {
  constructor(private readonly db: Firestore) {}

  private eventRef(companyId: string, eventId: string) {
    return this.db.collection("companies").doc(companyId).collection("events").doc(eventId);
  }

  async get(companyId: string, eventId: string): Promise<InviteEvent | null> {
    const snap = await this.eventRef(companyId, eventId).get();
    return snap.exists ? inviteEventFromDoc(eventId, plainDoc(snap.data()!)) : null;
  }

  async goingUids(companyId: string, eventId: string, limit: number): Promise<string[]> {
    const snap = await this.eventRef(companyId, eventId).collection("rsvps").where("status", "==", "going").limit(limit).get();
    return snap.docs.filter((d) => d.get("companyId") === companyId).map((d) => d.id);
  }

  async state(companyId: string, eventId: string, uid: string): Promise<InviteEventState> {
    const eventRef = this.eventRef(companyId, eventId);
    const [event, rsvp] = await this.db.getAll(eventRef, eventRef.collection("rsvps").doc(uid));
    const end: unknown = event?.exists ? event.get("endTime") : null;
    return {
      going: rsvp?.exists === true && rsvp.get("status") === "going" && rsvp.get("companyId") === companyId,
      eventStatus: event?.exists === true && typeof event.get("status") === "string" ? event.get("status") : null,
      endTime: end instanceof Timestamp ? end.toDate() : null,
    };
  }
}

/** Admin SDK adapters for calendar invites; every path derives from trigger parameters, never from payload fields. */
export class FirestoreCalendarStore {
  readonly sequences: InviteSequenceStore;
  readonly events: InviteEventReader;
  readonly eligibility: InviteEligibility;

  constructor(db: Firestore) {
    this.sequences = new FirestoreInviteSequences(db);
    const events = new FirestoreInviteEvents(db);
    this.events = events;
    this.eligibility = events;
  }
}
