"use client";

import type { ApiError } from "@/lib/contract";

export function LoadError({ error, onRetry, backHref, backLabel }: { error: ApiError; onRetry: () => void; backHref?: string; backLabel?: string }) {
  // Retrying a missing item never helps: offer the way back instead.
  const missing = error.code === "not-found" && backHref;
  return (
    <div className="banner error" role="alert">
      <span>{error.message}</span>
      {missing ? <a className="pill-btn" href={backHref}>{backLabel ?? "Go back"}</a> : <button className="pill-btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return <div className="skeleton-list" role="status" aria-label={label}><div className="skeleton short" /><div className="skeleton short" /><div className="skeleton short" /></div>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  return (
    <div className="field search">
      <label htmlFor="search" className="sr-only">{label}</label>
      <input id="search" type="search" value={value} placeholder={placeholder ?? label} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
    </div>
  );
}

/** Informational pill: outline only, never pressable. */
export function Info({ children, tone }: { children: React.ReactNode; tone?: "warn" | "ok" }) {
  return <span className={`info-pill${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="notice" role="status">{children}</p>;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden>{initials(name)}</span>;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
