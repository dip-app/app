import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
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
          if (snap.exists && typeof companyId === "string" && companyId.length > 0) return companyId;
          // Server-side only: the caller always gets one NO_COMPANY_FOR_DOMAIN. Company
          // domains are not personal data; never log the email or uid here.
          logger.warn(snap.exists ? "companyDomains mapping is malformed" : "companyDomains mapping not found",
            { rootDomain, companyIdType: snap.exists ? typeof companyId : undefined });
          return null;
        },
        async companyExists(companyId) {
          const exists = (await transaction.get(db.collection("companies").doc(companyId))).exists;
          if (!exists) logger.warn("companyDomains mapping points to a missing company", { companyId });
          return exists;
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
