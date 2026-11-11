/**
 * Event photo album failures. Codes are Firebase callable error codes (docs/contracts/callables.md);
 * `reason` is the stable machine code clients read from the error details.
 */
export type PhotoErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "internal";

export type PhotoErrorReason =
  | "UNAUTHENTICATED"
  | "EMAIL_NOT_VERIFIED"
  | "PROVIDER_NOT_ALLOWED"
  | "VALIDATION_FAILED"
  | "MEMBERSHIP_CONFLICT"
  | "EVENT_NOT_FOUND"
  | "EVENT_NOT_ENDED"
  | "EVENT_CANCELLED"
  | "NOT_ATTENDEE"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_INVALID"
  | "PHOTO_CONFLICT"
  | "INVALID_STORED_DATA";

export class PhotoError extends Error {
  constructor(
    readonly code: PhotoErrorCode,
    readonly reason: PhotoErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "PhotoError";
  }
}
