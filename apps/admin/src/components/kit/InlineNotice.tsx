import type { ReactNode } from "react";

export type NoticeTone = "info" | "success" | "warn" | "error";

/**
 * A message in the page flow. `error` is an alert banner (tinted pink, announced at once) with an optional `action`
 * (Try again); the others are quiet status notices. Use it instead of `<div className="banner error">` or
 * `<p className="notice">`. Toasts are for the result of an action; this is for state that stays on the page.
 */
export function InlineNotice({ tone = "info", action, className, children, ...aria }: { tone?: NoticeTone; action?: ReactNode; className?: string; children: ReactNode; id?: string; "aria-live"?: "polite" | "assertive" }) {
  if (tone === "error") {
    return (
      <div className={`banner error${className ? ` ${className}` : ""}`} role="alert" {...aria}>
        <span>{children}</span>
        {action}
      </div>
    );
  }
  const extra = tone === "success" ? " success" : tone === "warn" ? " warn" : "";
  return (
    <div className={`notice${extra}${className ? ` ${className}` : ""}`} role="status" {...aria}>
      {children}
      {action}
    </div>
  );
}
