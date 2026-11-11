import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import type { StoredObject } from "../domain/photoPolicy";
import type { CommentCounter, PhotoObjects, PhotoStore, PhotoTransaction } from "../application/ports";

const toDate = (value: unknown) => (value instanceof Timestamp ? value.toDate() : null);

export class FirestorePhotoStore implements PhotoStore, CommentCounter {
  constructor(private readonly db: Firestore) {}

  private event(companyId: string, eventId: string) {
    return this.db.collection("companies").doc(companyId).collection("events").doc(eventId);
  }

  runTransaction<T>(work: (tx: PhotoTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async transaction => {
      const tx: PhotoTransaction = {
        getMember: async uid => (await transaction.get(this.db.collection("users").doc(uid))).data() ?? null,
        getEvent: async (companyId, eventId) => {
          const data = (await transaction.get(this.event(companyId, eventId))).data();
          return data ? { ...data, startTime: toDate(data.startTime), endTime: toDate(data.endTime) } : null;
        },
        getRsvp: async (companyId, eventId, uid) =>
          (await transaction.get(this.event(companyId, eventId).collection("rsvps").doc(uid))).data() ?? null,
        getPhoto: async (companyId, eventId, photoId) =>
          (await transaction.get(this.event(companyId, eventId).collection("photos").doc(photoId))).data() ?? null,
        createPhoto: (companyId, eventId, photoId, data) => {
          const eventDate = data.eventDate instanceof Date ? Timestamp.fromDate(data.eventDate) : data.eventDate;
          transaction.create(this.event(companyId, eventId).collection("photos").doc(photoId),
            { ...data, eventDate, createdAt: FieldValue.serverTimestamp() });
        },
      };
      return work(tx);
    });
  }

  /** Recomputes the count from the comments themselves, so duplicate trigger deliveries stay correct. */
  recount(companyId: string, eventId: string, photoId: string): Promise<boolean> {
    const photo = this.event(companyId, eventId).collection("photos").doc(photoId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(photo);
      if (!snapshot.exists) return false;
      const count = (await transaction.get(photo.collection("comments").count())).data().count;
      if (snapshot.get("commentCount") !== count) transaction.update(photo, { commentCount: count });
      return true;
    });
  }
}

export class StoragePhotoObjects implements PhotoObjects {
  constructor(private readonly storage: Storage) {}

  async inspect(path: string): Promise<StoredObject | null> {
    const file = this.storage.bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 1) return { size: 0, contentType: metadata.contentType ?? null, head: new Uint8Array() };
    const [head] = await file.download({ start: 0, end: Math.min(size, 16) - 1 });
    return { size, contentType: metadata.contentType ?? null, head: new Uint8Array(head) };
  }

  async remove(path: string): Promise<void> {
    await this.storage.bucket().file(path).delete({ ignoreNotFound: true });
  }
}
