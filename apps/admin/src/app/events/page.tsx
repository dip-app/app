"use client";

import { Suspense, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { EventCard, EventTable } from "@/components/EventCard";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { Empty, LoadError, Loading } from "@/components/Ui";
import { ApiError, type AdminEvent, classify } from "@/lib/contract";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button } from "@/components/kit";

type Filter = "upcoming" | "past" | "cancelled";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Canceled" },
];
const IDS = FILTERS.map((item) => item.id);
const EMPTY_BODY: Record<Filter, string> = {
  upcoming: "Create an event to give your team something to join.",
  past: "Events move here after they end.",
  cancelled: "Events you cancel stay here for reference.",
};
const DEFAULTS = { filter: "upcoming" };

function Events() {
  const { api, session } = useApp();
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [query, setQuery] = useQueryState(DEFAULTS);
  const filter = oneOf(query.filter, IDS, "upcoming");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api.listEvents().then(
      (list) => !cancelled && (setEvents(list), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load events. Check your connection and try again.")),
    );
    return () => {
      cancelled = true;
    };
  }, [api, session, attempt]);

  const hold = useSkeletonGate(events === null && !error);
  const shown = events?.filter((event) => classify(event) === filter) ?? [];
  const label = FILTERS.find((item) => item.id === filter)!.label;

  return (
    <Shell title="Events" subtitle="Everything your company can see in the DIP app." requires="events.manage" action={<Button variant="primary" href="/events/new/">New event</Button>}>
      {error ? <LoadError error={error} onRetry={() => setAttempt((n) => n + 1)} />
        : events === null || hold ? <Loading label="Loading events" layout="events" />
        : (
          <>
            <Tabs idBase="events" label="Filter events" value={filter} onChange={(id) => setQuery({ filter: id })}
              items={FILTERS.map((item) => ({ id: item.id, label: item.label, count: events.filter((event) => classify(event) === item.id).length }))} />
            <div {...tabPanelProps("events", filter)}>
              {shown.length === 0 ? (
                <Empty title={`No ${label.toLowerCase()} events`} body={EMPTY_BODY[filter]} />
              ) : (
                <EventTable>{shown.map((event) => <EventCard key={event.id} event={event} />)}</EventTable>
              )}
            </div>
          </>
        )}
    </Shell>
  );
}

export default function EventsPage() {
  return <Suspense fallback={<Loading label="Loading events" layout="events" />}><Events /></Suspense>;
}
