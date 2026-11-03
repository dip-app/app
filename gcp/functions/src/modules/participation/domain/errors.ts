export type ParticipationErrorCode = "unauthenticated" | "invalid-argument" | "permission-denied" | "not-found" | "failed-precondition" | "resource-exhausted" | "internal";

export class ParticipationError extends Error {
  constructor(readonly code: ParticipationErrorCode, readonly reason: string, message: string,
    readonly fields: readonly string[] = []) {
    super(message);
    this.name = "ParticipationError";
  }
}
