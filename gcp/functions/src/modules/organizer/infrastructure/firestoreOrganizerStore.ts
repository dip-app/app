import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { CommandReceipt, OrganizerStore, OrganizerTransaction } from "../application/ports";
import type { IdGenerator } from "../application/organizerCommands";
import type { ParsedDraft } from "../domain/eventDraft";
import { OrganizerError } from "../domain/errors";

/** Random opaque event IDs (base64url, matches the contract's ID pattern). */
export const randomIds: IdGenerator = { eventId: () => randomBytes(15).toString("base64url") };

function eventFields(draft: ParsedDraft) {
  // Firestore rejects undefined, so optional venue fields are written only when present.
  const venue: Record<string, unknown> = {
    name: draft.venue.name, address: draft.venue.address, locality: draft.venue.locality,
    latitude: draft.venue.latitude, longitude: draft.venue.longitude,
  };
  for (const key of ["fsqPlaceId", "phone", "website"] as const) {
    if (draft.venue[key] !== undefined) venue[key] = draft.venue[key];
  }
  return {
    title: draft.title,
    description: draft.description,
    tagIds: draft.tagIds,
    coverImageURL: draft.coverImageURL,
    startTime: Timestamp.fromDate(draft.startTime),
    endTime: Timestamp.fromDate(draft.endTime),
    venue,
    costCents: draft.costCents,
    costNote: draft.costNote,
    capacity: draft.capacity,
    isOutdoor: draft.isOutdoor,
  };
}

/**
 * Admin SDK adapter. Admin access bypasses Security Rules, so authorization is enforced by the application
 * service before any write is queued here. Paths follow docs/contracts/data-ownership.md.
 */
export class FirestoreOrganizerStore implements OrganizerStore {
  constructor(private readonly db: Firestore) {}

  runTransaction<T>(work: (tx: OrganizerTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const db = this.db;
      const events = (companyId: string) => db.collection("companies").doc(companyId).collection("events");
      const receipts = (companyId: string) => db.collection("companies").doc(companyId).collection("commandReceipts");
      const tx: OrganizerTransaction = {
        async getMembership(uid) {
          const snap = await transaction.get(db.collection("users").doc(uid));
          if (!snap.exists) return null;
          const companyId: unknown = snap.get("companyId");
          const role: unknown = snap.get("role");
          return { companyId: typeof companyId === "string" ? companyId : "", role: typeof role === "string" ? role : "" };
        },
        async getEvent(companyId, eventId) {
          const snap = await transaction.get(events(companyId).doc(eventId));
          if (!snap.exists) return null;
          const revision: unknown = snap.get("revision");
          const attendeeCount: unknown = snap.get("attendeeCount");
          const startTime: unknown = snap.get("startTime");
          const endTime: unknown = snap.get("endTime");
          const status: unknown = snap.get("status");
          if (!Number.isInteger(revision) || !Number.isInteger(attendeeCount) || !(startTime instanceof Timestamp) || !(endTime instanceof Timestamp) || typeof status !== "string") {
            // Server-side detail stays in logs; the caller sees a generic internal error.
            throw new OrganizerError("internal", "INVALID_STORED_EVENT", "Stored event is invalid.");
          }
          return { revision: revision as number, attendeeCount: attendeeCount as number, startTime: startTime.toDate(), endTime: endTime.toDate(), status };
        },
        async getReceipt(companyId, uid, requestId) {
          const snap = await transaction.get(receipts(companyId).doc(`${uid}_${requestId}`));
          if (!snap.exists) return null;
          const receipt: CommandReceipt = { hash: String(snap.get("hash")), eventId: String(snap.get("eventId")), revision: Number(snap.get("revision")) };
          return receipt;
        },
        async hasAnyRsvp(companyId, eventId) {
          const snap = await transaction.get(events(companyId).doc(eventId).collection("rsvps").limit(1));
          return !snap.empty;
        },
        async missingTagIds(tagIds) {
          if (tagIds.length === 0) return [];
          const snaps = await transaction.getAll(...tagIds.map((id) => db.collection("tags").doc(id)));
          return snaps.filter((snap) => !snap.exists).map((snap) => snap.id);
        },
        createEvent(companyId, eventId, uid, draft) {
          transaction.create(events(companyId).doc(eventId), {
            companyId,
            ...eventFields(draft),
            pointsValue: 0,
            status: "scheduled",
            attendeeCount: 0,
            createdBy: uid,
            createdAt: FieldValue.serverTimestamp(),
            revision: 1,
          });
        },
        createReceipt(companyId, uid, requestId, receipt) {
          transaction.create(receipts(companyId).doc(`${uid}_${requestId}`), {
            ...receipt,
            createdAt: FieldValue.serverTimestamp(),
          });
        },
        updateEvent(companyId, eventId, draft, status, nextRevision) {
          transaction.update(events(companyId).doc(eventId), { ...eventFields(draft), status, revision: nextRevision });
        },
      };
      return work(tx);
    });
  }
}
