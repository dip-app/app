"use client";

import { Ideas } from "@/components/Ideas";
import { Shell } from "@/components/Shell";

export default function IdeasPage() {
  return (
    <Shell title="Event ideas" subtitle="Answer four quick questions, add a note, and get event drafts to review." requires="ai.generate">
      <Ideas />
    </Shell>
  );
}
