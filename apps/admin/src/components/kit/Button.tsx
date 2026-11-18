"use client";

// @i18n-migrated

import Link from "next/link";
import type { ComponentPropsWithRef, ReactNode } from "react";

export type ButtonVariant = "primary" | "outline" | "danger" | "plain";
export type ButtonSize = "md" | "sm";

// One variant name per look. The class names are the portal's existing .pill-btn modifiers, so the CSS stays in one place
// (pro.scss). "dark" used to be a second spelling of primary.
const VARIANT_CLASS: Record<ButtonVariant, string> = { primary: " purple", outline: " gray", danger: " danger", plain: "" };

interface Common {
  /** primary: the one main action; outline: every other action; danger: destructive (outlined, solid only in its confirm dialog); plain: inherits context (inside a banner). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pending: aria-busy, presses are ignored, the button keeps its width and place. */
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}
type ButtonProps = Common & Omit<ComponentPropsWithRef<"button">, "className" | "children"> & { href?: undefined };
type LinkProps = Common & Omit<ComponentPropsWithRef<"a">, "className" | "children" | "href"> & { href: string };
export type { ButtonProps, LinkProps };

/**
 * The portal's button. Use it for every pressable action instead of writing `<button className="pill-btn ...">`.
 * Give `href` to get a link that looks the same (internal route, base path handled). `type` defaults to "button".
 */
export function Button(props: ButtonProps | LinkProps) {
  const { variant = "outline", size = "md", loading = false, className, children, ...rest } = props;
  const cls = `pill-btn${VARIANT_CLASS[variant]}${size === "sm" ? " small" : ""}${className ? ` ${className}` : ""}`;
  if (props.href !== undefined) {
    const { href, ...anchor } = rest as LinkProps;
    return <Link {...anchor} href={href} className={cls} aria-busy={loading || undefined}>{children}</Link>;
  }
  const { type = "button", onClick, ...button } = rest as ButtonProps;
  return (
    <button {...button} type={type} className={cls} aria-busy={loading || undefined} onClick={(e) => { if (loading) { e.preventDefault(); return; } onClick?.(e); }}>
      {children}
    </button>
  );
}
