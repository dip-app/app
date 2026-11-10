import { type ThemeDraft, formatGoal, formatReward } from "@/lib/challenge";
import { formatWindow } from "@/lib/weeks";
import { ThemeArt } from "./ThemeArt";

/** How the theme reads on the app's Home card ("This Week's Challenge") plus the key details. */
export function ThemePreview({ draft, participantCount = 0 }: { draft: ThemeDraft; participantCount?: number }) {
  const window = formatWindow(draft.startDate, draft.endDate);
  return (
    <aside className="preview" aria-label="Preview">
      <p className="preview-label">Preview: This Week’s Challenge</p>
      <div className="app-theme-card">
        <ThemeArt url={draft.coverImageURL} title={draft.title} className="art" />
        <h2>{draft.title.trim() || "Theme title"}</h2>
        <span className="participants">{participantCount > 0 ? `+ ${participantCount} others participating` : "Be the first this week"}</span>
        <span className="arrow" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
        </span>
      </div>
      <dl className="preview-facts">
        <div><dt>Week</dt><dd>{window || "Pick the weeks"}</dd></div>
        <div><dt>Goal</dt><dd>{draft.goalUnit.trim() && Number.isFinite(draft.goal) ? formatGoal(draft.goal, draft.goalUnit) : "—"}</dd></div>
        <div><dt>Reward</dt><dd>{formatReward(draft.pointsReward) || "—"}</dd></div>
      </dl>
    </aside>
  );
}
