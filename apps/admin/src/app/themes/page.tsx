"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { can } from "@/lib/adminTypes";
import { Shell } from "@/components/Shell";
import { ThemeCard } from "@/components/ThemeCard";
import { type ThemePhase, type WeeklyTheme, sortThemes, themePhase } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";

const PHASES: { id: ThemePhase; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];

const EMPTY: Record<ThemePhase, { title: string; body: string }> = {
  current: { title: "No theme this week", body: "Members see the Home challenge card only while a theme runs. Add one for this week or plan the next." },
  upcoming: { title: "Nothing planned", body: "Plan the next weeks so Home always has a challenge on Monday." },
  past: { title: "No past themes", body: "Themes move here once their last day ends." },
};

export default function ThemesPage() {
  const { api, session } = useApp();
  const [themes, setThemes] = useState<WeeklyTheme[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [phase, setPhase] = useState<ThemePhase>("current");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api.listThemes().then(
      (list) => !cancelled && (setThemes(list), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load weekly themes.")),
    );
    return () => { cancelled = true; };
  }, [api, session, attempt]);

  const now = new Date();
  const shown = themes ? sortThemes(themes.filter((theme) => themePhase(theme, now) === phase), phase) : [];

  return (
    <Shell title="Weekly themes" subtitle="The “This Week’s Challenge” card on the app’s Home screen."
      action={can(session?.role, "themes.manage") ? <Link className="pill-btn purple" href="/themes/new/">New theme</Link> : undefined}>
      {error?.code === "permission-denied" ? (
        <div className="empty" role="alert">
          <h2>No organizer access</h2>
          <p>Your account can use DIP, but it isn’t an organizer for your company. Ask a company admin to assign the organizer role, then sign in again.</p>
        </div>
      ) : error ? (
        <div className="banner error" role="alert">
          <span>{error.message}</span>
          <button className="pill-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : themes === null ? (
        <div className="skeleton-list" role="status" aria-label="Loading weekly themes"><div className="skeleton" /></div>
      ) : (
        <>
          <div className="tabs" role="group" aria-label="Filter weekly themes">
            {PHASES.map((item) => (
              <button key={item.id} className="tab" aria-pressed={phase === item.id} onClick={() => setPhase(item.id)}>
                {item.label} ({themes.filter((theme) => themePhase(theme, now) === item.id).length})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="empty">
              <h2>{EMPTY[phase].title}</h2>
              <p>{EMPTY[phase].body}</p>
            </div>
          ) : (
            <div className="cards">{shown.map((theme) => <ThemeCard key={theme.id} theme={theme} phase={phase} />)}</div>
          )}
        </>
      )}
    </Shell>
  );
}
