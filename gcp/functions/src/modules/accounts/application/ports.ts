import type { NewMemberProfile, StoredMembership } from "../domain/membership";

/**
 * Operations available inside one atomic membership transaction. All reads
 * happen before writes (Firestore transaction rule).
 */
export interface MembershipTransaction {
  /** Resolves a private `companyDomains/{rootDomain}` record to a companyId, or null. */
  companyIdForDomain(rootDomain: string): Promise<string | null>;
  companyExists(companyId: string): Promise<boolean>;
  getMembership(uid: string): Promise<StoredMembership | null>;
  /** Creates users/{uid}; createdAt is server time. Must fail if the document exists. */
  createMember(uid: string, profile: NewMemberProfile): void;
  /** Server-side refresh of the OAuth display name on an existing profile. */
  updateDisplayName(uid: string, displayName: string): void;
}

export interface MembershipStore {
  runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T>;
}

export interface MembershipRateLimiter {
  consume(uid: string): Promise<void>;
}
