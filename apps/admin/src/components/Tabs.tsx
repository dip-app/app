"use client";

// @i18n-migrated

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { t } from "@/lib/i18n";

export interface TabItem { id: string; label: string; count?: number | string }

/** Props for the panel that a tab set controls (`id` and `aria-labelledby` point at the selected tab). */
export function tabPanelProps(idBase: string, selected: string) {
  return { role: "tabpanel" as const, id: `${idBase}-panel`, "aria-labelledby": `${idBase}-tab-${selected}` };
}

interface Props {
  label: string;
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Gives each tab an id and `aria-controls` for a panel built with `tabPanelProps(idBase, value)`. */
  idBase?: string;
}

/** Width of the edge fade (px, matches `.tabs[data-more-*]` in structure.scss): a selected tab is scrolled clear of it. */
const FADE = 40;

/** Tab list with roving tabindex: Left/Right move (and select), Home/End jump. Reuses the `.tabs` / `.tab` look. */
export function Tabs({ label, items, value, onChange, idBase }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const generated = useId();
  const base = idBase ?? generated;
  const current = items.some((item) => item.id === value) ? value : items[0]?.id;
  const list = useRef<HTMLDivElement>(null);
  const shape = items.map((item) => `${item.id}:${item.label}:${item.count ?? ""}`).join("|");

  // Which ends have more tabs past the edge: the row fades out on that side (CSS mask), so a cut-off tab reads as "more
  // this way" rather than clipped. Measured on scroll, on resize and when the labels change.
  const [overflow, setOverflow] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  const measure = useCallback(() => {
    const row = list.current;
    if (!row) return;
    const start = row.scrollLeft > 1;
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setOverflow((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
  }, []);
  useEffect(() => {
    const row = list.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  // A row wider than the screen scrolls sideways: keep the selected tab in view (on load, from a link, after a change),
  // clear of the edge fade. Only the tab row scrolls, never the page.
  useEffect(() => {
    const row = list.current;
    const tab = current ? refs.current[current] : null;
    if (row && tab && row.scrollWidth > row.clientWidth) {
      const r = tab.getBoundingClientRect();
      const c = row.getBoundingClientRect();
      if (r.left < c.left + FADE) row.scrollLeft -= c.left + FADE - r.left;
      else if (r.right > c.right - FADE) row.scrollLeft += r.right - (c.right - FADE);
    }
    measure();
    // Counts arrive after the first paint and widen the row: check again when the labels change.
  }, [current, shape, measure]);

  function move(to: string) {
    onChange(to);
    const button = refs.current[to];
    button?.focus();
    button?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const at = items.findIndex((item) => item.id === current);
    let next = -1;
    if (event.key === "ArrowRight") next = (at + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    move(items[next].id);
  }

  return (
    <div ref={list} className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown} onScroll={measure}
      data-more-start={overflow.start || undefined} data-more-end={overflow.end || undefined}>
      {items.map((item) => {
        const selected = item.id === current;
        return (
          <button
            key={item.id}
            ref={(node) => { refs.current[item.id] = node; }}
            type="button"
            role="tab"
            id={`${base}-tab-${item.id}`}
            className="tab"
            aria-selected={selected}
            aria-controls={idBase ? `${idBase}-panel` : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => move(item.id)}
          >
            {item.count !== undefined ? t("common.tabCount", { label: item.label, count: item.count }) : item.label}
          </button>
        );
      })}
    </div>
  );
}
