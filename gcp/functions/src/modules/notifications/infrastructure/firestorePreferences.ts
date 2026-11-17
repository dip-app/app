import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { PreferencesReader, PreferencesWriter } from "../application/ports";
import { channelOffers, type NotificationCategory, type NotificationChannel } from "../domain/categories";
import { PREFERENCES_COLLECTION, PREFERENCES_DOC_ID, resolvePreferences, type ResolvedPreferences } from "../domain/preferences";

/** Firestore `getAll` reads at most this many documents per call here (keeps a single RPC bounded). */
const READ_CHUNK = 100;

/** Admin SDK adapter for `users/{uid}/settings/notifications` (shared by push and email). */
export class FirestorePreferences implements PreferencesReader, PreferencesWriter {
  constructor(private readonly db: Firestore) {}

  private ref(uid: string) {
    return this.db.collection("users").doc(uid).collection(PREFERENCES_COLLECTION).doc(PREFERENCES_DOC_ID);
  }

  async preferencesFor(uids: readonly string[]): Promise<Map<string, ResolvedPreferences>> {
    const unique = [...new Set(uids)];
    const result = new Map<string, ResolvedPreferences>();
    for (let offset = 0; offset < unique.length; offset += READ_CHUNK) {
      const chunk = unique.slice(offset, offset + READ_CHUNK);
      const snapshots = await this.db.getAll(...chunk.map((uid) => this.ref(uid)));
      chunk.forEach((uid, index) => result.set(uid, resolvePreferences(snapshots[index]?.exists ? snapshots[index]?.data() : undefined)));
    }
    return result;
  }

  async setCategory(uid: string, channel: NotificationChannel, category: NotificationCategory, enabled: boolean): Promise<void> {
    if (!channelOffers(channel, category)) throw new Error("CATEGORY_NOT_OFFERED");
    // Same shape a client writes (rules-validated), so the document stays readable by the app.
    await this.ref(uid).set({ contractVersion: 1, [channel]: { [category]: enabled }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}
