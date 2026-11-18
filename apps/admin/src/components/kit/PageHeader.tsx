// @i18n-migrated

import type { ReactNode } from "react";

/** The page's title row: one h1, a muted description and at most one compact action on the right. Shell renders it for every page. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="titles">
        <h1 className="page-title">{title}</h1>
        {description && <p className="subtitle">{description}</p>}
      </div>
      {actions && <div className="header-action">{actions}</div>}
    </header>
  );
}
