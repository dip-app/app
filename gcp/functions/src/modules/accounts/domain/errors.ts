/**
 * Accounts-domain failures. Codes are the Firebase callable error codes from
 * docs/contracts/callables.md; the transport layer maps them to HttpsError.
 * `reason` is the stable machine code clients may read from error details.
 */
export type AccountsErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "internal";

export type AccountsErrorReason =
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "EMAIL_NOT_VERIFIED"
  | "INVALID_JOIN_CODE"
  | "MEMBERSHIP_CONFLICT"
  | "INVALID_STORED_MEMBERSHIP";

export class AccountsError extends Error {
  constructor(
    readonly code: AccountsErrorCode,
    readonly reason: AccountsErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "AccountsError";
  }
}
