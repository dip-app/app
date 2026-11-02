import { AccountsError } from "./errors";

/**
 * Validates the untrusted ResolveMembershipRequest payload (contract v1):
 * exactly `{ contractVersion: 1 }`. Identity, domain and name come only from
 * the Auth token, so any other field is rejected.
 */
export function parseResolveMembershipRequest(data: unknown): void {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.");
  }
  const record = data as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== "contractVersion").sort();
  if (unknownKeys.length > 0) {
    throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", unknownKeys);
  }
  if (record.contractVersion !== 1) {
    throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", ["contractVersion"]);
  }
}
