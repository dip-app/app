import type { Firestore } from "firebase-admin/firestore";
import type { Locale } from "../../i18n";
import type { LocaleMember, LocaleStore, LocaleTransaction } from "../application/setMyLocale";

/** `users/{uid}` reads and the single-field `locale` merge write of setMyLocaleV1 (Admin SDK, in one transaction). */
export class FirestoreLocaleStore implements LocaleStore {
  constructor(private readonly db: Firestore) {}

  runTransaction<T>(work: (tx: LocaleTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const users = this.db.collection("users");
      return work({
        getMember: async (uid) => {
          const snap = await transaction.get(users.doc(uid));
          return snap.exists ? (snap.data() as LocaleMember) : null;
        },
        setLocale: (uid: string, locale: Locale) => {
          transaction.set(users.doc(uid), { locale }, { merge: true });
        },
      });
    });
  }
}
