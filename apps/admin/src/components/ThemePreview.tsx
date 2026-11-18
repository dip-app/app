// @i18n-migrated
import { type ThemeDraft, formatGoal, formatReward } from "@/lib/challenge";
import { t } from "@/lib/i18n";
import { formatWindow } from "@/lib/weeks";
import { ThemeArt } from "./ThemeArt";

/** How the theme reads on the app's Home card ("This Week's Challenge") plus the key details. */
export function ThemePreview({ draft, participantCount = 0 }: { draft: ThemeDraft; participantCount?: number }) {
  const window = formatWindow(draft.startDate, draft.endDate);
  return (
    <aside className="preview" aria-label={t("themeForm.preview.aria")}>
      <p className="preview-label">{t("themeForm.preview.label")}</p>
      <div className="app-theme-card">
        <ThemeArt url={draft.coverImageURL} title={draft.title} className="art" />
        <h2>{draft.title.trim() || t("themeForm.preview.titleFallback")}</h2>
        <span className="participants">{participantCount > 0 ? t("themeForm.preview.others", { count: participantCount }) : t("themeForm.preview.first")}</span>
        <span className="arrow" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
        </span>
      </div>
      <dl className="preview-facts">
        <div><dt>{t("themeForm.preview.week")}</dt><dd>{window || t("themeForm.preview.weekEmpty")}</dd></div>
        <div><dt>{t("themeForm.preview.goal")}</dt><dd>{draft.goalUnit.trim() && Number.isFinite(draft.goal) ? formatGoal(draft.goal, draft.goalUnit) : t("themeForm.preview.notSet")}</dd></div>
        <div><dt>{t("themeForm.preview.reward")}</dt><dd>{formatReward(draft.pointsReward) || t("themeForm.preview.notSet")}</dd></div>
      </dl>
    </aside>
  );
}
