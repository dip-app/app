"use client";
// @i18n-migrated

import { useSyncExternalStore } from "react";
import { formatDate, formatTime, intlLocale, t } from "@/lib/i18n";

// One shared minute clock for every relative time on the page, so "2 min ago" keeps counting without a timer per row.
let minute = Math.floor(Date.now() / 60_000);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) timer = setInterval(() => {
    const next = Math.floor(Date.now() / 60_000);
    if (next !== minute) { minute = next; listeners.forEach((l) => l()); }
  }, 15_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}
/** The current time, re-rendering once a minute. Shared by every caller. */
export function useMinuteClock(): Date {
  const value = useSyncExternalStore(subscribe, () => minute, () => minute);
  return new Date(value * 60_000 + 59_999);
}

/** "Nov 26, 5:12 PM" (with the year when it is not this year). */
export function absoluteTime(at: Date, now: Date = new Date()): string {
  const sameYear = at.getFullYear() === now.getFullYear();
  return `${formatDate(at, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}, ${formatTime(at, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * "just now", "12 min ago", "3 hr ago", "yesterday", "4 days ago", then the date ("Nov 12"). Future times read
 * "in 3 days" up to two months ahead. Words come from Intl.RelativeTimeFormat in the active language.
 */
export function relativeTime(at: Date, now: Date = new Date()): string {
  const seconds = (at.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return t("ui.time.justNow");
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto", style: "short" });
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  // Within a week either way, and up to two months ahead ("in 10 days" reads better than a date for what is coming).
  if (abs < 7 * 86_400 || (seconds > 0 && abs < 60 * 86_400)) {
    // Calendar days, so "yesterday" means the day before today, not 24 hours ago.
    const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return rtf.format(Math.round((midnight(at) - midnight(now)) / 86_400_000), "day");
  }
  const sameYear = at.getFullYear() === now.getFullYear();
  return formatDate(at, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/**
 * A time shown relative to now ("3 hr ago") that keeps itself current. The absolute time is the tooltip and is read
 * by screen readers after the relative words, so nothing depends on hovering.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useMinuteClock();
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const absolute = absoluteTime(at, now);
  const relative = relativeTime(at, now);
  return (
    <time dateTime={iso} title={absolute} className={`rel-time${className ? ` ${className}` : ""}`}>
      {relative}{relative !== absolute && <span className="sr-only">{`, ${absolute}`}</span>}
    </time>
  );
}
