import type { StoredSubmission, SubmissionStatus } from "../domain/submissionPolicy";

export type Document = Record<string, unknown>;

/** The challenge fields submissions depend on (Timestamps already converted to Date by the adapter). */
export interface SubmissionChallenge {
  companyId: string;
  startDate: Date;
  endDate: Date;
  goal: number;
  pointsReward: number;
}

export interface SubmissionCaller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}

/** Fields written when a submission is created or replaced; the adapter adds server timestamps. */
export interface SubmissionWrite {
  companyId: string;
  challengeId: string;
  userId: string;
  userName: string;
  userAvatarId: string;
  caption: string;
  progress: number;
  status: SubmissionStatus;
  storagePath: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  attempt: number;
  reviewedBy: string | null;
  reviewedAt: null;
  reviewNote: string | null;
  pointsAwarded: number;
}

export interface ReviewWrite {
  status: "approved" | "rejected";
  reviewedBy: string;
  reviewNote: string | null;
  pointsAwarded: number;
}

export interface LedgerEntry {
  companyId: string;
  userId: string;
  amount: number;
  reason: string;
  sourceId: string;
}

/** Operations inside one atomic transaction; services perform every read before any write. */
export interface SubmissionTransaction {
  getMember(uid: string): Promise<Document | null>;
  getChallenge(companyId: string, challengeId: string): Promise<SubmissionChallenge | null>;
  getSubmission(companyId: string, challengeId: string, id: string): Promise<StoredSubmission | null>;
  getAward(companyId: string, awardId: string): Promise<boolean>;
  /** Creates the submission (fails if it exists) with server `createdAt`/`updatedAt`. */
  createSubmission(companyId: string, challengeId: string, id: string, data: SubmissionWrite): void;
  /** Replaces the member-writable content and status of an existing submission; keeps createdAt. */
  replaceSubmission(companyId: string, challengeId: string, id: string, data: SubmissionWrite): void;
  reviewSubmission(companyId: string, challengeId: string, id: string, data: ReviewWrite): void;
  /** Server-owned counters on the challenge document (never bumps its revision). */
  incrementParticipants(companyId: string, challengeId: string): void;
  incrementCompleted(companyId: string, challengeId: string): void;
  /** Creates the deterministic ledger entry (fails if it exists) with a server `createdAt`. */
  createAward(companyId: string, awardId: string, entry: LedgerEntry): void;
  incrementBalance(uid: string, amount: number): void;
}

export interface SubmissionPage {
  items: { id: string; submission: StoredSubmission }[];
  nextCursor: string | null;
}

export interface SubmissionStore {
  runTransaction<T>(work: (tx: SubmissionTransaction) => Promise<T>): Promise<T>;
  /** Organizer authorization lookup outside a transaction (read path). */
  getMember(uid: string): Promise<Document | null>;
  list(companyId: string, challengeId: string, status: SubmissionStatus | null, limit: number, cursor: string | null): Promise<SubmissionPage>;
}
