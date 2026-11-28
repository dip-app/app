// @i18n-migrated
import { type ThemePhase, type WeeklyTheme, formatGoal, formatReward } from "@/lib/challenge";
import { formatNumber, t } from "@/lib/i18n";
import { formatWindow } from "@/lib/weeks";
import { TableRegion } from "./TableRegion";
import { ThemeArt } from "./ThemeArt";
import { Info } from "./Ui";
import { Button } from "@/components/kit";

const PHASE_ORDER: Record<ThemePhase, number> = { current: 0, upcoming: 1, past: 2 };

/** This week first, then upcoming (soonest first), then past (newest first). */
export function sortChallenges(themes: WeeklyTheme[], phaseOf: (theme: WeeklyTheme) => ThemePhase): WeeklyTheme[] {
  return [...themes].sort((a, b) => {
    const pa = phaseOf(a);
    const pb = phaseOf(b);
    if (pa !== pb) return PHASE_ORDER[pa] - PHASE_ORDER[pb];
    const delta = Date.parse(a.startDate) - Date.parse(b.startDate);
    return pa === "upcoming" ? delta : -delta;
  });
}

/**
 * One table row per challenge: theme art tile, title, reward and the review note (which says where the week stands; no chip marks the normal states), then
 * dates, goal, joined, pending and the review link (outline: a page of themes has no single main action). `pending` is undefined while the count loads.
 */
export function ChallengeRow({ theme, phase, pending }: { theme: WeeklyTheme; phase: ThemePhase; pending?: string }) {
  const window = formatWindow(theme.startDate, theme.endDate);
  const reviewable = phase !== "upcoming";
  const note = t(phase === "upcoming" ? "challenges.row.noteUpcoming" : phase === "past" ? "challenges.row.notePast" : "challenges.row.noteCurrent");
  return (
    <tr className={`challenge-tr ${phase}`} data-testid="challenge-row">
      <td className="cell-main">
        <div className="media-cell">
          <ThemeArt url={theme.coverImageURL} title={theme.title} className="thumb art tile" />
          <div className="media-text">
            <span className="challenge-title"><strong>{theme.title}</strong></span>
            <span className="line muted">{formatReward(theme.pointsReward)} · {note}</span>
            <span className="mid-sub">{window}</span>
          </div>
        </div>
      </td>
      <td className="nowrap mid-hide" data-label={t("challenges.table.dates")}>{window}</td>
      <td className="mid-hide nowrap" data-label={t("challenges.table.goal")}>{formatGoal(theme.goal, theme.goalUnit)}</td>
      <td className="num" data-label={t("challenges.table.joined")}>{/* Same words as the Schedule's Participation column. */}
        {theme.completedCount > 0 ? t("challenges.themes.row.joinedCompleted", { joined: formatNumber(theme.participantCount), completed: formatNumber(theme.completedCount) }) : t("challenges.themes.row.joined", { count: theme.participantCount })}</td>
      <td className="num" data-label={t("challenges.table.pending")}>
        {!reviewable ? <span className="muted">{t("challenges.row.noneYet")}</span>
          : pending === undefined ? <span className="muted" aria-label={t("challenges.row.loadingPending")}>…</span>
          : pending === "0" ? <span className="muted">{t("challenges.row.pending", { count: pending })}</span>
          : <Info tone="warn">{t("challenges.row.pending", { count: pending })}</Info>}
      </td>
      {/* An upcoming week has no action: the note and the pending cell already say reviews open when it starts. */}
      <td className="right">
        {reviewable && <Button size="sm" href={`/challenges/review/?id=${encodeURIComponent(theme.id)}`} aria-label={t("challenges.row.reviewAria", { title: theme.title, window })}>{t("challenges.row.review")}</Button>}
      </td>
    </tr>
  );
}

export function ChallengeTable({ children }: { children: React.ReactNode }) {
  return (
    <TableRegion label={t("challenges.table.label")}>
      <table className="table responsive challenges-table sticky-actions">
        <caption className="sr-only">{t("challenges.table.caption")}</caption>
        <thead><tr><th scope="col">{t("challenges.table.challenge")}</th><th scope="col" className="mid-hide">{t("challenges.table.dates")}</th><th scope="col" className="mid-hide">{t("challenges.table.goal")}</th><th scope="col" className="num">{t("challenges.table.joined")}</th><th scope="col" className="num">{t("challenges.table.pending")}</th><th scope="col"><span className="sr-only">{t("challenges.table.action")}</span></th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </TableRegion>
  );
}
