"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { EventForm } from "@/components/EventForm";
import { Shell } from "@/components/Shell";
import { LoadError, Loading } from "@/components/Ui";
import { ApiError, type AdminEvent } from "@/lib/contract";

const NO_EVENT = new ApiError("not-found", "No event was selected. Pick one from the events list.");

function Editor() {
  const { api, session } = useApp();
  const id = useSearchParams().get("id") ?? "";
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    setEvent(null);
    setError(null);
    api.getEvent(id).then(
      (loaded) => !cancelled && (setEvent(loaded), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this event. Check your connection and try again.")),
    );
    return () => { cancelled = true; };
  }, [api, session, id, version]);

  const reload = useCallback(() => { setEvent(null); setVersion((v) => v + 1); }, []);

  if (!id) return <LoadError error={NO_EVENT} onRetry={reload} backHref="/events/" backLabel="Back to events" />;
  if (error) return <LoadError error={error} onRetry={reload} backHref="/events/" backLabel="Back to events" />;
  if (!event) return <Loading label="Loading event" />;
  return <EventForm key={`${event.id}-${event.revision}`} event={event} onReload={reload} />;
}

export default function EditEventPage() {
  return (
    <Shell title="Edit event" subtitle="Changes appear in the app as soon as you save." requires="events.manage">
      <Suspense fallback={<Loading label="Loading event" />}><Editor /></Suspense>
    </Shell>
  );
}
