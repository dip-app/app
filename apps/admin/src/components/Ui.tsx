"use client";

import { useId } from "react";
import type { ApiError } from "@/lib/contract";

export function LoadError({ error, onRetry, backHref, backLabel }: { error: ApiError; onRetry: () => void; backHref?: string; backLabel?: string }) {
  // Retrying a missing item never helps: offer the way back instead.
  const missing = error.code === "not-found" && backHref;
  return (
    <div className="banner error" role="alert">
      <span>{error.message}</span>
      {missing ? <a className="pill-btn" href={backHref}>{backLabel ?? "Go back"}</a> : <button type="button" className="pill-btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="skeleton-list" role="status">
      <span className="sr-only">{label}</span>
      <div className="skeleton short" aria-hidden /><div className="skeleton short" aria-hidden /><div className="skeleton short" aria-hidden />
    </div>
  );
}

/** "Showing 25 of 140": announced politely when it changes. */
export function ResultCount({ children }: { children: React.ReactNode }) {
  return <p className="result-count" role="status" aria-live="polite">{children}</p>;
}

/** Pager button for server-paged lists. The count stays in a polite live region so the new total is announced. */
export function LoadMore({ shown, total, loading, onClick, label = "Load more" }: { shown: number; total?: number; loading: boolean; onClick: () => void; label?: string }) {
  return (
    <div className="load-more">
      <button type="button" className="pill-btn gray small" disabled={loading} onClick={onClick}>{loading ? "Loading more…" : label}</button>
      <span className="muted" role="status" aria-live="polite">{total !== undefined ? `Showing ${shown} of ${total}` : `Showing ${shown}`}</span>
    </div>
  );
}

export function Empty({ title, body, action, art }: { title: string; body: string; action?: React.ReactNode; /** Optional decorative illustration URL. */ art?: string }) {
  return (
    <div className="empty">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images */}
      {art && <img className="empty-art" src={art} alt="" width={120} height={90} />}
      <h2>{title}</h2>
      <p>{body}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

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

/** Informational pill: outline only, never pressable. */
export function Info({ children, tone }: { children: React.ReactNode; tone?: "warn" | "ok" }) {
  return <span className={`info-pill${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "success" }) {
  return <p className={`notice${tone === "success" ? " success" : ""}`} role="status">{children}</p>;
}

export { Avatar, initials } from "./Avatar";

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
