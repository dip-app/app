import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { ParticipationStore, ParticipationTransaction } from "../application/ports";

export class FirestoreParticipationStore implements ParticipationStore {
  constructor(private readonly db: Firestore) {}

  runTransaction<T>(work: (tx: ParticipationTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async transaction => {
      const eventRef = (company: string, event: string) => this.db.collection("companies").doc(company).collection("events").doc(event);
      const rsvpRef = (company: string, event: string, uid: string) => eventRef(company, event).collection("rsvps").doc(uid);
      const tx: ParticipationTransaction = {
        getMember: async uid => (await transaction.get(this.db.collection("users").doc(uid))).data() ?? null,
        getEvent: async (company, event) => {
          const data = (await transaction.get(eventRef(company, event))).data();
          if (!data) return null;
          return { ...data, startTime: data.startTime instanceof Timestamp ? data.startTime.toDate() : null };
        },
        getRsvp: async (company, event, uid) => (await transaction.get(rsvpRef(company, event, uid))).data() ?? null,
        createRsvp: (company, event, uid, data) => { transaction.create(rsvpRef(company, event, uid), { ...data, createdAt: FieldValue.serverTimestamp() }); },
        updateRsvp: (company, event, uid, data) => { transaction.update(rsvpRef(company, event, uid), data); },
        setCount: (company, event, count) => { transaction.update(eventRef(company, event), { attendeeCount: count }); },
      };
      return work(tx);
    });
  }
}
