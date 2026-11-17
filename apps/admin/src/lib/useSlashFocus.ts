"use client";

import { useEffect } from "react";

/** True when a key press belongs to a form control, so page shortcuts must stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
}

/** Pressing "/" focuses the page's search box (by id), unless the user is already typing or a dialog is open. */
export function useSlashFocus(inputId: string) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector("dialog[open]")) return;
      const input = document.getElementById(inputId);
      if (!input) return;
      event.preventDefault();
      input.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputId]);
}
