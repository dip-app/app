"use client";

// @i18n-migrated

import { useEffect, useState } from "react";
import { ActivityChart, InterestsCard, OverviewLoading, PeopleCard, PendingActions, QuietNotice, StatTiles, ThemeCard, TopEvents, TopMembers, UnavailableNotice } from "@/components/Overview";
import { Shell } from "@/components/Shell";
import { ComingUp, LastSevenDays, RecentActivity } from "@/components/OverviewWeek";
import { useBugBadge } from "@/lib/bugBadge";
import { LoadError } from "@/components/Ui";
import { useApp } from "@/components/AppProvider";
import { Sk, SkeletonBlock } from "@/components/Skeleton";
import { useTags } from "@/components/TagCatalog";
import { useLoad } from "@/components/useLoad";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { can } from "@/lib/adminTypes";
import { type RefreshSection, refreshFailureMessage, updatedLabel } from "@/lib/insights";
import { t } from "@/lib/i18n";
import { Button, InlineNotice } from "@/components/kit";

export default function OverviewPage() {
  const { api, session } = useApp();
  const insights = useLoad((a) => a.companyInsights(), "insights");
  // Interest counts load on their own, so the card still shows when insights fail. A failure or a denied read just hides it.
  const tagStats = useLoad((a) => a.tagStats(), "tagStats");
  const tagCatalog = useTags();
  // What is next and what changed: the event list (every role that sees the Overview manages events) and, for admins,
  // the latest audit entries. Both refresh with the page's Refresh.
  const events = useLoad((a) => a.listEvents(), "overview-events");
  const canAudit = can(session?.role, "audit.view");
  const audit = useLoad((a) => (canAudit ? a.listAudit() : Promise.resolve(null)), `overview-audit-${canAudit}`);
  const bugBadge = useBugBadge();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [now, setNow] = useState(() => new Date());
  // "Updated 4 min ago" keeps counting without refetching.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // One Refresh for the whole page: insights (bypassing the server cache), the interest counts and the tag catalog run
  // together, and each keeps its last data on screen until its own new answer arrives. A section that fails keeps its
  // old data and is named in the message; the others still update.
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const [fresh, stats, tags] = await Promise.allSettled([api.companyInsights(true), api.tagStats(), tagCatalog.reload()]);
      events.reload();
      audit.reload();
      const failed: RefreshSection[] = [];
      if (fresh.status === "fulfilled") insights.setData(fresh.value); else failed.push("insights");
      if (stats.status === "fulfilled") tagStats.setData(stats.value); else failed.push("interestCounts");
      if (tags.status === "rejected" || (tags.status === "fulfilled" && tags.value === false)) failed.push("interestNames");
      if (failed.length > 0) setRefreshError(refreshFailureMessage(failed));
      setNow(new Date());
    } finally {
      setRefreshing(false);
    }
  }

  const role = session?.role ?? "member";
  const data = insights.data;
  const action = data ? (
    <div className="refresh">
      <span className="muted" role="status">{refreshing ? t("overview.refreshing") : updatedLabel(data.generatedAt, now)}</span>
      <Button size="sm" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing || undefined}>{refreshing ? t("overview.refresh.busy") : t("overview.refresh.button")}</Button>
    </div>
  ) : insights.error ? undefined : (
    // Same footprint as the loaded hint and button, so the header does not change height when the data arrives.
    <div className="refresh" aria-hidden><span className="muted"><Sk w={96} /></span><SkeletonBlock w={78} h={28} r={6} /></div>
  );

  // The active total comes from insights; without it the card draws bars relative to the top interest.
  const interests = tagStats.data && tagCatalog.status === "ready"
    ? <InterestsCard stats={tagStats.data} tags={tagCatalog.tags} activeMembers={data && !data.unavailable.includes("members") ? data.members.active : null} />
    : null;

  const loading = !insights.error && !data;
  const holdSkeleton = useSkeletonGate(loading);

  return (
    <Shell title={t("overview.title")} subtitle={t("overview.subtitle")} requires="insights.view" action={action}>
      {insights.error ? <div className="overview"><LoadError error={insights.error} onRetry={insights.reload} />{interests}</div>
        : !data || holdSkeleton ? <OverviewLoading role={role} interestCount={tagCatalog.status === "ready" ? tagCatalog.tags.length : undefined}>{interests}</OverviewLoading>
        : (
          <div className="overview" aria-busy={refreshing || undefined}>
            {refreshError && <InlineNotice tone="error">{refreshError}</InlineNotice>}
            <UnavailableNotice insights={data} />
            <QuietNotice insights={data} />
            <LastSevenDays insights={data} events={events.data ?? (events.error ? [] : null)} role={role} now={now} />
            <div className="overview-row">
              <PendingActions insights={data} role={role} now={now} newBugReports={bugBadge?.count ?? null} />
              <ComingUp events={events.data ?? (events.error ? [] : null)} now={now} />
            </div>
            <h2 className="overview-section-title">{t("overview.month.title")}</h2>
            <StatTiles insights={data} role={role} />
            <div className="overview-row wide-left">
              <ActivityChart insights={data} />
              <ThemeCard insights={data} role={role} now={now} />
            </div>
            <div className={`overview-row${canAudit ? "" : " single"}`}>
              <TopEvents insights={data} />
              {canAudit && <RecentActivity entries={audit.data} error={!!audit.error} />}
            </div>
            <div className={`overview-row${can(role, "insights.points") && data.points ? "" : " single"}`}>
              <PeopleCard insights={data} />
              {can(role, "insights.points") && data.points && <TopMembers insights={data} />}
            </div>
            {interests}
          </div>
        )}
    </Shell>
  );
}
