import type { ParsedChallengeDraft, StoredChallenge } from "../domain/challengeDraft";

export interface StoredMembership {
  companyId: string;
  role: string;
}

/** Private deduplication receipt for createChallengeV1. */
export interface ChallengeReceipt {
  kind: "challenge";
  hash: string;
  challengeId: string;
}

/** A stored weekly challenge window, as returned by the overlap query. */
export interface ChallengeWindow {
  challengeId: string;
  type: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Operations available inside one atomic challenge transaction. All reads happen before writes
 * (Firestore transaction rule), so services read everything they need first.
 */
export interface ChallengeTransaction {
  getMembership(uid: string): Promise<StoredMembership | null>;
  getChallenge(companyId: string, challengeId: string): Promise<StoredChallenge | null>;
  /** Returns null when absent; a receipt written by another command kind is returned with its own kind. */
  getReceipt(companyId: string, uid: string, requestId: string): Promise<ChallengeReceipt | { kind: string } | null>;
  /** Tag IDs that do not exist in the shared tags catalog. */
  missingTagIds(tagIds: readonly string[]): Promise<string[]>;
  /**
   * Stored challenge windows in the company whose endDate falls in [from, to]. Every window the server
   * writes spans at most 14 days, so callers pass from = draft start, to = draft end + 14 days to see
   * every window that could overlap the draft.
   */
  windowsEndingBetween(companyId: string, from: Date, to: Date): Promise<ChallengeWindow[]>;
  /** Creates the challenge with server-owned fields; fails if it exists. */
  createChallenge(companyId: string, challengeId: string, challenge: StoredChallenge): void;
  /** Creates the private deduplication receipt; fails if it exists. */
  createReceipt(companyId: string, uid: string, requestId: string, receipt: ChallengeReceipt): void;
  /** Replaces the writable draft fields; counts and author/creation fields are never touched. */
  updateChallenge(companyId: string, challengeId: string, draft: ParsedChallengeDraft, nextRevision: number, updatedAt: Date): void;
}

export interface ChallengeStore {
  runTransaction<T>(work: (tx: ChallengeTransaction) => Promise<T>): Promise<T>;
}
