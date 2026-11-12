"use client";

import { useEffect, useState } from "react";
import { ActivityChart, PeopleCard, PendingActions, QuietNotice, StatTiles, StatTilesSkeleton, ThemeCard, TopEvents, TopMembers } from "@/components/Overview";
import { Shell } from "@/components/Shell";
import { LoadError } from "@/components/Ui";
import { useApp } from "@/components/AppProvider";
import { describe, useLoad } from "@/components/useLoad";
import { can } from "@/lib/adminTypes";
import { updatedLabel } from "@/lib/insights";

export default function OverviewPage() {
  const { api, session } = useApp();
  const insights = useLoad((a) => a.companyInsights(), "insights");
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

  return (
    <Shell title="Overview" subtitle="How your company uses DIP over the last 30 days." requires="insights.view" action={action}>
      {insights.error ? <LoadError error={insights.error} onRetry={insights.reload} />
        : !data ? <StatTilesSkeleton />
        : (
          <div className="overview">
            {refreshError && <p className="banner error" role="alert">{refreshError}</p>}
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
          </div>
        )}
    </Shell>
  );
}
