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
        async companyIdForDomain(rootDomain) {
          const snap = await transaction.get(db.collection("companyDomains").doc(rootDomain));
          const companyId: unknown = snap.get("companyId");
          return snap.exists && typeof companyId === "string" && companyId.length > 0 ? companyId : null;
        },
        async companyExists(companyId) {
          return (await transaction.get(db.collection("companies").doc(companyId))).exists;
        },
        async getMembership(uid) {
          const snap = await transaction.get(db.collection("users").doc(uid));
          if (!snap.exists) return null;
          const field = (name: string) => {
            const value: unknown = snap.get(name);
            return typeof value === "string" ? value : "";
          };
          const membership: StoredMembership = { companyId: field("companyId"), role: field("role"), displayName: field("displayName") };
          return membership;
        },
        createMember(uid, profile) {
          // create() fails if a concurrent request already wrote the profile;
          // the transaction then retries and returns the stored membership.
          transaction.create(db.collection("users").doc(uid), {
            ...profile,
            createdAt: FieldValue.serverTimestamp(),
          });
        },
        updateDisplayName(uid, displayName) {
          transaction.update(db.collection("users").doc(uid), { displayName });
        },
      };
      return work(tx);
    });
  }
}
