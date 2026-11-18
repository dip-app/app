// @i18n-migrated
import { Button } from "@/components/kit";
import { t } from "@/lib/i18n";

export default function NotFound() {
  return (
    <main id="main" className="status-page">
      <div className="empty">
        <h1>{t("common.notFound.title")}</h1>
        <p>{t("common.notFound.body")}</p>
        <div className="empty-action status-actions">
          <Button variant="primary" href="/overview/">{t("common.error.toOverview")}</Button>
        </div>
      </div>
    </main>
  );
}
