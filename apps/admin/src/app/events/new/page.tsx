"use client";

import { EventForm } from "@/components/EventForm";
import { Shell } from "@/components/Shell";

export default function NewEventPage() {
  return (
    <Shell>
      <div className="page-head"><div><h1>New event</h1><p>Members see it in the app as soon as it’s created.</p></div></div>
      <EventForm />
    </Shell>
  );
}
