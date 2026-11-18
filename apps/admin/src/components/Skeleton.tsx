"use client";

// @i18n-migrated

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { CHART_HEIGHT } from "@/lib/skeletonLayout";
import { useDelayedShow } from "./useDelayedShow";

// A small kit for loading states. Rule: a skeleton is built from the SAME markup and classes as the loaded page, with
// `Sk` (a text-sized placeholder) where text goes. `Sk` is a block that holds a non-breaking space, so it takes the exact
// line height of the real text around it and nothing shifts when data arrives. Everything is decorative (`aria-hidden`);
// `SkeletonRegion` adds the one screen reader announcement and `aria-busy`.

type Size = number | string;
const px = (value: Size): string => (typeof value === "number" ? `${value}px` : value);

/** A text-sized placeholder. Height comes from the surrounding font and line height; `w` is its width. */
export function Sk({ w = "100%", className = "" }: { w?: Size; className?: string }) {
  return <span className={`sk-text ${className}`.trim()} style={{ "--sk-w": px(w) } as CSSProperties} aria-hidden>{" "}</span>;
}

/** A fixed-height bar (use `Sk` when it stands in for text). */
export function SkeletonLine({ w = "100%", h = 12, className = "" }: { w?: Size; h?: Size; className?: string }) {
  return <span className={`sk sk-line ${className}`.trim()} style={{ width: px(w), height: px(h) }} aria-hidden />;
}

/** A fixed-size rounded block: thumbnails, buttons, pills. */
export function SkeletonBlock({ w = "100%", h = 64, r = 6, className = "" }: { w?: Size; h?: Size; r?: Size; className?: string }) {
  return <span className={`sk sk-block ${className}`.trim()} style={{ width: px(w), height: px(h), borderRadius: px(r) }} aria-hidden />;
}

export function SkeletonCircle({ size = 32, className = "" }: { size?: number; className?: string }) {
  return <span className={`sk sk-circle ${className}`.trim()} style={{ width: size, height: size }} aria-hidden />;
}

/** Same 32 px circle as the portal's `Avatar`. */
export function SkeletonAvatar({ size = 32 }: { size?: number }) {
  return <SkeletonCircle size={size} className="sk-avatar" />;
}

/** Title and subtitle placeholders in the sizes of `.page-header`, for pages whose title depends on the data. */
export function SkeletonPageHeader({ subtitle = true, action = false }: { subtitle?: boolean; action?: boolean }) {
  return (
    <header className="page-header sk-page-header" aria-hidden>
      <div className="titles">
        <h1 className="page-title"><Sk w={220} /></h1>
        {subtitle && <p className="subtitle"><Sk w={380} /></p>}
      </div>
      {action && <div className="header-action"><SkeletonBlock w={120} h={36} /></div>}
    </header>
  );
}

/** One `.stat-tile`: label, big number, note. Heights follow the tile's own fonts. */
export function SkeletonStatTile() {
  return (
    <div className="stat-tile" aria-hidden>
      <p className="stat-label"><Sk w="62%" /></p>
      <p className="stat-value"><Sk w="38%" /></p>
      <p className="stat-note"><Sk w="74%" /></p>
    </div>
  );
}

const GHOST_BARS = [0.32, 0.5, 0.42, 0.66, 0.58, 0.28, 0.2, 0.5, 0.74, 0.62, 0.7, 0.46, 0.38, 0.26, 0.22, 0.54, 0.8, 0.9, 0.72, 0.64, 0.5, 0.3, 0.24, 0.58, 0.68, 0.6, 0.76, 0.52, 0.36, 0.28];

/** A ghost bar chart at the real chart height: three grid lines, 30 bars, an axis row. */
export function SkeletonChart({ height = CHART_HEIGHT }: { height?: number }) {
  return (
    <div className="sk-chart" style={{ height }} aria-hidden>
      <div className="sk-chart-plot">
        {[0, 1, 2].map((i) => <span key={i} className="sk-chart-grid" style={{ bottom: `${i * 50}%` }} />)}
        <div className="sk-chart-bars">{GHOST_BARS.map((fraction, i) => <span key={i} className="sk sk-chart-bar" style={{ height: `${fraction * 100}%` }} />)}</div>
      </div>
      <div className="sk-chart-axis"><SkeletonLine w={44} h={10} /><SkeletonLine w={44} h={10} /><SkeletonLine w={44} h={10} /></div>
    </div>
  );
}

export interface SkeletonColumn {
  /** The real column heading (headings are static, so they stay readable while the rows load). */
  head: string;
  /** Header cell class, e.g. "num" or "right". */
  className?: string;
  /** Screen reader only heading (action columns). */
  hidden?: boolean;
  /** The cell's placeholder content; receives the row index so rows can vary a little. */
  cell: (row: number) => ReactNode;
  /** Cell class and `data-label` (phones show it as the cell caption). */
  cellClass?: string;
}

/** The real table markup (`.table-wrap > table.table`) with placeholder cells, so row height, padding and columns match. */
export function SkeletonTable({ columns, rows, tableClass = "table responsive", rowClass }: { columns: SkeletonColumn[]; rows: number; tableClass?: string; rowClass?: string }) {
  return (
    <div className="table-wrap" aria-hidden>
      <table className={tableClass}>
        <thead><tr>{columns.map((c) => <th key={c.head} scope="col" className={c.className}>{c.hidden ? <span className="sr-only">{c.head}</span> : c.head}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} className={rowClass}>
              {columns.map((c, i) => <td key={c.head} className={c.cellClass ?? c.className} data-label={i === 0 || c.hidden ? undefined : c.head}>{c.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A responsive grid of identical placeholder cards (the same `auto-fill` rule as the real grid). */
export function SkeletonCardGrid({ count, min = 220, height = 84, gap = 10, children }: { count: number; min?: number; height?: number; gap?: number; children?: (index: number) => ReactNode }) {
  return (
    <div className="sk-card-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap }} aria-hidden>
      {Array.from({ length: count }, (_, i) => <div key={i} className="sk-card" style={{ height }}>{children ? children(i) : <SkeletonBlock w="100%" h="100%" r={0} />}</div>)}
    </div>
  );
}

/** True under `prefers-reduced-motion: reduce`; the shimmer stays off then. */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
}

/**
 * The wrapper every loading state sits in: `aria-busy`, one visually hidden "Loading ..." status, and the placeholders
 * themselves hidden from assistive tech. They paint only after `delay` ms, so a fast load never flashes a skeleton.
 */
export function SkeletonRegion({ label, children, className = "", delay }: { label: string; children?: ReactNode; className?: string; delay?: number }) {
  const shown = useDelayedShow(true, delay, 0);
  const still = usePrefersReducedMotion();
  return (
    <div className={`sk-region${still ? " sk-still" : ""} ${className}`.trim()} aria-busy="true" data-skeleton={shown ? "shown" : "waiting"}>
      <span className="sr-only" role="status">{label}</span>
      {shown && children}
    </div>
  );
}
