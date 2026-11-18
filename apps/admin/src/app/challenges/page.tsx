"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { ChallengeRow, ChallengeTable, sortChallenges } from "@/components/ChallengeRows";
import { Shell } from "@/components/Shell";
import { Empty, LoadError, Loading } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { themePhase } from "@/lib/challenge";

export default function ChallengesPage() {
  const { api } = useApp();
  const themes = useLoad((a) => a.listThemes(), "themes");
  const [pending, setPending] = useState<Record<string, string>>({});
  const now = useMemo(() => new Date(), []);
  // This week, then upcoming, then past. Upcoming themes are listed but have nothing to review yet.
  const sorted = sortChallenges(themes.data ?? [], (theme) => themePhase(theme, now));
  const reviewable = sorted.filter((theme) => themePhase(theme, now) !== "upcoming");

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
        : sorted.length === 0 ? (
          <Empty title="Nothing to review yet" body="Submissions appear here once a weekly theme has started." action={<Link className="pill-btn dark" href="/themes/">Weekly themes</Link>} />
        ) : (
          <ChallengeTable>
            {sorted.map((theme) => <ChallengeRow key={theme.id} theme={theme} phase={themePhase(theme, now)} pending={pending[theme.id]} />)}
          </ChallengeTable>
        )}
    </Shell>
  );
}
