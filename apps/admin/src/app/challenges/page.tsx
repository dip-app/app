"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Shell } from "@/components/Shell";
import { Empty, Info, LoadError, Loading } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { type ThemePhase, formatGoal, formatReward, themePhase } from "@/lib/challenge";
import { formatWindow } from "@/lib/weeks";

const PHASE_LABEL: Record<ThemePhase, string> = { current: "This week", upcoming: "Upcoming", past: "Past" };

export default function ChallengesPage() {
  const themes = useLoad((api) => api.listThemes(), "themes");
  const now = useMemo(() => new Date(), []);
  // Newest first; themes that haven't started have nothing to review yet.
  const reviewable = (themes.data ?? []).filter((theme) => themePhase(theme, now) !== "upcoming");

  return (
    <Shell title="Challenges" subtitle="Review what people submitted for each weekly theme: approve it to award the points, or ask for changes." requires="challenges.review">
      {themes.error ? <LoadError error={themes.error} onRetry={themes.reload} />
        : !themes.data ? <Loading label="Loading weekly themes" />
        : reviewable.length === 0 ? (
          <Empty title="Nothing to review yet" body="Submissions appear here once a weekly theme has started." action={<Link className="pill-btn dark" href="/themes/">Weekly themes</Link>} />
        ) : (
          <ul className="theme-rows" aria-label="Weekly themes">
            {reviewable.map((theme) => {
              const phase = themePhase(theme, now);
              return (
                <li key={theme.id} className="theme-row">
                  <div className="theme-row-main">
                    <Info tone={phase === "current" ? "ok" : undefined}>{PHASE_LABEL[phase]}</Info>
                    <h2>{theme.title}</h2>
                    <p className="muted">{formatWindow(theme.startDate, theme.endDate)} · {formatGoal(theme.goal, theme.goalUnit)} · {formatReward(theme.pointsReward)}</p>
                    <p className="muted">{theme.participantCount} joined{theme.completedCount > 0 ? ` · ${theme.completedCount} completed` : ""}</p>
                  </div>
                  <Link className="pill-btn dark" href={`/challenges/review/?id=${encodeURIComponent(theme.id)}`} aria-label={`Review submissions for ${theme.title}, ${formatWindow(theme.startDate, theme.endDate)}`}>Review submissions</Link>
                </li>
              );
            })}
          </ul>
        )}
    </Shell>
  );
}
