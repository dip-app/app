"use client";
// @i18n-migrated

import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { useQueryState } from "@/lib/useQueryState";

export type SortDir = "asc" | "desc";
export interface TableSort<K extends string> { key: K; dir: SortDir; toggle: (key: K) => void; set: (key: K, dir: SortDir) => void }

const STORE = "dip.admin.sort.";
function readStored(list: string): string | null {
  try { return window.localStorage.getItem(STORE + list); } catch { return null; }
}
function writeStored(list: string, value: string) {
  try { window.localStorage.setItem(STORE + list, value); } catch { /* private mode: the URL still keeps it */ }
}

/**
 * Column sort for a list that is fully loaded in the browser. The sort lives in the URL (`?sort=when&dir=desc`) so a
 * reload, back and a shared link keep it, and the last choice per list is remembered in this browser for the next
 * visit. `first` gives each column's first direction (dates newest first, names A to Z). Do not use it on a list the
 * server pages (Members, Roster): sorting a partial list looks complete and is not.
 */
export function useTableSort<K extends string>(list: string, keys: readonly K[], fallback: { key: K; dir: SortDir }, first: Partial<Record<K, SortDir>> = {}): TableSort<K> {
  const [qs, setQs] = useQueryState({ sort: "", dir: "" });
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => { setStored(readStored(list)); }, [list]);
  const parse = (value: string | null): { key: K; dir: SortDir } | null => {
    if (!value) return null;
    const [key, dir] = value.split(":");
    return (keys as readonly string[]).includes(key) && (dir === "asc" || dir === "desc") ? { key: key as K, dir } : null;
  };
  const fromUrl = parse(qs.sort ? `${qs.sort}:${qs.dir || first[qs.sort as K] || "asc"}` : null);
  const current = fromUrl ?? parse(stored) ?? fallback;
  const set = useCallback((key: K, dir: SortDir) => {
    const isFallback = key === fallback.key && dir === fallback.dir;
    setQs(isFallback ? { sort: "", dir: "" } : { sort: key, dir });
    writeStored(list, `${key}:${dir}`);
    setStored(`${key}:${dir}`);
  }, [list, setQs, fallback.key, fallback.dir]);
  const toggle = useCallback((key: K) => {
    set(key, key === current.key ? (current.dir === "asc" ? "desc" : "asc") : (first[key] ?? "asc"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key, current.dir, set]);
  return useMemo(() => ({ key: current.key, dir: current.dir, toggle, set }), [current.key, current.dir, toggle, set]);
}

/** Sorts a copy of `rows` by `value` (numbers, dates as numbers, or text compared in the active language). */
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number | null | undefined, dir: SortDir): T[] {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    // Empty values go last in either direction.
    if (x === null || x === undefined || x === "") return y === null || y === undefined || y === "" ? 0 : 1;
    if (y === null || y === undefined || y === "") return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return c * sign;
  });
}

/**
 * A sortable column header: a `th` with `aria-sort` and a button that sorts by this column (again to reverse). The
 * arrow shows the direction on the sorted column and a faint pair on the others.
 */
export function SortHeader<K extends string>({ column, sort, children, align, className }: { column: K; sort: TableSort<K>; children: string; align?: "right"; className?: string }) {
  const active = sort.key === column;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th scope="col" aria-sort={ariaSort} className={`sortable${align === "right" ? " num" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="sort-btn" data-active={active || undefined} onClick={() => sort.toggle(column)}
        title={active ? t(sort.dir === "asc" ? "ui.sort.reverseDesc" : "ui.sort.reverseAsc") : t("ui.sort.by", { column: children })}>
        <span>{children}</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden focusable="false" className="sort-icon">
          {active
            ? <path d={sort.dir === "asc" ? "M6 2.5 9.5 7h-7z" : "M6 9.5 2.5 5h7z"} fill="currentColor" />
            : <path d="M6 1.5 8.8 5H3.2zM6 10.5 3.2 7h5.6z" fill="currentColor" />}
        </svg>
      </button>
    </th>
  );
}

/**
 * The same sort as a labelled select, for phones where the table is a list of cards and has no headers to press.
 * Shown only at phone width (CSS); `options` name each order in words ("Most going").
 */
export function SortSelect<K extends string>({ id, sort, options }: { id: string; sort: TableSort<K>; options: { key: K; dir: SortDir; label: string }[] }) {
  const value = `${sort.key}:${sort.dir}`;
  return (
    <div className="field sort-select">
      <label htmlFor={id}>{t("ui.sort.label")}</label>
      <select id={id} value={options.some((o) => `${o.key}:${o.dir}` === value) ? value : ""} onChange={(e) => { const [key, dir] = e.target.value.split(":"); sort.set(key as K, dir as SortDir); }}>
        {!options.some((o) => `${o.key}:${o.dir}` === value) && <option value="" disabled>{t("ui.sort.custom")}</option>}
        {options.map((o) => <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>{o.label}</option>)}
      </select>
    </div>
  );
}
