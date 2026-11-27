"use client";
// @i18n-migrated

import { Suspense, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { ChallengeRow, ChallengeTable, sortChallenges } from "@/components/ChallengeRows";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { ThemeCard, ThemeTable } from "@/components/ThemeCard";
import { Empty, LoadError, Loading } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, ChipToggle } from "@/components/kit";
import { can } from "@/lib/adminTypes";
import { type ThemePhase, type WeeklyTheme, sortThemes, themePhase } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";
import { formatNumber, t, type MessageKey } from "@/lib/i18n";
import { oneOf, useQueryState } from "@/lib/useQueryState";

/**
 * The weekly challenge, in one place: Schedule plans and edits the weeks (what members see on Home), Review approves
 * what they submit. Both read the same cached list of challenges.
 */
type Tab = "schedule" | "review";
const PHASES: { id: ThemePhase; labelKey: MessageKey }[] = [
  { id: "current", labelKey: "challenges.themes.tab.current" },
  { id: "upcoming", labelKey: "challenges.themes.tab.upcoming" },
  { id: "past", labelKey: "challenges.themes.tab.past" },
];
const PHASE_IDS = PHASES.map((item) => item.id);
const EMPTY: Record<ThemePhase, { titleKey: MessageKey; bodyKey: MessageKey }> = {
  current: { titleKey: "challenges.themes.empty.current.title", bodyKey: "challenges.themes.empty.current.body" },
  upcoming: { titleKey: "challenges.themes.empty.upcoming.title", bodyKey: "challenges.themes.empty.upcoming.body" },
  past: { titleKey: "challenges.themes.empty.past.title", bodyKey: "challenges.themes.empty.past.body" },
};
const DEFAULTS = { tab: "schedule", phase: "current" };

function Challenges() {
  const { session } = useApp();
  const canManage = can(session?.role, "themes.manage");
  const canReview = can(session?.role, "challenges.review");
  const [qs, setQs] = useQueryState(DEFAULTS);
  // Organizers see the schedule only; the Review tab is for people who can approve entries.
  const tab: Tab = canReview ? oneOf(qs.tab, ["schedule", "review"] as const, "schedule") : "schedule";
  const list = useLoad((a) => a.listThemes().catch((failure: unknown) => {
    throw failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("challenges.themes.loadFailed"));
  }), "themes.list");
  const themes = list.data;
  const hold = useSkeletonGate(themes === null && !list.error);

  return (
    <Shell title={t("challenges.title")} subtitle={t("challenges.subtitle")}
      action={canManage ? <Button variant="primary" href="/challenges/new/">{t("challenges.themes.new")}</Button> : undefined}>
      {canReview && (
        <Tabs idBase="challenges" label={t("challenges.tabsLabel")} value={tab} onChange={(id) => setQs({ tab: id })}
          items={[{ id: "schedule", label: t("challenges.tab.schedule") }, { id: "review", label: t("challenges.tab.review") }]} />
      )}
      <div key={tab} {...(canReview ? tabPanelProps("challenges", tab) : {})}>
        {list.error ? <LoadError error={list.error} onRetry={list.reload} />
          : themes === null || hold ? <Loading label={t("challenges.loading")} layout={tab === "review" ? "challenges" : "themes"} />
          : tab === "review" ? <Review themes={themes} onSchedule={() => setQs({ tab: "schedule" })} />
          : <Schedule themes={themes} phase={oneOf(qs.phase, PHASE_IDS, "current")} onPhase={(phase) => setQs({ phase })} canEdit={canManage} />}
      </div>
    </Shell>
  );
}

/** Schedule: the weeks, one phase at a time (this week, upcoming, past), each row opening the editor. */
function Schedule({ themes, phase, onPhase, canEdit }: { themes: WeeklyTheme[]; phase: ThemePhase; onPhase: (phase: ThemePhase) => void; canEdit: boolean }) {
  const now = new Date();
  const shown = sortThemes(themes.filter((theme) => themePhase(theme, now) === phase), phase);
  return (
    <>
      <div className="chips phase-chips" role="group" aria-label={t("challenges.themes.filterLabel")}>
        {PHASES.map((item) => (
          <ChipToggle key={item.id} pressed={phase === item.id} onClick={() => onPhase(item.id)}
            count={formatNumber(themes.filter((theme) => themePhase(theme, now) === item.id).length)}>{t(item.labelKey)}</ChipToggle>
        ))}
      </div>
      {shown.length === 0
        ? <Empty title={t(EMPTY[phase].titleKey)} body={t(EMPTY[phase].bodyKey)} />
        : <ThemeTable>{shown.map((theme) => <ThemeCard key={theme.id} theme={theme} phase={phase} canEdit={canEdit} />)}</ThemeTable>}
    </>
  );
}

/** Review: this week first, then upcoming (nothing to review yet), then past, each with its pending entries. */
function Review({ themes, onSchedule }: { themes: WeeklyTheme[]; onSchedule: () => void }) {
  const { api } = useApp();
  const [pending, setPending] = useState<Record<string, string>>({});
  const now = useMemo(() => new Date(), []);
  const sorted = sortChallenges(themes, (theme) => themePhase(theme, now));
  const ids = sorted.filter((theme) => themePhase(theme, now) !== "upcoming").map((theme) => theme.id).join(",");
  useEffect(() => {
    // Pending count per challenge (first page only, so a long queue shows "25+").
    let cancelled = false;
    for (const themeId of ids.split(",").filter(Boolean)) {
      api.listSubmissions(themeId, "submitted").then(
        (page) => !cancelled && setPending((p) => ({ ...p, [themeId]: `${page.submissions.length}${page.nextCursor ? "+" : ""}` })),
        () => undefined,
      );
    }
    return () => { cancelled = true; };
  }, [api, ids]);

  if (sorted.length === 0) return <Empty title={t("challenges.empty.title")} body={t("challenges.empty.body")} action={<Button onClick={onSchedule}>{t("challenges.empty.action")}</Button>} />;
  return (
    <>
      <p className="muted tab-intro">{t("challenges.review.intro")}</p>
      <ChallengeTable>
        {sorted.map((theme) => <ChallengeRow key={theme.id} theme={theme} phase={themePhase(theme, now)} pending={pending[theme.id]} />)}
      </ChallengeTable>
    </>
  );
}

export default function ChallengesPage() {
  return <Suspense fallback={<Loading label={t("challenges.loading")} layout="themes" />}><Challenges /></Suspense>;
}
