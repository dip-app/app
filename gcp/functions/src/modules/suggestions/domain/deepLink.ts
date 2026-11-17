import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed deep links from the suggestions email into the portal (docs/design/stretch/admin-suggestions-email.md):
 *   token = base64url(JSON {v:1,c,w,i,e}) + "." + base64url(HMAC-SHA256(key, "suggest-link:v1." + payloadPart))
 * The key is the existing EMAIL_UNSUBSCRIBE_KEY, separated by the purpose label. Links stay valid for 30 days.
 */
export const SUGGESTION_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_KEY_BYTES = 32;
const MAX_TOKEN_LENGTH = 512;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const WEEK_PATTERN = /^\d{4}-W\d{2}$/;
const URL_PART = /^[A-Za-z0-9_-]+$/;

export interface SuggestionClaims { companyId: string; weekKey: string; ideaId: string }

export type SuggestionVerifyResult =
  | ({ ok: true } & SuggestionClaims)
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

function keyBytes(key: string | Buffer): Buffer {
  const bytes = typeof key === "string" ? Buffer.from(key, "utf8") : key;
  if (bytes.length < MIN_KEY_BYTES) throw new Error("suggestion link key too short");
  return bytes;
}

function mac(key: Buffer, payloadPart: string): Buffer {
  return createHmac("sha256", key).update(`suggest-link:v1.${payloadPart}`, "utf8").digest();
}

export function signSuggestionToken(key: string | Buffer, payload: SuggestionClaims, nowSeconds: number,
  ttlSeconds = SUGGESTION_TOKEN_TTL_SECONDS): string {
  if (!ID_PATTERN.test(payload.companyId) || !ID_PATTERN.test(payload.ideaId) || !WEEK_PATTERN.test(payload.weekKey)) {
    throw new Error("invalid suggestion token claims");
  }
  const body = JSON.stringify({ v: 1, c: payload.companyId, w: payload.weekKey, i: payload.ideaId, e: Math.floor(nowSeconds) + ttlSeconds });
  const payloadPart = Buffer.from(body, "utf8").toString("base64url");
  return `${payloadPart}.${mac(keyBytes(key), payloadPart).toString("base64url")}`;
}

/** Verifies the signature first (constant time), then the claims and expiry. Never throws on hostile input. */
export function verifySuggestionToken(key: string | Buffer, token: unknown, nowSeconds: number): SuggestionVerifyResult {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !URL_PART.test(parts[0]!) || !URL_PART.test(parts[1]!)) return { ok: false, reason: "malformed" };
  const [payloadPart, signaturePart] = parts as [string, string];
  const expected = mac(keyBytes(key), payloadPart);
  const given = Buffer.from(signaturePart, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  let claims: unknown;
  try { claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (typeof claims !== "object" || claims === null) return { ok: false, reason: "malformed" };
  const { v, c, w, i, e } = claims as Record<string, unknown>;
  if (v !== 1 || typeof c !== "string" || typeof w !== "string" || typeof i !== "string" || typeof e !== "number" || !Number.isInteger(e)
    || !ID_PATTERN.test(c) || !ID_PATTERN.test(i) || !WEEK_PATTERN.test(w)) return { ok: false, reason: "malformed" };
  if (nowSeconds > e) return { ok: false, reason: "expired" };
  return { ok: true, companyId: c, weekKey: w, ideaId: i };
}

export function suggestionLinkURL(origin: string, token: string): string {
  return `${origin}/admin/ideas/suggested/?t=${token}`;
}
