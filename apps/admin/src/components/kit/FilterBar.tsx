"use client";

// @i18n-migrated

import { useId, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Button } from "./Button";

/**
 * A list's search and filters in one row. Wide screens show every field; phones (700 px and below) show the search and
 * one "Filters" button with the number of filters set, and the fields fold out under them in two columns. "Clear
 * filters" is always the last cell of the row, never a row of its own. Pass the fields (`.field` blocks with a label) as
 * children and `onClear` only while something is set.
 */
export function FilterBar({ search, children, active = 0, onClear, clearLabel, toggleLabel, className, invalid }: {
  /** The list's `SearchBox`. */
  search: ReactNode;
  /** The filter fields. Without any, the bar is the search alone. */
  children?: ReactNode;
  /** How many filters (not the search) are set: the badge on the phone toggle. */
  active?: number;
  /** Shown as the last cell while a filter or the search is set. */
  onClear?: () => void;
  /** "Clear filters" by default; "Clear search" when only the search is set is the caller's choice. */
  clearLabel?: string;
  /** The phone toggle's label ("Filters" by default, "Sort" on a list that only sorts). */
  toggleLabel?: string;
  className?: string;
  /** A field is invalid: the fields stay open on phones so the message is seen. */
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const hasFields = children !== undefined && children !== null && children !== false;
  const shown = open || invalid === true;
  return (
    <div className={`filters filter-bar${hasFields ? "" : " search-only"}${className ? ` ${className}` : ""}`} data-open={shown || undefined}>
      {search}
      {hasFields && (
        <Button className="filters-toggle" aria-expanded={shown} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          <span>{toggleLabel ?? t("ui.filters.toggle")}</span>
          {active > 0 && <span className="filter-count" aria-hidden>{active}</span>}
          {active > 0 && <span className="sr-only">, {t("ui.filters.active", { count: active })}</span>}
        </Button>
      )}
      {(hasFields || onClear) && (
        <div className="filter-fields" id={id} role={hasFields ? "group" : undefined} aria-label={hasFields ? toggleLabel ?? t("ui.filters.group") : undefined}>
          {children}
          {onClear && <div className="filters-clear"><Button onClick={onClear}>{clearLabel ?? t("ui.filters.clear")}</Button></div>}
        </div>
      )}
    </div>
  );
}
