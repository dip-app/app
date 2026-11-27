// @i18n-migrated

import Link from "next/link";
import type { ReactNode } from "react";

export interface BackLink { href: string; /** The list it goes back to ("Events"). */ label: string }

/**
 * The page's title row: an optional back link above the title ("‹ Events"), one h1, a muted description or a `meta`
 * line of facts (dates, counts, status), and at most one compact group of actions on the right. Shell renders it for
 * every page. On a detail page the h1 is the object's name ("Puppy Yoga"), never the kind of page ("Attendees").
 */
export function PageHeader({ title, description, actions, back, meta, eyebrow }: {
  title: string; description?: string; actions?: ReactNode; back?: BackLink; meta?: ReactNode;
  /** What this page is about the object ("Attendees"), shown before the title on detail pages. */
  eyebrow?: string;
}) {
  return (
    <header className={`page-header${back ? " has-back" : ""}`}>
      <div className="titles">
        {back && (
          <Link href={back.href} className="back-link">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {back.label}
          </Link>
        )}
        <h1 className="page-title">{eyebrow && <span className="page-eyebrow">{eyebrow}<span className="sr-only">: </span></span>}{title}</h1>
        {description && <p className="subtitle">{description}</p>}
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {actions && <div className="header-action">{actions}</div>}
    </header>
  );
}
