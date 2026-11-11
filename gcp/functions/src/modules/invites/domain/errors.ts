/**
 * Coworker invitation failures. Codes are Firebase callable error codes (docs/contracts/callables.md);
 * `reason` is the stable machine code clients read from the error details.
 */
export type InviteErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "resource-exhausted"
  | "internal";

export type InviteErrorReason =
  | "UNAUTHENTICATED"
  | "EMAIL_NOT_VERIFIED"
  | "PROVIDER_NOT_ALLOWED"
  | "VALIDATION_FAILED"
  | "MEMBERSHIP_CONFLICT"
  | "RECIPIENT_NOT_FOUND"
  | "CANNOT_INVITE_SELF"
  | "EVENT_NOT_FOUND"
  | "EVENT_CLOSED"
  | "EVENT_CANCELLED"
  | "EVENT_FULL"
  | "ALREADY_GOING"
  | "ALREADY_INVITED"
  | "INVITE_NOT_FOUND"
  | "INVITE_ALREADY_RESPONDED"
  | "RATE_LIMITED"
  | "INVALID_STORED_DATA";

export class InviteError extends Error {
  constructor(
    readonly code: InviteErrorCode,
    readonly reason: InviteErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "InviteError";
  }
}
