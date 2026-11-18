// @i18n-migrated

/**
 * Scrollable table container. A named region with a tab stop lets keyboard users scroll a wide table
 * (WCAG 2.1.1, axe "scrollable-region-focusable"); `busy` marks the rows as refreshing without clearing them.
 */
export function TableRegion({ label, busy, children }: { label: string; busy?: boolean; children: React.ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0} aria-busy={busy ? true : undefined}>
      {children}
    </div>
  );
}
