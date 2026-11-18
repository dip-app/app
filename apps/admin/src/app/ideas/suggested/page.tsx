"use client";
// @i18n-migrated

import { Shell } from "@/components/Shell";
import { SuggestedIdeaOpen } from "@/components/SuggestedIdeaOpen";
import { t } from "@/lib/i18n";

// Email deep link: /ideas/suggested/?t=<token>. The component reads the query after sign-in (static export).
export default function SuggestedIdeaPage() {
  return (
    <Shell title={t("dipbot.suggested.title")} subtitle={t("dipbot.suggested.subtitle")} requires="ai.generate">
      <SuggestedIdeaOpen />
    </Shell>
  );
}
