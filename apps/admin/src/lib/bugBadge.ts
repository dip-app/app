"use client";

import { useSyncExternalStore } from "react";

/** How many bug reports are waiting (status `new`) for the sidebar badge; `capped` when older reports were not counted. */
export interface BugBadge { count: number; capped: boolean }

let current: BugBadge | null = null;
const listeners = new Set<() => void>();

export function setBugBadge(next: BugBadge | null): void {
  if (current?.count === next?.count && current?.capped === next?.capped) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function useBugBadge(): BugBadge | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
    () => null,
  );
}

/** "99+" for a long queue, or when older reports were not counted. */
export function badgeLabel(badge: BugBadge): string {
  return badge.count > 99 ? "99+" : badge.capped && badge.count > 0 ? `${badge.count}+` : String(badge.count);
}
