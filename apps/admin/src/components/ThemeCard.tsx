import Link from "next/link";
import { type ThemePhase, type WeeklyTheme, formatGoal, formatReward } from "@/lib/challenge";
import { formatWindow } from "@/lib/weeks";
import { ThemeArt } from "./ThemeArt";

const PHASE_LABEL: Record<ThemePhase, string> = { current: "This week", upcoming: "Upcoming", past: "Past" };

/** One compact table row per weekly theme (small illustration on the theme accent). Rendered inside `ThemeTable`. */
export function ThemeCard({ theme, phase }: { theme: WeeklyTheme; phase: ThemePhase }) {
  const window = formatWindow(theme.startDate, theme.endDate);
  return (
    <tr className={`theme-row-tr ${phase}`} data-testid="theme-card">
      <td className="cell-main">
        <div className="media-cell">
          <ThemeArt url={theme.coverImageURL} title={theme.title} className="thumb art" />
          <div className="media-text">
            <Link className="row-title" href={`/themes/edit/?id=${encodeURIComponent(theme.id)}`} aria-label={`Edit ${theme.title}, ${window}`} title="Edit theme">{theme.title}</Link>
          </div>
        </div>
      </td>
      <td>{window}</td>
      <td>{formatGoal(theme.goal, theme.goalUnit)}</td>
      <td>{formatReward(theme.pointsReward)}</td>
      <td className="num">{theme.participantCount} joined{theme.completedCount > 0 ? ` · ${theme.completedCount} completed` : ""}</td>
      <td><span className={`info-pill${phase === "current" ? " ok" : ""}`}>{PHASE_LABEL[phase]}</span></td>
      <td className="right"><span className="row-actions"><Link className="pill-btn gray small" href={`/themes/edit/?id=${encodeURIComponent(theme.id)}`} aria-label={`Edit ${theme.title}`}>Edit</Link></span></td>
    </tr>
  );
}

export function ThemeTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="table responsive themes-table">
        <caption className="sr-only">Weekly themes</caption>
        <thead><tr><th scope="col">Theme</th><th scope="col">Week</th><th scope="col">Goal</th><th scope="col">Reward</th><th scope="col" className="num">Participation</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
