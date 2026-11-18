import type { ReactNode } from "react";

export type SegmentedVariant = "tabs" | "pill" | "icon";
export interface SegmentOption<T extends string> {
  value: T;
  /** Visible text (tabs, pill) or the accessible name and tooltip (icon). */
  label: string;
  /** Icon variant: the SVG path data, drawn in an 18 px outline icon. */
  iconPath?: string;
  /** Extra content after the label. */
  suffix?: ReactNode;
}

const WRAP: Record<SegmentedVariant, string> = { tabs: "tabs", pill: "segmented", icon: "view-toggle" };
const ITEM: Record<SegmentedVariant, string> = { tabs: "tab", pill: "seg", icon: "view-toggle-btn" };

/**
 * One choice out of a few, always visible, switching at once. `tabs` is the underlined switch for views of the same
 * data, `pill` the compact filled switch (AM/PM), `icon` an icon-only switch (grid or list). A labelled group of
 * `aria-pressed` buttons; for switching whole pages of content use Tabs, which is a real tablist.
 */
export function SegmentedControl<T extends string>({ label, value, onChange, options, variant = "tabs", disabled = false, className }: {
  label: string; value: T; onChange: (next: T) => void; options: SegmentOption<T>[]; variant?: SegmentedVariant; disabled?: boolean; className?: string;
}) {
  return (
    <div className={`${WRAP[variant]}${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={ITEM[variant]} disabled={disabled} aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          {...(variant === "icon" ? { "aria-label": o.label, title: o.label } : {})}>
          {variant === "icon" && o.iconPath
            ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={o.iconPath} /></svg>
            : o.label}
          {o.suffix}
        </button>
      ))}
    </div>
  );
}
