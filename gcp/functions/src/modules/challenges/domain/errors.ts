/**
 * Weekly-theme (challenge) command failures. Codes are Firebase callable error codes from
 * docs/contracts/callables.md; `reason` is the stable machine code clients may read from error details.
 */
export type ChallengeErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "aborted"
  | "internal";

export type ChallengeErrorReason =
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "NOT_ORGANIZER"
  | "COMPANY_MISMATCH"
  | "CHALLENGE_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "REQUEST_REUSED"
  | "TAG_NOT_FOUND"
  | "CHALLENGE_WINDOW_OVERLAP"
  | "WINDOW_CHANGE_BLOCKED"
  | "INVALID_STORED_CHALLENGE";

/** The existing weekly challenge whose window a create/update would overlap (same company only). */
export interface WindowConflict {
  challengeId: string;
  startDate: string;
  endDate: string;
}

export class ChallengeError extends Error {
  constructor(
    readonly code: ChallengeErrorCode,
    readonly reason: ChallengeErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
    readonly conflict?: WindowConflict,
  ) {
    super(message);
    this.name = "ChallengeError";
  }
}
