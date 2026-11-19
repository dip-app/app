"use client";

// @i18n-migrated

import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { userErrorMessage } from "@/lib/userError";
import { ErrorIcon } from "./kit/InlineNotice";

export interface ToastOptions {
  tone?: "success" | "error";
  /** One quick follow-up, such as Undo. Running it dismisses the toast. */
  action?: { label: string; onClick: () => void | Promise<void> };
}
interface ToastItem { id: number; message: string; tone: "success" | "error"; action?: ToastOptions["action"] }

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 4;
const EMPTY: ToastItem[] = [];

let items: ToastItem[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/**
 * Shows a short confirmation (or error) at the bottom right. Safe to call from anywhere; needs a mounted <Toaster />.
 * Successes leave after 6 s; errors stay until dismissed. The same message again replaces the earlier toast.
 * For a caught error use `toastError`, which never shows a code.
 */
export function toast(message: string, options: ToastOptions = {}): number {
  const item: ToastItem = { id: nextId++, message, tone: options.tone ?? "success", action: options.action };
  items = [...items.filter((other) => other.message !== message), item].slice(-MAX_VISIBLE);
  emit();
  return item.id;
}
/** An error toast for anything thrown, in plain language (`userError`). `fallback` words an unknown failure. */
export function toastError(error: unknown, fallback?: string): number {
  return toast(userErrorMessage(error, fallback), { tone: "error" });
}
export function dismissToast(id: number) {
  items = items.filter((item) => item.id !== id);
  if (items.length === 0) items = EMPTY;
  emit();
}
export function dismissAllToasts() {
  items = EMPTY;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function ToastView({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    // Errors stay until dismissed: a two-line message (longer in Spanish) needs more than 6 s.
    if (paused || item.tone === "error") return;
    const timer = setTimeout(() => dismissToast(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [paused, item.id, item.tone]);
  return (
    <div
      className={`toast ${item.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {item.tone === "error" && <ErrorIcon />}
      <p className="toast-text">{item.message}</p>
      {item.action && (
        <button type="button" className="toast-btn" onClick={() => { void item.action!.onClick(); dismissToast(item.id); }}>{item.action.label}</button>
      )}
      <button type="button" className="toast-btn toast-close" aria-label={t("common.dismissNotification")} onClick={() => dismissToast(item.id)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

/** Mount once (in Shell). Successes are announced politely, errors as alerts. */
export function Toaster() {
  const current = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  return (
    <div className="toaster">
      <div role="status" aria-live="polite">
        {current.filter((item) => item.tone === "success").map((item) => <ToastView key={item.id} item={item} />)}
      </div>
      <div role="alert">
        {current.filter((item) => item.tone === "error").map((item) => <ToastView key={item.id} item={item} />)}
      </div>
    </div>
  );
}
