/**
 * Challenge submission failures. Codes are Firebase callable error codes (docs/contracts/callables.md);
 * `reason` is the stable machine code clients read from the error details.
 */
export type SubmissionErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "internal";

export type SubmissionErrorReason =
  | "UNAUTHENTICATED"
  | "EMAIL_NOT_VERIFIED"
  | "PROVIDER_NOT_ALLOWED"
  | "VALIDATION_FAILED"
  | "MEMBERSHIP_CONFLICT"
  | "NOT_ORGANIZER"
  | "COMPANY_MISMATCH"
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_NOT_OPEN"
  | "CHALLENGE_CLOSED"
  | "SUBMISSION_NOT_FOUND"
  | "SUBMISSION_LOCKED"
  | "SUBMISSION_NOT_PENDING"
  | "SUBMITTER_NOT_FOUND"
  | "SELF_REVIEW"
  | "SUBMISSION_CHANGED"
  | "ACCOUNT_DEACTIVATED"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_INVALID"
  | "INVALID_STORED_DATA";

export class SubmissionError extends Error {
  constructor(
    readonly code: SubmissionErrorCode,
    readonly reason: SubmissionErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}
