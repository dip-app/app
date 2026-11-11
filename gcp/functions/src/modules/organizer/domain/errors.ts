/**
 * Organizer-command failures. Codes are Firebase callable error codes from docs/contracts/callables.md;
 * `reason` is the stable machine code clients may read from error details.
 */
export type OrganizerErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "aborted"
  | "internal";

export type OrganizerErrorReason =
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "NOT_ORGANIZER"
  | "COMPANY_MISMATCH"
  | "EVENT_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "CAPACITY_BELOW_ATTENDEES"
  | "REQUEST_REUSED"
  | "TAG_NOT_FOUND"
  | "TIME_CHANGE_BLOCKED"
  | "EVENT_NOT_ENDED"
  | "STATUS_TRANSITION_BLOCKED"
  | "INVALID_STORED_EVENT";

export class OrganizerError extends Error {
  constructor(
    readonly code: OrganizerErrorCode,
    readonly reason: OrganizerErrorReason,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "OrganizerError";
  }
}
