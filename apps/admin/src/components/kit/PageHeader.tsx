// @i18n-migrated

import Link from "next/link";
import type { ReactNode } from "react";
import { HeaderMore } from "./HeaderMore";

export interface BackLink { href: string; /** The list it goes back to ("Events"). */ label: string }

/**
 * The page's title row: an optional back link above the title ("‹ Events"), one h1, a muted description or a `meta`
 * line of facts (dates, counts, status), and at most one compact group of actions on the right. Shell renders it for
 * every page. On a detail page the h1 is the object's name ("Puppy Yoga"), never the kind of page ("Attendees").
 *
 * List pages pass `dense`: on phones the title and the actions share one row and the description is left out, so the
 * list starts near the top. Secondary actions go in `more` (outline buttons): inline before `actions` on wide screens,
 * folded behind one "More actions" button on phones.
 */
export function PageHeader({ title, description, actions, back, meta, eyebrow, more, dense }: {
  title: string; description?: string; actions?: ReactNode; back?: BackLink; meta?: ReactNode;
  /** What this page is about the object ("Attendees"), shown before the title on detail pages. */
  eyebrow?: string;
  /** Secondary actions (Export CSV, Import people). */
  more?: ReactNode;
  /** A list page: one header row on phones, no description there. */
  dense?: boolean;
}) {
  return (
    <header className={`page-header${back ? " has-back" : ""}${dense ? " dense" : ""}`}>
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
      {(actions || more) && <div className="header-action">{more && <HeaderMore>{more}</HeaderMore>}{actions}</div>}
    </header>
  );
}
