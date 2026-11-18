"use client";

import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref, forwardRef, useId } from "react";
import { creditCostLabel } from "@/lib/credits";
import { DipbotMark } from "./DipbotMark";

export type DipbotActionVariant = "outline" | "solid" | "ghost" | "link";
export type DipbotActionSize = "sm" | "md";

/**
 * The cost of a Dipbot action as muted text: "1 credit", "10 credits". `divider` puts the thin vertical rule in front of
 * it (the way it sits inside DipbotAction). 0 credits renders nothing unless `showFree` ("Free"). Use it on its own where
 * only the price is shown (a heading, a hint); use DipbotAction for anything that can be pressed.
 */
export function CreditCost({ credits, divider = false, showFree = false, className }: { credits: number; divider?: boolean; showFree?: boolean; className?: string }) {
  const text = creditCostLabel(credits, showFree);
  if (!text) return null;
  return <span className={`credit-cost${divider ? " has-divider" : ""}${className ? ` ${className}` : ""}`}>{text}</span>;
}

interface Common {
  /** The action, without its price: "Let Dipbot choose". */
  label: ReactNode;
  /** Plain-text name for assistive tech and tooltips when `label` is not a string, or a fuller name than the visible one. */
  accessibleLabel?: string;
  /** What it costs in credits. Omit for an action that is free and says nothing; 0 is the same unless `showFree`. */
  credits?: number;
  showFree?: boolean;
  variant?: DipbotActionVariant;
  size?: DipbotActionSize;
  /** Pending: a spinner replaces the mark, aria-busy is set, presses are ignored, the width stays. */
  loading?: boolean;
  /** Visible text while loading ("Dipbot is choosing…"). Defaults to the label so the width does not jump. */
  loadingLabel?: string;
  /** Why it is unavailable ("Not enough credits"): shown as a tooltip and read by screen readers. */
  disabledReason?: string;
  /** Replaces the Dipbot mark. `null` shows no icon. */
  icon?: ReactNode | null;
  /** Show only the icon (the full name and cost stay in the accessible name). `narrow` does it on phones only. */
  iconOnly?: boolean | "narrow";
  /** On phones, show this shorter text instead of the label and hide the cost ("Suggest"). */
  shortLabel?: string;
  className?: string;
}
type ButtonProps = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & { href?: undefined };
type LinkProps = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className"> & { href: string; disabled?: boolean };
export type DipbotActionProps = ButtonProps | LinkProps;

/**
 * The one component for anything that asks Dipbot to do something, with its credit cost as structured data:
 * `[mark] Label | 1 credit`. Variants: `outline` (default, secondary actions), `solid` (the main call to action),
 * `ghost` and `link` (quiet and inline). The accessible name is "Label, 1 credit". Give `href` to render a link.
 */
export const DipbotAction = forwardRef<HTMLButtonElement | HTMLAnchorElement, DipbotActionProps>(function DipbotAction(props, ref) {
  const {
    label, accessibleLabel, credits, showFree = false, variant = "outline", size = "md", loading = false, loadingLabel, disabledReason,
    icon, iconOnly = false, shortLabel, className, ...rest
  } = props;
  const reasonId = useId();
  const disabled = Boolean((rest as { disabled?: boolean }).disabled);
  const base = loading && loadingLabel ? loadingLabel : accessibleLabel ?? (typeof label === "string" ? label : "");
  const costText = credits === undefined ? "" : creditCostLabel(credits, showFree);
  const name = costText ? `${base}, ${costText}` : base;
  const shown = loading && loadingLabel ? loadingLabel : label;
  const mark = icon === undefined ? <DipbotMark size={size === "sm" ? 14 : 16} /> : icon;
  const reason = disabled && disabledReason ? disabledReason : undefined;
  const body = (
    <>
      {(loading || mark) && <span className="dip-action-icon" aria-hidden>{loading ? <span className="dip-action-spin" /> : mark}</span>}
      <span className="dip-action-label" aria-hidden={name ? true : undefined}>{shown}</span>
      {shortLabel && <span className="dip-action-short" aria-hidden>{shortLabel}</span>}
      {costText && <span className="dip-action-cost" aria-hidden><CreditCost credits={credits ?? 0} showFree={showFree} divider /></span>}
      {reason && <span id={reasonId} className="sr-only">{reason}</span>}
    </>
  );
  const common = {
    className: `dip-action${className ? ` ${className}` : ""}`,
    "aria-label": name || undefined, "aria-busy": loading || undefined, "aria-describedby": [(rest as { "aria-describedby"?: string })["aria-describedby"], reason ? reasonId : undefined].filter(Boolean).join(" ") || undefined, title: reason ?? (name || undefined),
    "data-variant": variant, "data-size": size, "data-icon-only": iconOnly === true ? "true" : iconOnly === "narrow" ? "narrow" : undefined,
    "data-loading": loading || undefined, "data-short": shortLabel ? "true" : undefined,
  };

  if (props.href !== undefined) {
    const { href, onClick, disabled: _disabled, ...anchor } = rest as LinkProps;
    void _disabled;
    const blocked = disabled || loading;
    return (
      <a ref={ref as Ref<HTMLAnchorElement>} {...anchor} {...common} href={blocked ? undefined : href} role={blocked ? "link" : undefined}
        aria-disabled={blocked || undefined} onClick={(e: MouseEvent<HTMLAnchorElement>) => { if (blocked) e.preventDefault(); else onClick?.(e); }}>
        {body}
      </a>
    );
  }
  const { onClick, type = "button", ...button } = rest as ButtonProps;
  return (
    <button ref={ref as Ref<HTMLButtonElement>} {...button} {...common} type={type} onClick={(e) => { if (loading) { e.preventDefault(); return; } onClick?.(e); }}>
      {body}
    </button>
  );
});
