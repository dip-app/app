"use client";

import { EventForm } from "@/components/EventForm";
import { GenerateSuggestionsButton } from "@/components/GenerateSuggestionsButton";
import { Shell } from "@/components/Shell";

export default function NewEventPage() {
  return (
    <Shell title="New event" subtitle="Members see it in the app as soon as it’s created." requires="events.manage" action={<GenerateSuggestionsButton />}>
      <EventForm />
    </Shell>
  );
}
