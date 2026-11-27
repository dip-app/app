"use client";

// Portal-wide keyboard shortcuts: "g" then a letter goes to a page, "?" (or Ctrl/Cmd+/) lists them, "/" focuses a page's
// search (useSlashFocus), and the review queue has J/K/A/R. Single-key shortcuts can be switched off (WCAG 2.1.4) with
// one setting that every listener follows at once; it is remembered in this browser (storage may be blocked).

import { useSyncExternalStore } from "react";

/** Same key the review queue has always used, so an existing "off" choice carries over. */
export const SHORTCUTS_STORAGE = "dip-admin-review-keys";
const CHANGED = "dip-admin-shortcuts-changed";

/** The letter after "g" for each page (sidebar hrefs). */
export const GO_KEYS: Record<string, string> = {
  "/overview/": "o",
  "/events/": "e",
  "/ideas/": "i",
  "/themes/": "t",
  "/challenges/": "c",
  "/members/": "m",
  "/roster/": "r",
  "/import/": "p",
  "/bug-reports/": "b",
  "/audit/": "a",
  "/account/": "s",
};

/** How long "g" waits for its letter. */
export const GO_TIMEOUT_MS = 1500;

// Kept in memory too, so a blocked storage still switches everything off for this page load.
let memory: boolean | null = null;

export function shortcutsEnabled(): boolean {
  if (memory !== null) return memory;
  try { return window.localStorage.getItem(SHORTCUTS_STORAGE) !== "off"; } catch { return true; }
}

export function setShortcutsEnabled(on: boolean): void {
  memory = on;
  try { window.localStorage.setItem(SHORTCUTS_STORAGE, on ? "on" : "off"); } catch { /* not remembered */ }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(listener: () => void): () => void {
  // key null: storage was cleared in another tab.
  const onStorage = (event: StorageEvent) => { if (event.key === SHORTCUTS_STORAGE || event.key === null) { memory = null; listener(); } };
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(CHANGED, listener); window.removeEventListener("storage", onStorage); };
}

/** The single-key shortcut setting, live: switching it anywhere (the list, the review queue, another tab) applies at once. */
export function useShortcutsEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, shortcutsEnabled, () => true);
  return [on, setShortcutsEnabled];
}

// "g" was pressed and waits for its letter: page-level single-key handlers (the review queue) ignore the next key.
let goPendingUntil = 0;
export function setGoPending(pending: boolean): void { goPendingUntil = pending ? Date.now() + GO_TIMEOUT_MS : 0; }
export function isGoPending(): boolean { return Date.now() < goPendingUntil; }

/** True for a key press that a single-key shortcut must ignore: composing text (IME) or already handled. */
export function ignoredKey(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229;
}
