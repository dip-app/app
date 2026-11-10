export type NotificationsErrorCode = "unauthenticated" | "invalid-argument" | "permission-denied" | "internal";

export type NotificationsErrorReason =
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "EMAIL_NOT_VERIFIED"
  | "PROVIDER_NOT_ALLOWED"
  | "MEMBERSHIP_REQUIRED";

export class NotificationsError extends Error {
  constructor(
    readonly code: NotificationsErrorCode,
    readonly reason: NotificationsErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "NotificationsError";
  }
}
