import type { NewMemberProfile, RosterAction, RosterClaim, StoredMembership } from "../domain/membership";

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
  /** The roster entry for the lower-case email's SHA-256 (companies/{c}/roster/{hash}), or null. */
  getRosterEntry(companyId: string, email: string): Promise<RosterClaim | null>;
  /**
   * Records the join on the roster, in the same transaction as createMember: `claim` marks the invited entry claimed
   * (and audits roster.claim), `create` writes a new claimed entry for someone who was never pre-imported, `overwrite`
   * replaces a revoked entry with the real member. Idempotent per entry id.
   */
  recordRosterJoin(companyId: string, entryId: string, action: RosterAction, uid: string, profile: NewMemberProfile): void;
  /** Server-side refresh of the OAuth display name on an existing profile. */
  updateDisplayName(uid: string, displayName: string): void;
}

export interface MembershipStore {
  runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T>;
}

export interface MembershipRateLimiter {
  consume(uid: string): Promise<void>;
}
