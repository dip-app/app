"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { EventCard } from "@/components/EventCard";
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
  }, [api, session]);

  const shown = events?.filter((event) => classify(event) === filter) ?? [];

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Events</h1>
          <p>Everything your company can see in the DIP app.</p>
        </div>
        {session?.role === "admin" && (
          <Link className="btn" href="/events/new/">
            New event
          </Link>
        )}
      </div>
      {error ? (
        <div className="banner error" role="alert">
          <span>{error.message}</span>
        </div>
      ) : events === null ? (
        <p role="status">Loading…</p>
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
            <div className="cards">{shown.map((event) => <EventCard key={event.id} event={event} />)}</div>
          )}
        </>
      )}
    </Shell>
  );
}
