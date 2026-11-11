"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";
import { Empty, Info, LoadError, Loading } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { type ThemePhase, formatGoal, formatReward, themePhase } from "@/lib/challenge";
import { formatWindow } from "@/lib/weeks";

const PHASE_LABEL: Record<ThemePhase, string> = { current: "This week", upcoming: "Upcoming", past: "Past" };

export default function ChallengesPage() {
  const { api } = useApp();
  const themes = useLoad((a) => a.listThemes(), "themes");
  const [pending, setPending] = useState<Record<string, string>>({});
  const now = useMemo(() => new Date(), []);
  // Newest first; themes that haven't started have nothing to review yet.
  const reviewable = (themes.data ?? []).filter((theme) => themePhase(theme, now) !== "upcoming");

  const ids = reviewable.map((theme) => theme.id).join(",");
  useEffect(() => {
    // Pending count per theme (first page only, so a long queue shows "25+").
    let cancelled = false;
    for (const themeId of ids.split(",").filter(Boolean)) {
      api.listSubmissions(themeId, "submitted").then(
        (page) => !cancelled && setPending((p) => ({ ...p, [themeId]: `${page.submissions.length}${page.nextCursor ? "+" : ""}` })),
        () => undefined,
      );
    }
    return () => { cancelled = true; };
  }, [api, ids]);

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
                    <span className="theme-row-pills"><Info tone={phase === "current" ? "ok" : undefined}>{PHASE_LABEL[phase]}</Info>{pending[theme.id] !== undefined && <Info tone={pending[theme.id] !== "0" ? "warn" : undefined}>{pending[theme.id]} pending</Info>}</span>
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
