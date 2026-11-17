"use client";

import { Shell } from "@/components/Shell";
import { SuggestionsEmail } from "@/components/SuggestionsEmail";

export default function SuggestionsPage() {
  return (
    <Shell title="Weekly ideas email" subtitle="A short email with event ideas for your company, every week." requires="ai.generate">
      <SuggestionsEmail />
    </Shell>
  );
}
