import type { ReactNode } from "react";

export type ChipTone = "ok" | "warn";

/**
 * Informational chip: an outline label that is never pressable (a status, a count, a category). `ok` is the calm green
 * state ("Active"), `warn` the attention state ("Invited", "Revoked"). Anything pressable is a ChipToggle or a Button.
 */
export function Chip({ children, tone, full = false, className }: { children: ReactNode; tone?: ChipTone; /** The brighter "this one is full" outline used on cards. */ full?: boolean; className?: string }) {
  return <span className={`info-pill${tone ? ` ${tone}` : ""}${full ? " full" : ""}${className ? ` ${className}` : ""}`}>{children}</span>;
}

/**
 * Filter or choice chip: pressable, `aria-pressed`, purple with white text when on. `count` is the small muted number
 * after the label; `icon` goes before it.
 */
export function ChipToggle({ pressed, onClick, count, countTitle, icon, className, children, ...rest }: {
  pressed: boolean; onClick: () => void; count?: number | string; countTitle?: string; icon?: ReactNode; className?: string; children: ReactNode;
  disabled?: boolean; title?: string; "aria-describedby"?: string; "aria-label"?: string;
}) {
  return (
    <button type="button" className={`chip${className ? ` ${className}` : ""}`} aria-pressed={pressed} onClick={onClick} {...rest}>
      {icon}{children}
      {count !== undefined && <span className="chip-count" title={countTitle} aria-hidden>{count}</span>}
    </button>
  );
}
