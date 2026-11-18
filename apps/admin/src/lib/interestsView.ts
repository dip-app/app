"use client";

import { useCallback, useState } from "react";

export type InterestsView = "grid" | "list";
export const INTERESTS_VIEW_KEY = "dip.admin.interestsView";

/** The saved choice for this browser; grid when nothing (valid) is saved or storage is blocked. */
export function readInterestsView(): InterestsView {
  try {
    return window.localStorage.getItem(INTERESTS_VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** Grid/list choice for the Interests card, remembered per browser. Storage may be unavailable; the choice still works for the visit. */
export function useInterestsView(): [InterestsView, (next: InterestsView) => void] {
  const [view, setView] = useState<InterestsView>(() => (typeof window === "undefined" ? "grid" : readInterestsView()));
  const choose = useCallback((next: InterestsView) => {
    setView(next);
    try { window.localStorage.setItem(INTERESTS_VIEW_KEY, next); } catch { /* private mode: keep it for this visit only */ }
  }, []);
  return [view, choose];
}
