"use client";
// @i18n-migrated
// Autosave for a "new" form: a debounced write to this browser, an offer to restore on the next visit, and cleanup.
// The interface is storage-agnostic on purpose: a server-side draft (docs/design/admin-drafts.md) would replace
// formDraft.ts underneath without touching the forms.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DRAFT_DEBOUNCE_MS, type DraftKind, type DraftScope, type DraftStore, type StoredDraft,
  browserStore, clearDraft, draftKey, readDraft, writeDraft,
} from "./formDraft";

/**
 * idle: nothing written yet. saved: the last write worked. unavailable: storage is blocked or full (the form then asks
 * before the page is left). too-large: the form outgrew the size cap. other-tab: a second tab wrote the draft while this
 * one has edits; the next change here replaces it (last write wins).
 */
export type DraftStatus = "idle" | "saved" | "unavailable" | "too-large" | "other-tab";

export interface UseFormDraftOptions<T> {
  kind: DraftKind;
  /** The signed-in admin. Null while unknown: nothing is read or written. */
  scope: DraftScope | null;
  /** False for forms that edit a saved record: those have no draft. */
  enabled: boolean;
  /** The form's current content, JSON-serializable and free of anything sensitive. */
  value: T;
  /** The admin has changed something. Defaults filled in by the page do not count. */
  touched: boolean;
  /** There is something worth keeping. An empty form never writes, and clears a stale draft. */
  meaningful: boolean;
  /** Cleans untrusted stored data into a `T`, or returns null to reject it. */
  parse: (raw: unknown) => T | null;
  /** Test seams. */
  store?: DraftStore | null;
  now?: () => number;
  debounceMs?: number;
}

export interface FormDraft<T> {
  /** The draft found when the page opened (or one a second tab saved while this form was untouched). Stays until answered. */
  offer: StoredDraft<T> | null;
  /** The admin took the offer: hands it over and hides the notice. The form applies it; autosave then continues from it. */
  acceptOffer: () => StoredDraft<T> | null;
  /** The admin declined the offer: hides the notice and, unless the form has since rewritten the slot, deletes it. */
  declineOffer: () => void;
  status: DraftStatus;
  /** Content exists that no draft holds because the write failed. Drives the browser's leave-page dialog. */
  unsaved: boolean;
  /**
   * Deletes the draft and stops saving (after a successful publish, or an explicit discard). With `keepOffer`, a slot this form
   * never wrote (the draft from an earlier visit, still unanswered) is left alone: leaving the page does not answer the offer.
   */
  clear: (options?: { keepOffer?: boolean }) => void;
  /** Writes now if a change is waiting. */
  flush: () => void;
}

export function useFormDraft<T>(options: UseFormDraftOptions<T>): FormDraft<T> {
  const { kind, scope, enabled, value, touched, meaningful, parse, debounceMs = DRAFT_DEBOUNCE_MS } = options;
  const store = useMemo(() => (options.store !== undefined ? options.store : browserStore()), [options.store]);
  const clock = options.now ?? Date.now;
  const key = scope && enabled ? draftKey(kind, scope) : null;
  const serial = JSON.stringify(value);

  const [offer, setOffer] = useState<StoredDraft<T> | null>(null);
  const [status, setStatus] = useState<DraftStatus>("idle");

  const latest = useRef({ parse, value, clock, store, touched });
  latest.current = { parse, value, clock, store, touched };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef(false);
  const closed = useRef(false);
  /** True once this form has written the slot itself; declining the offer must then leave the slot alone. */
  const wrote = useRef(false);

  const cancelTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const flush = useCallback(() => {
    cancelTimer();
    if (!key || !waiting.current || closed.current) return;
    waiting.current = false;
    const { value: current, clock: now, store: target } = latest.current;
    const result = writeDraft(target, key, current, now());
    if (result === "ok") { wrote.current = true; setStatus("saved"); } else setStatus(result);
  }, [key]);

  // Read what an earlier visit left, once per slot.
  useEffect(() => {
    closed.current = false;
    wrote.current = false;
    waiting.current = false;
    setOffer(null);
    setStatus("idle");
    if (!key) return;
    const found = readDraft(latest.current.store, key, latest.current.parse, latest.current.clock());
    if (found) setOffer(found);
  }, [key]);

  // Debounced save of every change the admin makes.
  useEffect(() => {
    if (!key || !touched || closed.current) return;
    if (!meaningful) {
      // Everything was emptied again: a draft of nothing is not worth offering later.
      cancelTimer();
      waiting.current = false;
      if (wrote.current) { clearDraft(latest.current.store, key); wrote.current = false; setStatus("idle"); }
      return;
    }
    waiting.current = true;
    cancelTimer();
    timer.current = setTimeout(flush, debounceMs);
    return cancelTimer;
    // `serial` stands for the value: the object itself is a new identity every render.
  }, [key, serial, touched, meaningful, debounceMs, flush]);

  // A change still waiting is written when the tab is hidden or closed, and when the form unmounts (back, forward, navigation).
  useEffect(() => {
    if (!key) return;
    const hide = () => flush();
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", hide);
    window.addEventListener("beforeunload", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("beforeunload", hide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [key, flush]);

  // Another tab on the same slot: its draft shows as an offer while this form is untouched; otherwise the last write wins.
  useEffect(() => {
    if (!key || !store) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || (event.storageArea && event.storageArea !== (store as unknown as Storage))) return;
      if (event.newValue === null) { setOffer(null); return; }
      if (latest.current.touched) { setStatus("other-tab"); return; }
      const found = readDraft(latest.current.store, key, latest.current.parse, latest.current.clock());
      setOffer(found);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, store]);

  const acceptOffer = useCallback(() => {
    const taken = offer;
    setOffer(null);
    return taken;
  }, [offer]);

  const declineOffer = useCallback(() => {
    setOffer(null);
    if (key && !wrote.current) clearDraft(latest.current.store, key);
  }, [key]);

  const clear = useCallback((opts?: { keepOffer?: boolean }) => {
    closed.current = true;
    cancelTimer();
    waiting.current = false;
    setStatus("idle");
    if (opts?.keepOffer && !wrote.current) return;
    setOffer(null);
    if (key) clearDraft(latest.current.store, key);
  }, [key]);

  const unsaved = Boolean(key) && touched && meaningful && (status === "unavailable" || status === "too-large");
  return { offer, acceptOffer, declineOffer, status, unsaved, clear, flush };
}
