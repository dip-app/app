import type { JoinCompanyRequest } from "../../../generated/models";
import { AccountsError } from "./errors";
import { normalizeJoinCode } from "./joinCode";

const ALLOWED_KEYS = new Set(["contractVersion", "joinCode", "displayName"]);

export interface ValidJoinCompanyRequest {
  normalizedJoinCode: string;
  displayName: string;
}

function fail(fields: string[]): never {
  throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid join request.", fields);
}

/**
 * Validates an untrusted callable payload against JoinCompanyRequest (contract v1)
 * and applies the contract's normalization. Error details name fields only; they
 * never echo the submitted join code.
 */
export function parseJoinCompanyRequest(data: unknown): ValidJoinCompanyRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) fail([]);
  const record = data as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) fail(unknownKeys.sort());

  const bad: string[] = [];
  const request = record as Partial<Record<keyof JoinCompanyRequest, unknown>>;
  if (request.contractVersion !== 1) bad.push("contractVersion");

  const { joinCode, displayName } = request;
  let normalizedJoinCode = "";
  if (typeof joinCode !== "string" || joinCode.length < 1 || joinCode.length > 64) {
    bad.push("joinCode");
  } else {
    normalizedJoinCode = normalizeJoinCode(joinCode);
    if (normalizedJoinCode.length === 0) bad.push("joinCode");
  }

  let trimmedName = "";
  if (typeof displayName !== "string" || displayName.length < 1 || displayName.length > 80) {
    bad.push("displayName");
  } else {
    trimmedName = displayName.trim();
    if (trimmedName.length === 0) bad.push("displayName");
  }

  if (bad.length > 0) fail(bad);
  return { normalizedJoinCode, displayName: trimmedName };
}
