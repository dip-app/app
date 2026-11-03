import type { NewMemberProfile, StoredMembership } from "../domain/membership";

/**
 * Operations available inside one atomic membership transaction. All reads
 * happen before writes (Firestore transaction rule).
 */
export interface MembershipTransaction {
  /**
   * Resolves the company whose `companies.emailDomain` equals the registrable root
   * domain. Returns null when no company matches or when more than one does
   * (ambiguous: fail closed).
   */
  companyIdForDomain(rootDomain: string): Promise<string | null>;
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
