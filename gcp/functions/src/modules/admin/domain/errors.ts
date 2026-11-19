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
  | "unavailable"
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
  | "ROSTER_ENTRY_NOT_INVITED"
  | "RESEND_LIMIT"
  | "EMAIL_NOT_ENABLED"
  | "INVITE_EMAIL_OPTED_OUT"
  | "INVITE_EMAIL_UNDELIVERABLE"
  | "INVITE_EMAIL_LIMIT"
  | "INVITE_EMAIL_TOO_SOON"
  | "IMPORT_TOO_LARGE"
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_JOB_BUSY"
  | "IMPORT_PLAN_MISMATCH"
  | "COMPANY_NOT_FOUND"
  | "BUG_REPORT_NOT_FOUND"
  | "ASSIGNEE_NOT_FOUND"
  | "INVALID_STORED_DATA"
  | "REQUEST_IN_PROGRESS"
  | "AI_DISABLED"
  | "AI_PROMPT_REJECTED"
  | "AI_FLAG_LIMIT"
  | "AI_DAILY_LIMIT"
  | "AI_MONTHLY_LIMIT"
  | "AI_BUDGET_EXHAUSTED"
  | "AI_CREDITS_EXHAUSTED"
  | "AI_IDEAS_REFRESH_LIMIT"
  | "AI_THEME_SUGGEST_DISABLED"
  | "AI_THEME_SUGGEST_LIMIT"
  | "AI_OUTPUT_INVALID"
  | "AI_UNAVAILABLE"
  | "COVER_SEARCH_UNAVAILABLE"
  | "COVER_CANDIDATE_EXPIRED"
  | "COVER_IMPORT_FAILED"
  | "AI_VENUES_DISABLED"
  | "OFFICE_NOT_SET"
  | "VENUE_SEARCH_LIMIT"
  | "VENUES_UNAVAILABLE"
  | "PLACES_DISABLED"
  | "PLACES_LIMIT"
  | "PLACES_UNAVAILABLE"
  | "PLACE_NOT_FOUND";

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    readonly reason: AdminErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
    /** Extra scalar details sent to the client next to `reason` (for example the reset date of AI credits). Never dollar figures. */
    readonly details: Readonly<Record<string, string | number>> = {},
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

export interface ErrorDiagnostics { error: string; code: string | number | null; message: string; indexUrl?: string }

const INDEX_URL = /https:\/\/console\.firebase\.google\.com\/\S*indexes\?create_composite=[A-Za-z0-9_=-]+/;
const MAX_MESSAGE = 500;

/**
 * What to log for an unexpected failure so it is diagnosable: the error name, its gRPC/Firebase code and a bounded
 * message (Firestore messages describe the query, never document data), plus the index-creation link Firestore puts
 * in FAILED_PRECONDITION messages. Request payloads are never part of it.
 */
export function errorDiagnostics(error: unknown): ErrorDiagnostics {
  if (!(error instanceof Error)) return { error: typeof error, code: null, message: "" };
  const raw = (error as { code?: unknown }).code;
  const code = typeof raw === "string" || typeof raw === "number" ? raw : null;
  const indexUrl = INDEX_URL.exec(error.message)?.[0];
  return { error: error.name, code, message: error.message.slice(0, MAX_MESSAGE), ...(indexUrl ? { indexUrl } : {}) };
}
