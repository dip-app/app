"use client";

import { Ideas } from "@/components/Ideas";
import { Shell } from "@/components/Shell";
import { SCOUT } from "@/lib/scout";

export default function IdeasPage() {
  return (
    <Shell title={SCOUT.pageTitle} subtitle={`${SCOUT.tagline}: answer four quick questions, add a note, and get drafts to review.`} requires="ai.generate">
      <Ideas />
    </Shell>
  );
}
