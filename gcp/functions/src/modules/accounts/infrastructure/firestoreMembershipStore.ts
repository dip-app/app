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
          // companies.emailDomain holds one lowercase registrable root domain. Equality
          // on a single field uses the automatic single-field index (no composite index).
          // limit(2) detects a duplicate without reading every match.
          const snap = await transaction.get(
            db.collection("companies").where("emailDomain", "==", rootDomain).limit(2));
          // Server-side only: the caller always gets one NO_COMPANY_FOR_DOMAIN. Company
          // domains are not personal data; never log the email or uid here.
          if (snap.size === 0) {
            logger.warn("no company has this emailDomain", { rootDomain });
            return null;
          }
          if (snap.size > 1) {
            // Uniqueness is not enforceable by Firestore; fail closed rather than pick one.
            logger.error("more than one company has this emailDomain", { rootDomain });
            return null;
          }
          return snap.docs[0]!.id;
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
