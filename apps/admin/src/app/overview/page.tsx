"use client";

import { useEffect, useState } from "react";
import { ActivityChart, InterestsCard, PeopleCard, PendingActions, QuietNotice, StatTiles, StatTilesSkeleton, ThemeCard, TopEvents, TopMembers, UnavailableNotice } from "@/components/Overview";
import { Shell } from "@/components/Shell";
import { LoadError } from "@/components/Ui";
import { useApp } from "@/components/AppProvider";
import { describe, useLoad } from "@/components/useLoad";
import { can } from "@/lib/adminTypes";
import { updatedLabel } from "@/lib/insights";

export default function OverviewPage() {
  const { api, session } = useApp();
  const insights = useLoad((a) => a.companyInsights(), "insights");
  // Interest counts load on their own, so the card still shows when insights fail. A failure or a denied read just hides it.
  const tagStats = useLoad((a) => a.tagStats(), "tagStats");
  const tagCatalog = useLoad((a) => a.listTags(), "tags");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [now, setNow] = useState(() => new Date());
  // "Updated 4 min ago" keeps counting without refetching.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      insights.setData(await api.companyInsights(true));
      setNow(new Date());
    } catch (failure) {
      setRefreshError(describe(failure, "Couldn’t refresh. Try again in a moment."));
    } finally {
      setRefreshing(false);
    }
  }

  const role = session?.role ?? "member";
  const data = insights.data;
  const action = data ? (
    <div className="refresh">
      <span className="muted" role="status">{updatedLabel(data.generatedAt, now)}</span>
      <button className="pill-btn gray small" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing" : "Refresh"}</button>
    </div>
  ) : undefined;

  // The active total comes from insights; without it the card draws bars relative to the top interest.
  const interests = tagStats.data && tagCatalog.data
    ? <InterestsCard stats={tagStats.data} tags={tagCatalog.data} activeMembers={data && !data.unavailable.includes("members") ? data.members.active : null} />
    : null;

  return (
    <Shell title="Overview" subtitle="How your company uses DIP over the last 30 days." requires="insights.view" action={action}>
      {insights.error ? <div className="overview"><LoadError error={insights.error} onRetry={insights.reload} />{interests}</div>
        : !data ? <><StatTilesSkeleton />{interests}</>
        : (
          <div className="overview">
            {refreshError && <p className="banner error" role="alert">{refreshError}</p>}
            <UnavailableNotice insights={data} />
            <QuietNotice insights={data} />
            <StatTiles insights={data} role={role} />
            <div className="overview-row wide-left">
              <ActivityChart insights={data} />
              <PendingActions insights={data} role={role} />
            </div>
            <div className="overview-row">
              <TopEvents insights={data} />
              <ThemeCard insights={data} role={role} />
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
