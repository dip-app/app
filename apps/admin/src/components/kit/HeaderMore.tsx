"use client";

// @i18n-migrated

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Button } from "./Button";

/**
 * A page header's secondary actions. Wide screens show them inline (the wrapper is `display: contents`); phones fold
 * them behind one "More actions" button that opens a small panel under it. Escape, a press outside or choosing an
 * action closes it; Escape returns focus to the button.
 */
export function HeaderMore({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="header-more" ref={wrap} data-open={open || undefined}>
      <Button ref={toggle} className="header-more-toggle" aria-expanded={open} aria-controls={id} aria-label={t("ui.header.moreLabel")} title={t("ui.header.moreLabel")} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </Button>
      <div className="header-more-items" id={id} onClick={(event) => { if ((event.target as HTMLElement).closest("button, a")) setOpen(false); }}>{children}</div>
    </div>
  );
}
