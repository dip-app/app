"use client";

// @i18n-migrated

import { useId, useRef } from "react";
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

/** Tab list with roving tabindex: Left/Right move (and select), Home/End jump. Reuses the `.tabs` / `.tab` look. */
export function Tabs({ label, items, value, onChange, idBase }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const generated = useId();
  const base = idBase ?? generated;
  const current = items.some((item) => item.id === value) ? value : items[0]?.id;

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
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
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
