"use client";

import { Suspense, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { can } from "@/lib/adminTypes";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { ThemeCard, ThemeTable } from "@/components/ThemeCard";
import { Empty, LoadError, Loading } from "@/components/Ui";
import { type ThemePhase, type WeeklyTheme, sortThemes, themePhase } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button } from "@/components/kit";

const PHASES: { id: ThemePhase; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];
const IDS = PHASES.map((item) => item.id);

const EMPTY: Record<ThemePhase, { title: string; body: string }> = {
  current: { title: "No theme this week", body: "Members see the Home challenge card only while a theme runs. Add one for this week or plan the next." },
  upcoming: { title: "Nothing planned", body: "Plan the next weeks so Home always has a challenge on Monday." },
  past: { title: "No past themes", body: "Themes move here once their last day ends." },
};
const DEFAULTS = { phase: "current" };

function Themes() {
  const { api, session } = useApp();
  const [themes, setThemes] = useState<WeeklyTheme[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [query, setQuery] = useQueryState(DEFAULTS);
  const phase = oneOf(query.phase, IDS, "current");
  const [attempt, setAttempt] = useState(0);
  const canManage = can(session?.role, "themes.manage");

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api.listThemes().then(
      (list) => !cancelled && (setThemes(list), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load weekly themes. Check your connection and try again.")),
    );
    return () => { cancelled = true; };
  }, [api, session, attempt]);

  const hold = useSkeletonGate(themes === null && !error);
  const now = new Date();
  const shown = themes ? sortThemes(themes.filter((theme) => themePhase(theme, now) === phase), phase) : [];

  return (
    <Shell title="Weekly themes" subtitle="The “This Week’s Challenge” card on the app’s Home screen."
      action={canManage ? <Button variant="primary" href="/themes/new/">New theme</Button> : undefined}>
      {error ? <LoadError error={error} onRetry={() => setAttempt((n) => n + 1)} />
        : themes === null || hold ? <Loading label="Loading weekly themes" layout="themes" />
        : (
          <>
            <Tabs idBase="themes" label="Filter weekly themes" value={phase} onChange={(id) => setQuery({ phase: id })}
              items={PHASES.map((item) => ({ id: item.id, label: item.label, count: themes.filter((theme) => themePhase(theme, now) === item.id).length }))} />
            <div {...tabPanelProps("themes", phase)}>
              {shown.length === 0 ? (
                <Empty title={EMPTY[phase].title} body={EMPTY[phase].body} />
              ) : (
                <ThemeTable>{shown.map((theme) => <ThemeCard key={theme.id} theme={theme} phase={phase} canEdit={canManage} />)}</ThemeTable>
              )}
            </div>
          </>
        )}
    </Shell>
  );
}

export default function ThemesPage() {
  return <Suspense fallback={<Loading label="Loading weekly themes" layout="themes" />}><Themes /></Suspense>;
}
