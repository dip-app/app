"use client";
// @i18n-migrated

import { Button } from "@/components/kit";
import { t } from "@/lib/i18n";

/** Route-level error boundary: a rendering failure offers a retry or a way out. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="status-page">
      <div className="empty" role="alert">
        <h2>{t("common.error.title")}</h2>
        <p>{t("common.error.body")}</p>
        <div className="empty-action status-actions">
          <Button variant="primary" onClick={() => reset()}>{t("common.tryAgain")}</Button>
          <Button href="/overview/">{t("common.error.toOverview")}</Button>
        </div>
      </div>
    </main>
  );
}
