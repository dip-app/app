"use client";

import { Shell } from "@/components/Shell";
import { ThemeForm } from "@/components/ThemeForm";

export default function NewThemePage() {
  return (
    <Shell title="New Theme" subtitle="Members see it on Home when its first week starts.">
      <ThemeForm />
    </Shell>
  );
}
