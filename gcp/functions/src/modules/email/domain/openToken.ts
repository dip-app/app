import { createHmac, timingSafeEqual } from "node:crypto";
import { MIN_KEY_BYTES } from "./unsubscribeToken";

/**
 * Stateless open-pixel tokens (approximate open tracking):
 *   token = base64url("v1:" + outboxId + ":" + expiryEpochSeconds) + "." + base64url(HMAC-SHA256(key, "dip-email-open." + payloadPart))
 * The key is the same Secret Manager value as unsubscribe tokens (EMAIL_UNSUBSCRIBE_KEY). That is safe because the MAC
 * domain separators differ ("dip-email-open." vs "dip-email-unsubscribe."), so a token minted for one purpose never
 * verifies for the other. A token proves only that DIP sent that outbox email; it carries no member identity.
 */

export const OPEN_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const VERSION = "v1";
const OUTBOX_ID_PATTERN = /^[A-Za-z0-9_-]{1,300}$/;
/** Upper bound on accepted input so a hostile path cannot make us hash megabytes. */
export const MAX_OPEN_TOKEN_LENGTH = 600;

export type OpenVerifyResult =
  | { ok: true; outboxId: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

function keyBytes(key: string | Buffer): Buffer {
  const bytes = typeof key === "string" ? Buffer.from(key, "utf8") : key;
  if (bytes.length < MIN_KEY_BYTES) throw new Error("open key too short");
  return bytes;
}

function mac(key: Buffer, payloadPart: string): Buffer {
  return createHmac("sha256", key).update(`dip-email-open.${payloadPart}`, "utf8").digest();
}

export function signOpenToken(key: string | Buffer, outboxId: string, nowSeconds: number, ttlSeconds = OPEN_TOKEN_TTL_SECONDS): string {
  if (!OUTBOX_ID_PATTERN.test(outboxId)) throw new Error("invalid outbox id for open token");
  const expiresAt = Math.floor(nowSeconds) + ttlSeconds;
  const payloadPart = Buffer.from(`${VERSION}:${outboxId}:${expiresAt}`, "utf8").toString("base64url");
  return `${payloadPart}.${mac(keyBytes(key), payloadPart).toString("base64url")}`;
}

/** Verifies the signature first (constant time), then parses and checks expiry. Never throws on hostile input. */
export function verifyOpenToken(key: string | Buffer, token: unknown, nowSeconds: number): OpenVerifyResult {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_OPEN_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]+$/.test(parts[1]!)) return { ok: false, reason: "malformed" };
    const [payloadPart, signaturePart] = parts as [string, string];
    const expected = mac(keyBytes(key), payloadPart);
    const given = Buffer.from(signaturePart, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
    const fields = Buffer.from(payloadPart, "base64url").toString("utf8").split(":");
    if (fields.length !== 3) return { ok: false, reason: "malformed" };
    const [version, outboxId, expiry] = fields as [string, string, string];
    if (version !== VERSION || !OUTBOX_ID_PATTERN.test(outboxId) || !/^\d{1,12}$/.test(expiry)) return { ok: false, reason: "malformed" };
    const expiresAt = Number(expiry);
    if (nowSeconds > expiresAt) return { ok: false, reason: "expired" };
    return { ok: true, outboxId, expiresAt };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
