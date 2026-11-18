"use client";

import { Shell } from "@/components/Shell";
import { UserSettings } from "@/components/UserSettings";

export default function AccountPage() {
  return (
    <Shell title="Your settings" subtitle="Preferences that belong to you, not to your company.">
      <UserSettings />
    </Shell>
  );
}
