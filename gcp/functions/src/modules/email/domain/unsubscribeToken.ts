import { createHmac, timingSafeEqual } from "node:crypto";
import { isEmailCategory, type EmailCategory } from "./categories";

/**
 * Stateless unsubscribe tokens (docs/design/stretch/email.md, Preferences and unsubscribe):
 *   token = base64url("v1:" + uid + ":" + category + ":" + expiryEpochSeconds) + "." + base64url(HMAC-SHA256(key, payloadPart))
 * No lookup table and no guessable ids. The key comes from Secret Manager (EMAIL_UNSUBSCRIBE_KEY) and must be at
 * least 32 bytes. Links stay valid for 60 days, past the 30 days CAN-SPAM expects an opt-out mechanism to work.
 */

export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;
export const MIN_KEY_BYTES = 32;
const VERSION = "v1";
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** Upper bound on accepted input so a hostile path cannot make us hash megabytes. */
export const MAX_TOKEN_LENGTH = 512;

export interface UnsubscribeClaims { uid: string; category: EmailCategory; expiresAt: number }

export type VerifyResult =
  | { ok: true; claims: UnsubscribeClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

function keyBytes(key: string | Buffer): Buffer {
  const bytes = typeof key === "string" ? Buffer.from(key, "utf8") : key;
  if (bytes.length < MIN_KEY_BYTES) throw new Error("unsubscribe key too short");
  return bytes;
}

function mac(key: Buffer, payloadPart: string): Buffer {
  // Domain-separated so the same key can never validate some other HMAC use.
  return createHmac("sha256", key).update(`dip-email-unsubscribe.${payloadPart}`, "utf8").digest();
}

export function signUnsubscribeToken(key: string | Buffer, uid: string, category: EmailCategory, nowSeconds: number,
  ttlSeconds = UNSUBSCRIBE_TOKEN_TTL_SECONDS): string {
  if (!UID_PATTERN.test(uid)) throw new Error("invalid uid for unsubscribe token");
  if (!isEmailCategory(category)) throw new Error("invalid category for unsubscribe token");
  const expiresAt = Math.floor(nowSeconds) + ttlSeconds;
  const payloadPart = Buffer.from(`${VERSION}:${uid}:${category}:${expiresAt}`, "utf8").toString("base64url");
  return `${payloadPart}.${mac(keyBytes(key), payloadPart).toString("base64url")}`;
}

/** Verifies signature first (constant time), then parses and checks expiry. Never throws on hostile input. */
export function verifyUnsubscribeToken(key: string | Buffer, token: unknown, nowSeconds: number): VerifyResult {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]+$/.test(parts[1]!)) return { ok: false, reason: "malformed" };
  const [payloadPart, signaturePart] = parts as [string, string];
  const expected = mac(keyBytes(key), payloadPart);
  const given = Buffer.from(signaturePart, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  const fields = Buffer.from(payloadPart, "base64url").toString("utf8").split(":");
  if (fields.length !== 4) return { ok: false, reason: "malformed" };
  const [version, uid, category, expiry] = fields as [string, string, string, string];
  if (version !== VERSION || !UID_PATTERN.test(uid) || !isEmailCategory(category) || !/^\d{1,12}$/.test(expiry)) return { ok: false, reason: "malformed" };
  const expiresAt = Number(expiry);
  if (nowSeconds > expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, claims: { uid, category, expiresAt } };
}
