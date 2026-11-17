"use client";

import { Shell } from "@/components/Shell";
import { SuggestedIdeaOpen } from "@/components/SuggestedIdeaOpen";

// Email deep link: /ideas/suggested/?t=<token>. The component reads the query after sign-in (static export).
export default function SuggestedIdeaPage() {
  return (
    <Shell title="Event idea" subtitle="Opening the idea from your email." requires="ai.generate">
      <SuggestedIdeaOpen />
    </Shell>
  );
}
