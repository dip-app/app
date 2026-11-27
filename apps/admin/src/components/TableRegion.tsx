"use client";
// @i18n-migrated

import { useEffect, useRef, useState } from "react";

/**
 * Scrollable table container. A named region with a tab stop lets keyboard users scroll a wide table
 * (WCAG 2.1.1, axe "scrollable-region-focusable"); `busy` marks the rows as refreshing without clearing them.
 * When columns are hidden past an edge, that edge shows a soft shadow (`data-more="start|end|both"`), so a table
 * that scrolls sideways says so. Tables keep readable columns and scroll instead of squeezing dates onto many lines.
 */
export function TableRegion({ label, busy, children }: { label: string; busy?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<"start" | "end" | "both" | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) { setMore(undefined); return; }
      const start = el.scrollLeft > 1, end = el.scrollLeft < max - 1;
      setMore(start && end ? "both" : start ? "start" : end ? "end" : undefined);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    const table = el.firstElementChild;
    if (table) observer?.observe(table);
    return () => { el.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, []);
  return (
    <div className="table-frame" data-more={more}>
      <div ref={ref} className="table-wrap" role="region" aria-label={label} tabIndex={0} aria-busy={busy ? true : undefined}>
        {children}
      </div>
    </div>
  );
}
