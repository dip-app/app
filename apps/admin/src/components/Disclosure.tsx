"use client";

// @i18n-migrated

import { useId, useState, type ReactNode } from "react";
import { Chevron } from "./Chevron";

/** The portal's one show/hide disclosure (replaces native details/summary): a 44px button row with a chevron that turns when open. */
export function Disclosure({ summary, children, defaultOpen = false, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`disclosure${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Chevron className="disclosure-chevron" />
        <span>{summary}</span>
      </button>
      <div id={id} className="disclosure-panel" hidden={!open}>{children}</div>
    </div>
  );
}
