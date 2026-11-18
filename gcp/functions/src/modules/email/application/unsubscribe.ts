import { escapeHtml } from "../../share/domain/sharePage";
import { EMAIL_CATEGORIES, type EmailCategory } from "../domain/categories";
import { MAX_TOKEN_LENGTH, verifyUnsubscribeToken } from "../domain/unsubscribeToken";
import type { Clock, EmailPreferencesStore } from "./ports";

/**
 * Unsubscribe endpoint logic (docs/design/stretch/email.md, Preferences and unsubscribe). Framework free so it is
 * testable without Firebase. GET/HEAD only render a confirmation page (link scanners prefetch GETs); POST changes
 * preferences (RFC 8058 one-click or the page form). No redirects, no cookies, no auth, one body for every failure.
 */

export interface UnsubscribeDeps { preferences: EmailPreferencesStore; clock: Clock; key: string; publicOrigin: string }
export interface UnsubscribeRequest { method: string; path: string; body: unknown; contentType: string | undefined }
export interface UnsubscribeResponse { status: number; headers: Record<string, string>; body: string }

const CATEGORY_WORDS: Readonly<Record<EmailCategory, string>> = {
  invites: "event invitations",
  event_updates: "event updates",
  reminders: "event reminders",
  challenges: "weekly theme reviews",
  discovery: "event suggestions",
  calendar_invites: "calendar invites",
  admin_suggestions: "weekly event ideas",
};

const BASE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const STYLE = `body{margin:0;padding:24px 16px;background:#f4f4f6;color:#4a4a55;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:440px;margin:40px auto;background:#fff;border:1px solid #e3e3e8;border-radius:12px;padding:28px}
h1{margin:0 0 12px;font-size:22px;line-height:1.3;color:#22222a}p{margin:0 0 16px}
button{display:block;width:100%;box-sizing:border-box;margin:0 0 12px;padding:12px 16px;font:inherit;font-weight:600;border-radius:8px;cursor:pointer}
.primary{background:#7B88FA;color:#fff;border:1px solid #7B88FA}.secondary{background:#fff;color:#4a4a55;border:1px solid #c9c9d1}
.note{font-size:14px;color:#6b6b78;margin:8px 0 0}`;

function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${inner}</main></body></html>`;
}

const SETTINGS_NOTE = `<p class="note">You can change email settings any time in the DIP app under Profile &gt; Notifications.</p>`;

const INVALID_PAGE = page("Link not valid", `<h1>Link not valid</h1><p>This link is invalid or has expired. You can change email settings in the DIP app under Profile &gt; Notifications.</p>`);
const DONE_PAGE = page("You are unsubscribed", `<h1>You are unsubscribed</h1><p>We will not send you these emails anymore.</p>${SETTINGS_NOTE}`);

function respond(status: number, body: string, extra?: Record<string, string>): UnsubscribeResponse {
  return { status, headers: { ...BASE_HEADERS, ...extra }, body };
}

function confirmPage(category: EmailCategory, token: string): string {
  const words = escapeHtml(CATEGORY_WORDS[category]);
  return page("Unsubscribe", `<h1>Unsubscribe from DIP emails</h1><p>Stop receiving emails about ${words}?</p>` +
    `<form method="post" action="/u/${escapeHtml(token)}"><input type="hidden" name="List-Unsubscribe" value="One-Click">` +
    `<button class="primary" type="submit">Unsubscribe</button>` +
    `<button class="secondary" type="submit" name="scope" value="all">Unsubscribe from all DIP emails</button></form>${SETTINGS_NOTE}`);
}

function extractToken(path: string): string | null {
  if (typeof path !== "string") return null;
  const segments = path.split("?")[0]!.split("/").filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (!last || last.length > MAX_TOKEN_LENGTH) return null;
  return last;
}

/** Accepts urlencoded text/Buffer or an object already parsed by Express. Never throws. */
function parseForm(body: unknown): Map<string, string> {
  const out = new Map<string, string>();
  let text: string | null = null;
  if (typeof body === "string") text = body;
  else if (Buffer.isBuffer(body)) text = body.toString("utf8");
  if (text !== null) {
    if (text.length > 4096) return out;
    try {
      for (const [k, v] of new URLSearchParams(text)) if (!out.has(k)) out.set(k, v);
    } catch { /* ignore */ }
  } else if (body !== null && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      const value = Array.isArray(v) ? v[0] : v;
      if (typeof value === "string") out.set(k, value);
    }
  }
  return out;
}

export async function handleUnsubscribe(deps: UnsubscribeDeps, req: UnsubscribeRequest): Promise<UnsubscribeResponse> {
  const method = (req.method ?? "").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return respond(405, "Method Not Allowed", { Allow: "GET, HEAD, POST", "Content-Type": "text/plain; charset=utf-8" });
  }
  const token = extractToken(req.path);
  const verified = token === null ? null : verifyUnsubscribeToken(deps.key, token, Math.floor(deps.clock.now().getTime() / 1000));
  if (token === null || verified === null || !verified.ok) return respond(400, INVALID_PAGE);
  const { uid, category } = verified.claims;
  if (method !== "POST") return respond(200, confirmPage(category, token));

  const form = parseForm(req.body);
  const all = form.get("scope") === "all";
  const oneClick = form.get("List-Unsubscribe") === "One-Click";
  // A POST must be an explicit unsubscribe action; anything else changes nothing.
  if (!all && !oneClick) return respond(400, INVALID_PAGE);
  // The result (member missing) is deliberately ignored so account existence is not revealed.
  await deps.preferences.disable(uid, all ? EMAIL_CATEGORIES : [category]);
  return respond(200, DONE_PAGE);
}
