import type { NewMemberProfile, StoredMembership } from "../domain/membership";

/**
 * Operations available inside one atomic membership transaction. All reads
 * happen before writes (Firestore transaction rule).
 */
export interface MembershipTransaction {
  /** Resolves a private companyAccess lookup ID to a companyId, or null. */
  resolveCompanyId(joinCodeLookupId: string): Promise<string | null>;
  companyExists(companyId: string): Promise<boolean>;
  getMembership(uid: string): Promise<StoredMembership | null>;
  /** Creates users/{uid}; createdAt is server time. Must fail if the document exists. */
  createMember(uid: string, profile: NewMemberProfile): void;
}

export interface MembershipStore {
  runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T>;
}
