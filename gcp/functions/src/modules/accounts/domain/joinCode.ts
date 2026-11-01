import { createHash } from "node:crypto";

/** Contract normalization for join codes: trim surrounding whitespace, then uppercase. */
export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Document ID of the private `companyAccess/{hash}` lookup for a normalized code.
 * Matches gcp/scripts/seed.mjs. Hashing keeps raw codes out of document paths;
 * it is not a substitute for server-side throttling of low-entropy codes.
 */
export function joinCodeLookupId(normalizedCode: string): string {
  return createHash("sha256").update(normalizedCode, "utf8").digest("hex");
}
