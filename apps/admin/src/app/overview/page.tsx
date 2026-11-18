"use client";

import { useEffect, useState } from "react";
import { ActivityChart, InterestsCard, OverviewLoading, PeopleCard, PendingActions, QuietNotice, StatTiles, ThemeCard, TopEvents, TopMembers, UnavailableNotice } from "@/components/Overview";
import { Shell } from "@/components/Shell";
import { LoadError } from "@/components/Ui";
import { useApp } from "@/components/AppProvider";
import { Sk, SkeletonBlock } from "@/components/Skeleton";
import { useTags } from "@/components/TagCatalog";
import { useLoad } from "@/components/useLoad";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { can } from "@/lib/adminTypes";
import { refreshFailureMessage, updatedLabel } from "@/lib/insights";
import { Button, InlineNotice } from "@/components/kit";

export default function OverviewPage() {
  const { api, session } = useApp();
  const insights = useLoad((a) => a.companyInsights(), "insights");
  // Interest counts load on their own, so the card still shows when insights fail. A failure or a denied read just hides it.
  const tagStats = useLoad((a) => a.tagStats(), "tagStats");
  const tagCatalog = useTags();
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
      const failed: string[] = [];
      if (fresh.status === "fulfilled") insights.setData(fresh.value); else failed.push("insights");
      if (stats.status === "fulfilled") tagStats.setData(stats.value); else failed.push("interest counts");
      if (tags.status === "rejected" || (tags.status === "fulfilled" && tags.value === false)) failed.push("interest names");
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
      <span className="muted" role="status">{refreshing ? "Refreshing…" : updatedLabel(data.generatedAt, now)}</span>
      <Button size="sm" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing || undefined}>{refreshing ? "Refreshing" : "Refresh"}</Button>
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
    <Shell title="Overview" subtitle="How your company uses DIP over the last 30 days." requires="insights.view" action={action}>
      {insights.error ? <div className="overview"><LoadError error={insights.error} onRetry={insights.reload} />{interests}</div>
        : !data || holdSkeleton ? <OverviewLoading role={role} interestCount={tagCatalog.status === "ready" ? tagCatalog.tags.length : undefined}>{interests}</OverviewLoading>
        : (
          <div className="overview" aria-busy={refreshing || undefined}>
            {refreshError && <InlineNotice tone="error">{refreshError}</InlineNotice>}
            <UnavailableNotice insights={data} />
            <QuietNotice insights={data} />
            <StatTiles insights={data} role={role} />
            <div className="overview-row wide-left">
              <ActivityChart insights={data} />
              <PendingActions insights={data} role={role} now={now} />
            </div>
            <div className="overview-row">
              <TopEvents insights={data} />
              <ThemeCard insights={data} role={role} now={now} />
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
