/**
 * Admin-command failures (docs/contracts/admin.md). Codes are Firebase callable error codes;
 * `reason` is the stable machine code clients read from the error details.
 */
export type AdminErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "resource-exhausted"
  | "aborted"
  | "internal";

export type AdminErrorReason =
  | "UNAUTHENTICATED"
  | "EMAIL_NOT_VERIFIED"
  | "PROVIDER_NOT_ALLOWED"
  | "VALIDATION_FAILED"
  | "INSUFFICIENT_ROLE"
  | "COMPANY_MISMATCH"
  | "ACCOUNT_DEACTIVATED"
  | "MEMBERSHIP_CONFLICT"
  | "RATE_LIMITED"
  | "REQUEST_REUSED"
  | "EVENT_NOT_FOUND"
  | "EVENT_CLOSED"
  | "EVENT_NOT_STARTED"
  | "EVENT_FULL"
  | "PHOTO_NOT_FOUND"
  | "NOT_GOING"
  | "MEMBER_NOT_FOUND"
  | "LAST_ADMIN"
  | "CANNOT_DEACTIVATE_SELF"
  | "ATTENDANCE_LOCKED"
  | "INSUFFICIENT_POINTS"
  | "REVISION_CONFLICT"
  | "TEAM_NOT_FOUND"
  | "TEAM_NAME_TAKEN"
  | "EMAIL_DOMAIN_MISMATCH"
  | "EMAIL_ALREADY_MEMBER"
  | "ROSTER_ENTRY_NOT_FOUND"
  | "ROSTER_ENTRY_CLAIMED"
  | "IMPORT_TOO_LARGE"
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_JOB_BUSY"
  | "IMPORT_PLAN_MISMATCH"
  | "COMPANY_NOT_FOUND"
  | "INVALID_STORED_DATA";

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    readonly reason: AdminErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export const invalid = (fields: readonly string[] = []) =>
  new AdminError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", [...new Set(fields)].sort());

/** Stored data that violates an invariant: a generic internal error for the caller, detail only in logs. */
export function stored(condition: boolean, what = "data"): asserts condition {
  if (!condition) throw new AdminError("internal", "INVALID_STORED_DATA", `Invalid stored ${what}.`);
}
