// @i18n-migrated
import Link from "next/link";
import { type ThemePhase, type WeeklyTheme, formatGoal, formatReward, phaseLabel } from "@/lib/challenge";
import { t } from "@/lib/i18n";
import { formatWindow } from "@/lib/weeks";
import { TableRegion } from "./TableRegion";
import { ThemeArt } from "./ThemeArt";
import { Button, Chip } from "@/components/kit";

/** One compact table row per weekly theme (small illustration on the theme accent). Rendered inside `ThemeTable`. */
export function ThemeCard({ theme, phase, canEdit = true }: { theme: WeeklyTheme; phase: ThemePhase; /** Only roles with themes.manage get Edit links. */ canEdit?: boolean }) {
  const window = formatWindow(theme.startDate, theme.endDate);
  return (
    <tr className={`theme-row-tr ${phase}`} data-testid="theme-card">
      <td className="cell-main">
        <div className="media-cell">
          <ThemeArt url={theme.coverImageURL} title={theme.title} className="thumb art" />
          <div className="media-text">
            {canEdit
              ? <Link className="row-title" href={`/themes/edit/?id=${encodeURIComponent(theme.id)}`} aria-label={t("challenges.themes.row.editWindowAria", { title: theme.title, window })} title={t("challenges.themes.row.editTitle")}>{theme.title}</Link>
              : <span className="row-title">{theme.title}</span>}
          </div>
        </div>
      </td>
      <td className="nowrap" data-label={t("challenges.themes.table.week")}>{window}</td>
      <td className="mid-hide" data-label={t("challenges.themes.table.goal")}>{formatGoal(theme.goal, theme.goalUnit)}</td>
      <td className="mid-hide" data-label={t("challenges.themes.table.reward")}>{formatReward(theme.pointsReward)}</td>
      <td className="num" data-label={t("challenges.themes.table.participation")}>{theme.completedCount > 0 ? t("challenges.themes.row.joinedCompleted", { joined: theme.participantCount, completed: theme.completedCount }) : t("challenges.themes.row.joined", { count: theme.participantCount })}</td>
      <td data-label={t("challenges.themes.table.status")}><Chip tone={phase === "current" ? "ok" : undefined}>{phaseLabel(phase)}</Chip></td>
      <td className="right">{canEdit && <span className="row-actions"><Button size="sm" href={`/themes/edit/?id=${encodeURIComponent(theme.id)}`} aria-label={t("challenges.themes.row.editAria", { title: theme.title })}>{t("challenges.themes.row.edit")}</Button></span>}</td>
    </tr>
  );
}

export function ThemeTable({ children }: { children: React.ReactNode }) {
  return (
    <TableRegion label={t("challenges.themes.table.label")}>
      <table className="table responsive themes-table sticky-actions">
        <caption className="sr-only">{t("challenges.themes.table.label")}</caption>
        <thead><tr><th scope="col">{t("challenges.themes.table.theme")}</th><th scope="col">{t("challenges.themes.table.week")}</th><th scope="col" className="mid-hide">{t("challenges.themes.table.goal")}</th><th scope="col" className="mid-hide">{t("challenges.themes.table.reward")}</th><th scope="col" className="num">{t("challenges.themes.table.participation")}</th><th scope="col">{t("challenges.themes.table.status")}</th><th scope="col"><span className="sr-only">{t("challenges.themes.table.actions")}</span></th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </TableRegion>
  );
}
