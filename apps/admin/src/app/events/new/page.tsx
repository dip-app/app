"use client";
// @i18n-migrated

import { EventForm } from "@/components/EventForm";
import { GenerateSuggestionsButton } from "@/components/GenerateSuggestionsButton";
import { Shell } from "@/components/Shell";
import { t } from "@/lib/i18n";

export default function NewEventPage() {
  return (
    <Shell title={t("events.new.title")} subtitle={t("events.new.subtitle")} requires="events.manage" back={{ href: "/events/", label: t("shell.nav.events") }} action={<GenerateSuggestionsButton />}>
      <EventForm />
    </Shell>
  );
}
