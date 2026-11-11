import type { StoredObject } from "../domain/photoPolicy";

export type Document = Record<string, unknown>;

export interface PhotoTransaction {
  getMember(uid: string): Promise<Document | null>;
  /** startTime/endTime are converted to Date by the adapter (null when not a Timestamp). */
  getEvent(companyId: string, eventId: string): Promise<Document | null>;
  getRsvp(companyId: string, eventId: string, uid: string): Promise<Document | null>;
  getPhoto(companyId: string, eventId: string, photoId: string): Promise<Document | null>;
  /** Creates the album document; the adapter adds `createdAt` as a server timestamp. */
  createPhoto(companyId: string, eventId: string, photoId: string, data: Document): void;
}

export interface PhotoStore {
  runTransaction<T>(work: (tx: PhotoTransaction) => Promise<T>): Promise<T>;
}

/** Reads uploaded objects through the Admin SDK (bypasses storage.rules; callers authorize first). */
export interface PhotoObjects {
  /** null when the object does not exist. `head` holds at least the first 16 bytes when available. */
  inspect(path: string): Promise<StoredObject | null>;
  /** Best-effort removal of an object that failed validation (frees the member's slot). */
  remove(path: string): Promise<void>;
}

export interface PhotoCaller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}

export interface CommentCounter {
  /** Recounts comments for a photo inside a transaction and stores the count; false if the photo is missing. */
  recount(companyId: string, eventId: string, photoId: string): Promise<boolean>;
}
