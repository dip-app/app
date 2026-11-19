// @i18n-migrated
// Autosaved form drafts, kept in this browser only. Pure storage helpers (no React); the hook is useFormDraft.ts.
// Design and limits: docs/design/admin-drafts.md.

export type DraftKind = "event" | "theme";

/** Bump when the envelope changes. A draft written by another version is ignored and removed, never migrated. */
export const DRAFT_ENVELOPE_VERSION = 1;
/** A draft older than this is dropped when it is read. */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Serialized size cap, in UTF-16 characters. A form with this much text is not an event; the write is refused. */
export const DRAFT_MAX_CHARS = 64 * 1024;
/** Wait after the last change before writing. */
export const DRAFT_DEBOUNCE_MS = 800;

export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The signed-in admin a draft belongs to. Both parts come from the server session, never from the page. */
export interface DraftScope { uid: string; companyId: string }

export interface StoredDraft<T> { data: T; savedAt: number }

export type WriteResult = "ok" | "too-large" | "unavailable";

/** One slot per user, company and kind. Another admin on the same browser never sees it; neither does another company. */
export function draftKey(kind: DraftKind, scope: DraftScope): string {
  return `dip.admin.draft.v${DRAFT_ENVELOPE_VERSION}.${kind}.${encodeURIComponent(scope.companyId)}.${encodeURIComponent(scope.uid)}`;
}

/** The browser's localStorage, or null when it is blocked or missing (private modes, disabled storage, server render). */
export function browserStore(): DraftStore | null {
  try {
    if (typeof window === "undefined") return null;
    const store = window.localStorage;
    return store ?? null;
  } catch { return null; }
}

/**
 * Reads a draft. Anything unreadable, from another envelope version, from the future, past its TTL or rejected by `parse`
 * is removed and reported as absent. `parse` receives untrusted JSON and returns the cleaned data, or null.
 */
export function readDraft<T>(store: DraftStore | null, key: string, parse: (raw: unknown) => T | null, now: number = Date.now(), ttl: number = DRAFT_TTL_MS): StoredDraft<T> | null {
  if (!store) return null;
  let raw: string | null;
  try { raw = store.getItem(key); } catch { return null; }
  if (raw === null) return null;
  const drop = () => { try { store.removeItem(key); } catch { /* nothing more to do */ } return null; };
  try {
    const envelope = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; data?: unknown };
    if (envelope.v !== DRAFT_ENVELOPE_VERSION || typeof envelope.savedAt !== "number" || !Number.isFinite(envelope.savedAt)) return drop();
    if (now - envelope.savedAt > ttl || envelope.savedAt > now + 60_000) return drop();
    const data = parse(envelope.data);
    return data === null ? drop() : { data, savedAt: envelope.savedAt };
  } catch { return drop(); }
}

/** Writes a draft. Quota errors and blocked storage are reported, never thrown. */
export function writeDraft<T>(store: DraftStore | null, key: string, data: T, now: number = Date.now()): WriteResult {
  if (!store) return "unavailable";
  let text: string;
  try { text = JSON.stringify({ v: DRAFT_ENVELOPE_VERSION, savedAt: now, data }); } catch { return "unavailable"; }
  if (text.length > DRAFT_MAX_CHARS) return "too-large";
  try { store.setItem(key, text); return "ok"; } catch { return "unavailable"; }
}

export function clearDraft(store: DraftStore | null, key: string): void {
  if (!store) return;
  try { store.removeItem(key); } catch { /* nothing more to do */ }
}

/** Plain-text helpers shared by the form parsers: a draft file is untrusted input. */
export const asString = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
export const asStringList = (value: unknown, maxItems: number, maxLength: number): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= maxLength).slice(0, maxItems) : [];
export const asNumber = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
export const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** "3 minutes ago", in the portal's language; null under a minute (the caller says "a moment ago"). */
export function relativeAgo(then: number, now: number, locale: string): string | null {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (seconds < 60) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}
