"use client";

import { EventForm } from "@/components/EventForm";
import { Shell } from "@/components/Shell";

export default function NewEventPage() {
  return (
    <Shell title="New Event" subtitle="Members see it in the app as soon as it’s created.">
      <EventForm />
    </Shell>
  );
}
