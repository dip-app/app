// @i18n-migrated

import type { ReactNode, Ref } from "react";
import { t } from "@/lib/i18n";
import { type UserErrorOptions, userError } from "@/lib/userError";
import { Button } from "./Button";

export type NoticeTone = "info" | "success" | "warn" | "error";

/** The error mark: a circle with an exclamation point. Decorative; the words carry the meaning. */
export function ErrorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="alert-icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden focusable="false" fill="none">
      <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.6v4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.95" fill="currentColor" />
    </svg>
  );
}

interface NoticeProps {
  tone?: NoticeTone;
  /** Error only: a short bold heading ("Couldn’t save"). Use it on page load and form save failures, not elsewhere. */
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  id?: string;
  "aria-live"?: "polite" | "assertive";
  /**
   * Error only. `false` drops role="alert" for an alert that receives focus instead (a form's save failure): focus
   * already announces it, and a live role would read it twice.
   */
  announce?: boolean;
  /** Error only: lets a form move focus to the alert (it gets tabIndex -1). */
  ref?: Ref<HTMLDivElement>;
}

/**
 * A message in the page flow. `error` is the portal's one error alert: a soft pink box, dark red text, the error
 * icon, an optional title and an action (Try again). The others are quiet status notices. Use it instead of
 * `<div className="banner error">` or `<p className="notice">`. Toasts are for the result of an action; this is
 * for state that stays on the page. Pass text through `userError()` (or use `ErrorNotice`) so no code leaks.
 */
export function InlineNotice({ tone = "info", title, action, className, children, announce = true, ref, ...aria }: NoticeProps) {
  if (tone === "error") {
    return (
      <div ref={ref} tabIndex={ref ? -1 : undefined} className={`banner error${className ? ` ${className}` : ""}`} role={announce ? "alert" : undefined} {...aria}>
        <div className="alert-body">
          <ErrorIcon />
          <div className="alert-main">
            {title && <strong className="alert-title">{title}</strong>}
            <div className="alert-text">{children}</div>
          </div>
        </div>
        {action && <div className="alert-actions">{action}</div>}
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

/**
 * An error alert for anything thrown. The copy comes from `userError()`: plain language, never a status code or a
 * reason key. "Try again" shows when `onRetry` is given and retrying can help; a signed-out session offers Sign in.
 */
export function ErrorNotice({ error, onRetry, retryLabel, action, title, fallback, notFound, className, announce, ref }: {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  /** Replaces the automatic Try again / Sign in action. */
  action?: ReactNode;
  title?: string;
  className?: string;
  announce?: boolean;
  ref?: Ref<HTMLDivElement>;
} & Pick<UserErrorOptions, "fallback" | "notFound">) {
  const shown = userError(error, { fallback, notFound });
  const auto = shown.kind === "signedOut"
    ? <Button variant="plain" href="/login/">{t("failure.signIn")}</Button>
    : onRetry && shown.retryable ? <Button variant="plain" onClick={onRetry}>{retryLabel ?? t("common.tryAgain")}</Button> : null;
  return (
    <InlineNotice tone="error" title={title} action={action ?? auto} className={className} announce={announce} ref={ref}>
      {shown.message}
    </InlineNotice>
  );
}
