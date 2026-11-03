"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { EventForm } from "@/components/EventForm";
import { Shell } from "@/components/Shell";
import { ApiError, type AdminEvent } from "@/lib/contract";

function Editor() {
  const { api, session } = useApp();
  const id = useSearchParams().get("id") ?? "";
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    api.getEvent(id).then(
      (loaded) => !cancelled && (setEvent(loaded), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this event.")),
    );
    return () => { cancelled = true; };
  }, [api, session, id, version]);

  const reload = useCallback(() => { setEvent(null); setVersion((v) => v + 1); }, []);

  return (
    <>
      <div className="page-head"><div><h1>Edit event</h1>{event && <p>{event.title} · revision {event.revision}</p>}</div></div>
      {error ? <div className="banner error" role="alert">{error.message}</div>
        : !event ? <p role="status">Loading…</p>
        : <EventForm key={`${event.id}-${event.revision}`} event={event} onReload={reload} />}
    </>
  );
}

export default function EditEventPage() {
  return (
    <Shell>
      <Suspense fallback={<p role="status">Loading…</p>}><Editor /></Suspense>
    </Shell>
  );
}
