import Link from "next/link";
import { type ThemePhase, type WeeklyTheme, formatGoal, formatReward } from "@/lib/challenge";
import { formatWindow } from "@/lib/weeks";
import { ThemeArt } from "./ThemeArt";

const PHASE_LABEL: Record<ThemePhase, string> = { current: "This week", upcoming: "Upcoming", past: "Past" };

/** Illustration on the theme accent at the left, details at the right, like the event cards. */
export function ThemeCard({ theme, phase }: { theme: WeeklyTheme; phase: ThemePhase }) {
  return (
    <div className="card-cell">
      <article className={`theme-card ${phase}`} data-testid="theme-card">
        <ThemeArt url={theme.coverImageURL} title={theme.title} className="art" />
        <Link className="edit-icon" href={`/themes/edit/?id=${encodeURIComponent(theme.id)}`} aria-label={`Edit ${theme.title}, ${formatWindow(theme.startDate, theme.endDate)}`} title="Edit theme">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16.9 3.6a2.2 2.2 0 0 1 3.1 3.1L8.4 18.3 3.5 19.5l1.2-4.9L16.9 3.6Z" />
            <path d="m15 5.5 3.5 3.5" />
          </svg>
        </Link>
        <div className="details">
          <span className="status-pill">{PHASE_LABEL[phase]}</span>
          <h2>{theme.title}</h2>
          <dl>
            <div><dt>Week</dt><dd>{formatWindow(theme.startDate, theme.endDate)}</dd></div>
            <div><dt>Goal</dt><dd>{formatGoal(theme.goal, theme.goalUnit)}</dd></div>
            <div><dt>Reward</dt><dd>{formatReward(theme.pointsReward)}</dd></div>
            <div><dt>Joined</dt><dd>{theme.participantCount} joined{theme.completedCount > 0 ? ` · ${theme.completedCount} completed` : ""}</dd></div>
          </dl>
        </div>
      </article>
    </div>
  );
}
