"use client";
// @i18n-migrated

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
import { t, type MessageKey } from "@/lib/i18n";

const PHASES: { id: ThemePhase; labelKey: MessageKey }[] = [
  { id: "current", labelKey: "challenges.themes.tab.current" },
  { id: "upcoming", labelKey: "challenges.themes.tab.upcoming" },
  { id: "past", labelKey: "challenges.themes.tab.past" },
];
const IDS = PHASES.map((item) => item.id);

const EMPTY: Record<ThemePhase, { titleKey: MessageKey; bodyKey: MessageKey }> = {
  current: { titleKey: "challenges.themes.empty.current.title", bodyKey: "challenges.themes.empty.current.body" },
  upcoming: { titleKey: "challenges.themes.empty.upcoming.title", bodyKey: "challenges.themes.empty.upcoming.body" },
  past: { titleKey: "challenges.themes.empty.past.title", bodyKey: "challenges.themes.empty.past.body" },
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
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("challenges.themes.loadFailed"))),
    );
    return () => { cancelled = true; };
  }, [api, session, attempt]);

  const hold = useSkeletonGate(themes === null && !error);
  const now = new Date();
  const shown = themes ? sortThemes(themes.filter((theme) => themePhase(theme, now) === phase), phase) : [];

  return (
    <Shell title={t("challenges.themes.title")} subtitle={t("challenges.themes.subtitle")}
      action={canManage ? <Button variant="primary" href="/themes/new/">{t("challenges.themes.new")}</Button> : undefined}>
      {error ? <LoadError error={error} onRetry={() => setAttempt((n) => n + 1)} />
        : themes === null || hold ? <Loading label={t("challenges.loading")} layout="themes" />
        : (
          <>
            <Tabs idBase="themes" label={t("challenges.themes.filterLabel")} value={phase} onChange={(id) => setQuery({ phase: id })}
              items={PHASES.map((item) => ({ id: item.id, label: t(item.labelKey), count: themes.filter((theme) => themePhase(theme, now) === item.id).length }))} />
            <div {...tabPanelProps("themes", phase)}>
              {shown.length === 0 ? (
                <Empty title={t(EMPTY[phase].titleKey)} body={t(EMPTY[phase].bodyKey)} />
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
  return <Suspense fallback={<Loading label={t("challenges.loading")} layout="themes" />}><Themes /></Suspense>;
}
