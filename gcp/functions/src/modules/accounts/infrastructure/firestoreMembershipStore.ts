import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { MembershipStore, MembershipTransaction } from "../application/ports";
import type { StoredMembership } from "../domain/membership";

/**
 * Admin SDK adapter. Admin access bypasses Security Rules, so authorization is
 * enforced by the application service before any write is queued here.
 */
export class FirestoreMembershipStore implements MembershipStore {
  constructor(private readonly db: Firestore) {}

  runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const db = this.db;
      const tx: MembershipTransaction = {
        async resolveCompanyId(lookupId) {
          const snap = await transaction.get(db.collection("companyAccess").doc(lookupId));
          const companyId: unknown = snap.get("companyId");
          return snap.exists && typeof companyId === "string" && companyId.length > 0 ? companyId : null;
        },
        async companyExists(companyId) {
          return (await transaction.get(db.collection("companies").doc(companyId))).exists;
        },
        async getMembership(uid) {
          const snap = await transaction.get(db.collection("users").doc(uid));
          if (!snap.exists) return null;
          const companyId: unknown = snap.get("companyId");
          const role: unknown = snap.get("role");
          const membership: StoredMembership = {
            companyId: typeof companyId === "string" ? companyId : "",
            role: typeof role === "string" ? role : "",
          };
          return membership;
        },
        createMember(uid, profile) {
          // create() fails if a concurrent request already wrote the profile;
          // the transaction then retries and replays the stored membership.
          transaction.create(db.collection("users").doc(uid), {
            ...profile,
            createdAt: FieldValue.serverTimestamp(),
          });
        },
      };
      return work(tx);
    });
  }
}
