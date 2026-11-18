import type { ReactNode } from "react";
import { SkeletonBlock } from "../Skeleton";
import { InlineNotice } from "./InlineNotice";

/**
 * A titled section card. `id` names the heading and labels the section. `actions` sits on the right of the title row.
 * `state` replaces the body: `loading` (calm placeholders, aria-busy), `empty` (muted text) or `error` (alert banner with
 * an optional `onRetry` action).
 */
export function Panel({ id, title, description, actions, loading = false, empty, error, headingLevel = 2, className, children, ...aria }: {
  id: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; loading?: boolean; empty?: ReactNode; error?: ReactNode;
  headingLevel?: 2 | 3; className?: string; children?: ReactNode; "aria-live"?: "polite" | "assertive";
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3";
  const heading = <Heading id={`${id}`}>{title}</Heading>;
  return (
    <section className={`panel${className ? ` ${className}` : ""}`} aria-labelledby={id} aria-busy={loading || undefined} {...aria}>
      {actions ? <div className="panel-head">{heading}{actions}</div> : heading}
      {description && <p className="muted">{description}</p>}
      {error ? <InlineNotice tone="error">{error}</InlineNotice>
        : loading ? <><SkeletonBlock w="100%" h={48} r={8} /><SkeletonBlock w="100%" h={48} r={8} /></>
        : empty ? <p className="muted fill">{empty}</p>
        : children}
    </section>
  );
}
