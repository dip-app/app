"use client";
// @i18n-migrated

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { ChallengeRow, ChallengeTable, sortChallenges } from "@/components/ChallengeRows";
import { Shell } from "@/components/Shell";
import { Empty, LoadError, Loading } from "@/components/Ui";
import { useLoad } from "@/components/useLoad";
import { themePhase } from "@/lib/challenge";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button } from "@/components/kit";
import { t } from "@/lib/i18n";

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

  const hold = useSkeletonGate(!themes.data && !themes.error);

  return (
    <Shell title={t("challenges.title")} subtitle={t("challenges.subtitle")} requires="challenges.review">
      {themes.error ? <LoadError error={themes.error} onRetry={themes.reload} />
        : !themes.data || hold ? <Loading label={t("challenges.loading")} layout="challenges" />
        : sorted.length === 0 ? (
          <Empty title={t("challenges.empty.title")} body={t("challenges.empty.body")} action={<Button variant="primary" href="/themes/">{t("challenges.empty.action")}</Button>} />
        ) : (
          <ChallengeTable>
            {sorted.map((theme) => <ChallengeRow key={theme.id} theme={theme} phase={themePhase(theme, now)} pending={pending[theme.id]} />)}
          </ChallengeTable>
        )}
    </Shell>
  );
}
