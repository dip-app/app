"use client";

import { Shell } from "@/components/Shell";
import { ThemeForm } from "@/components/ThemeForm";

export default function NewThemePage() {
  return (
    <Shell title="New theme" subtitle="Members see it on Home when its first week starts." requires="themes.manage">
      <ThemeForm />
    </Shell>
  );
}
