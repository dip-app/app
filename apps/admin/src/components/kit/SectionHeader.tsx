// @i18n-migrated

import type { ReactNode } from "react";
import { Chevron } from "../Chevron";
import { DipbotMark } from "../DipbotMark";

export interface SectionToggle {
  collapsed: boolean;
  /** id of the region the toggle shows and hides. */
  controls: string;
  /** Accessible name and tooltip, for example "Collapse ideas" or "Expand ideas". */
  label: string;
  onToggle: () => void;
}

/**
 * The header row of a Dipbot section: [Dipbot mark] **Title**  muted "Updated 3 hours ago"  [collapse toggle]  ... [actions].
 * Shared by "Ideas for you" and the wizard's per-step suggestions, so they look the same. The toggle is optional
 * (leave `toggle` out for a section that is not collapsible). `end` holds the actions; `hint` is a muted line before them; `staleHint` is a short inline note beside `updated`, shown only when stale.
 * Narrow containers wrap the actions under the title. The wrapper is a size container named `sh`.
 */
export function SectionHeader({ id, title, headingLevel = 2, updated, staleHint, toggle, hint, end, stackActions = false, className }: {
  /** Names the heading (for `aria-labelledby` on the section). */
  id?: string;
  title: ReactNode;
  headingLevel?: 2 | 3;
  /** The muted "Updated ..." text, or any short status node. */
  updated?: ReactNode;
  /** Compact inline hint after `updated`, only when the saved answer is stale ("New data available"). Leave out when fresh. */
  staleHint?: ReactNode;
  toggle?: SectionToggle;
  hint?: ReactNode;
  end?: ReactNode;
  /** Narrow containers: put the actions on their own row under the title (for two or more buttons). */
  stackActions?: boolean;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3";
  return (
    <div className={`sh${stackActions ? " sh--stack" : ""}${className ? ` ${className}` : ""}`}>
      <div className="sh-head">
        <DipbotMark size={16} className="sh-mark" />
        <Heading id={id}>{title}</Heading>
        {(updated || staleHint) && (
          <span className="sh-when">
            {updated}
            {staleHint && <span className="sh-stale" data-stale="true">{updated ? " " : ""}<span className="sh-stale-dot" aria-hidden>{"\u00b7"}</span> {staleHint}</span>}
          </span>
        )}
        {toggle && (
          <button type="button" className="sh-toggle" aria-expanded={!toggle.collapsed} aria-controls={toggle.controls} aria-label={toggle.label} title={toggle.label} onClick={toggle.onToggle}>
            <Chevron className="sh-chevron" />
          </button>
        )}
        {hint && <span className="sh-hint" aria-hidden>{hint}</span>}
        {end && <div className="sh-end">{end}</div>}
      </div>
    </div>
  );
}
