"use client";

import { useEffect, useRef, useState } from "react";
import { SKELETON_DELAY_MS, SKELETON_MIN_MS } from "@/lib/skeletonLayout";

/**
 * True once `active` has been true for `delay` ms, and stays true until `minVisible` ms after it appeared.
 * A load that finishes inside `delay` never shows it (no flicker); a shown one never disappears instantly.
 */
export function useDelayedShow(active: boolean, delay: number = SKELETON_DELAY_MS, minVisible: number = SKELETON_MIN_MS): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (active && !visible) {
      const timer = setTimeout(() => { shownAt.current = Date.now(); setVisible(true); }, delay);
      return () => clearTimeout(timer);
    }
    if (!active && visible) {
      const timer = setTimeout(() => setVisible(false), Math.max(0, minVisible - (Date.now() - shownAt.current)));
      return () => clearTimeout(timer);
    }
  }, [active, visible, delay, minVisible]);
  return visible;
}

/**
 * For a page that shows a skeleton while `loading`: true while the skeleton should be on screen, which is the whole
 * load plus any time the skeleton still has to stay up (so a skeleton that appeared is not cut off after a few ms).
 * Render the skeleton when this is true and the real page otherwise.
 */
export function useSkeletonGate(loading: boolean): boolean {
  const visible = useDelayedShow(loading);
  return loading || visible;
}
