import Link from "next/link";
import { type ThemePhase, type WeeklyTheme, formatGoal, formatReward } from "@/lib/challenge";
import { formatWindow } from "@/lib/weeks";
import { TableRegion } from "./TableRegion";
import { ThemeArt } from "./ThemeArt";
import { Info } from "./Ui";

const PHASE_LABEL: Record<ThemePhase, string> = { current: "This week", upcoming: "Upcoming", past: "Past" };
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
 * One table row per challenge: theme art tile, title with its status chip, reward and review note, then
 * dates, goal, joined, pending and the single primary action. `pending` is undefined while the count loads.
 */
export function ChallengeRow({ theme, phase, pending }: { theme: WeeklyTheme; phase: ThemePhase; pending?: string }) {
  const window = formatWindow(theme.startDate, theme.endDate);
  const reviewable = phase !== "upcoming";
  const note = phase === "upcoming" ? "Reviews open when the week starts" : phase === "past" ? "Reviews stay open after the week ends" : "Review as entries arrive";
  return (
    <tr className={`challenge-tr ${phase}`} data-testid="challenge-row">
      <td className="cell-main">
        <div className="media-cell">
          <ThemeArt url={theme.coverImageURL} title={theme.title} className="thumb art tile" />
          <div className="media-text">
            <span className="challenge-title"><strong>{theme.title}</strong><Info tone={phase === "current" ? "ok" : undefined}>{PHASE_LABEL[phase]}</Info></span>
            <span className="line muted">{formatReward(theme.pointsReward)} · {note}</span>
          </div>
        </div>
      </td>
      <td data-label="Dates">{window}</td>
      <td data-label="Goal">{formatGoal(theme.goal, theme.goalUnit)}</td>
      <td className="num" data-label="Joined">{theme.participantCount.toLocaleString("en-US")}{theme.completedCount > 0 && <span className="line muted">{theme.completedCount.toLocaleString("en-US")} completed</span>}</td>
      <td className="num" data-label="Pending">
        {!reviewable ? <span className="muted">None yet</span>
          : pending === undefined ? <span className="muted" aria-label="Loading pending count">…</span>
          : <Info tone={pending !== "0" ? "warn" : undefined}>{pending} pending</Info>}
      </td>
      <td className="right">
        {reviewable
          ? <Link className="pill-btn dark" href={`/challenges/review/?id=${encodeURIComponent(theme.id)}`} aria-label={`Review submissions for ${theme.title}, ${window}`}>Review submissions</Link>
          : <span className="muted">Not open yet</span>}
      </td>
    </tr>
  );
}

export function ChallengeTable({ children }: { children: React.ReactNode }) {
  return (
    <TableRegion label="Challenges">
      <table className="table responsive challenges-table">
        <caption className="sr-only">Challenges, this week first, then upcoming and past</caption>
        <thead><tr><th scope="col">Challenge</th><th scope="col">Dates</th><th scope="col">Goal</th><th scope="col" className="num">Joined</th><th scope="col" className="num">Pending</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </TableRegion>
  );
}
