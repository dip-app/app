import { MAX_OPEN_TOKEN_LENGTH, verifyOpenToken } from "../domain/openToken";
import type { Clock, OutboxStore } from "./ports";

/**
 * Open-pixel endpoint (approximate open tracking). GET/HEAD `/o/<token>.gif`. Every GET/HEAD gets the same 200 GIF,
 * so the response never reveals whether a token was valid. Only a valid token touches the store, and store errors are
 * swallowed. Mail privacy proxies and image prefetchers make counts approximate.
 */

export interface OpenPixelDeps { outbox: Pick<OutboxStore, "recordOpen">; clock: Clock; key: string }
export interface OpenPixelRequest { method: string; path: string }
export interface OpenPixelResponse { status: number; headers: Record<string, string>; body: Buffer }

/** 43-byte transparent 1x1 GIF89a. */
export const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

const PIXEL_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "image/gif",
  "Content-Length": String(TRANSPARENT_GIF.length),
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function extractToken(path: string): string | null {
  if (typeof path !== "string") return null;
  const last = path.split("?")[0]!.split("/").filter((s) => s.length > 0).pop();
  if (!last) return null;
  const token = last.endsWith(".gif") ? last.slice(0, -4) : last;
  return token.length > 0 && token.length <= MAX_OPEN_TOKEN_LENGTH ? token : null;
}

export async function handleOpenPixel(deps: OpenPixelDeps, req: OpenPixelRequest): Promise<OpenPixelResponse> {
  const method = (req?.method ?? "").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { status: 405, headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, body: Buffer.from("Method Not Allowed") };
  }
  try {
    const now = deps.clock.now();
    const token = extractToken(req.path);
    const verified = token === null ? null : verifyOpenToken(deps.key, token, Math.floor(now.getTime() / 1000));
    if (verified !== null && verified.ok) await deps.outbox.recordOpen(verified.outboxId, now);
  } catch {
    /* swallowed: tracking must never change the response */
  }
  return { status: 200, headers: { ...PIXEL_HEADERS }, body: method === "HEAD" ? Buffer.alloc(0) : Buffer.from(TRANSPARENT_GIF) };
}
