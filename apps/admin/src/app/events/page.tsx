"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { EventCard, EventTable } from "@/components/EventCard";
import { can } from "@/lib/adminTypes";
import { Shell } from "@/components/Shell";
import { ApiError, type AdminEvent, classify } from "@/lib/contract";

type Filter = "upcoming" | "past" | "cancelled";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
];

export default function EventsPage() {
  const { api, session } = useApp();
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api.listEvents().then(
      (list) => !cancelled && (setEvents(list), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load events.")),
    );
    return () => {
      cancelled = true;
    };
  }, [api, session, attempt]);

  const shown = events?.filter((event) => classify(event) === filter) ?? [];

  return (
    <Shell title="Events" subtitle="Everything your company can see in the DIP app." action={can(session?.role, "events.manage") ? <Link className="pill-btn purple" href="/events/new/">New event</Link> : undefined}>
      {error?.code === "permission-denied" ? (
        <div className="empty" role="alert">
          <h2>No organizer access</h2>
          <p>Your account can use DIP, but it isn’t an organizer for your company. Ask a company admin to assign the organizer role, then sign in again.</p>
        </div>
      ) : error ? (
        <div className="banner error" role="alert">
          <span>{error.message}</span>
          <button className="pill-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : events === null ? (
        <div className="skeleton-list" role="status" aria-label="Loading events"><div className="skeleton short" /><div className="skeleton short" /><div className="skeleton short" /></div>
      ) : (
        <>
          <div className="tabs" role="group" aria-label="Filter events">
            {FILTERS.map((item) => (
              <button key={item.id} className="tab" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label} ({events.filter((event) => classify(event) === item.id).length})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="empty">
              <h2>No {filter} events</h2>
              <p>{filter === "upcoming" ? "Create an event to give your team something to join." : "Nothing here yet."}</p>
            </div>
          ) : (
            <EventTable>{shown.map((event) => <EventCard key={event.id} event={event} />)}</EventTable>
          )}
        </>
      )}
    </Shell>
  );
}
