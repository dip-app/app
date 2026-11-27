"use client";
// @i18n-migrated

import { useId } from "react";
import type { ApiError } from "@/lib/contract";
import { formatDate as formatDateIn, formatTime, t } from "@/lib/i18n";
import { userError } from "@/lib/userError";
import { Button, Chip, InlineNotice } from "./kit";
import { PageSkeleton, type SkeletonLayout } from "./PageSkeletons";

/** A page or section that could not load: the error alert with a title, and Try again (or Go back when it is gone). */
export function LoadError({ error, onRetry, backHref, backLabel }: { error: ApiError; onRetry: () => void; backHref?: string; backLabel?: string }) {
  // Retrying a missing item never helps: offer the way back instead.
  const missing = error.code === "not-found" && backHref;
  const shown = userError(error);
  const action = missing
    ? <Button variant="plain" href={backHref}>{backLabel ?? t("common.goBack")}</Button>
    : shown.kind === "signedOut" ? <Button variant="plain" href="/login/">{t("failure.signIn")}</Button>
      : <Button variant="plain" onClick={onRetry}>{t("common.tryAgain")}</Button>;
  // The title says what failed when the message is generic ("Can’t reach DIP…"); a page's own sentence already does.
  return <InlineNotice tone="error" title={shown.generic ? t("failure.title.load") : undefined} action={action}>{shown.message}</InlineNotice>;
}

/**
 * A page's loading state. `layout` picks a skeleton that mirrors that page (see PageSkeletons.tsx); without one it is a
 * short generic list. Either way: `aria-busy`, one screen reader status, and no paint for the first 150 ms.
 */
export function Loading({ label, layout }: { label: string; layout?: SkeletonLayout }) {
  return <PageSkeleton layout={layout} label={label} />;
}

/** "Showing 25 of 140": announced politely when it changes. */
export function ResultCount({ children }: { children: React.ReactNode }) {
  return <p className="result-count" role="status" aria-live="polite">{children}</p>;
}

/** Pager button for server-paged lists. The count stays in a polite live region so the new total is announced. */
export function LoadMore({ shown, total, loading, onClick, label = t("common.loadMore") }: { shown: number; total?: number; loading: boolean; onClick: () => void; label?: string }) {
  return (
    <div className="load-more">
      {/* Loading: a spinner over the label (same width), and focus stays on the button for the next press. */}
      <Button size="sm" loading={loading} aria-label={loading ? t("common.loadingMore") : undefined} onClick={onClick}>{label}</Button>
      <span className="muted" role="status" aria-live="polite">{total !== undefined ? t("common.showingOf", { shown, total }) : t("common.showing", { shown })}</span>
    </div>
  );
}

/** The shared empty state (components/kit/EmptyState). */
export { EmptyState as Empty } from "./kit";

export function SearchBox({ value, onChange, label, placeholder, id }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; id?: string }) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className="field search">
      <label htmlFor={inputId} className="sr-only">{label}</label>
      <input id={inputId} type="search" value={value} placeholder={placeholder ?? label} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
    </div>
  );
}

/** Informational chip (components/kit/Chip): outline only, never pressable. */
export const Info = Chip;

export { Avatar, initials } from "./Avatar";

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatDateIn(d, { month: "short", day: "numeric", year: "numeric" });
}
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${formatDateIn(d, { month: "short", day: "numeric" })}, ${formatTime(d, { hour: "numeric", minute: "2-digit" })}`;
}
