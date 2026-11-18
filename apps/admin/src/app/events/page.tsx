"use client";
// @i18n-migrated

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
import { t } from "@/lib/i18n";

type Filter = "upcoming" | "past" | "cancelled";
const FILTERS = [
  { id: "upcoming", labelKey: "events.filter.upcoming", emptyTitleKey: "events.list.empty.upcoming.title", emptyBodyKey: "events.list.empty.upcoming.body" },
  { id: "past", labelKey: "events.filter.past", emptyTitleKey: "events.list.empty.past.title", emptyBodyKey: "events.list.empty.past.body" },
  { id: "cancelled", labelKey: "events.filter.cancelled", emptyTitleKey: "events.list.empty.cancelled.title", emptyBodyKey: "events.list.empty.cancelled.body" },
] as const satisfies readonly { id: Filter; labelKey: string; emptyTitleKey: string; emptyBodyKey: string }[];
const IDS = FILTERS.map((item) => item.id);
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
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("events.list.loadFailed"))),
    );
    return () => {
      cancelled = true;
    };
  }, [api, session, attempt]);

  const hold = useSkeletonGate(events === null && !error);
  const shown = events?.filter((event) => classify(event) === filter) ?? [];
  const active = FILTERS.find((item) => item.id === filter)!;

  return (
    <Shell title={t("events.list.title")} subtitle={t("events.list.subtitle")} requires="events.manage" action={<Button variant="primary" href="/events/new/">{t("events.list.new")}</Button>}>
      {error ? <LoadError error={error} onRetry={() => setAttempt((n) => n + 1)} />
        : events === null || hold ? <Loading label={t("events.list.loading")} layout="events" />
        : (
          <>
            <Tabs idBase="events" label={t("events.list.filterLabel")} value={filter} onChange={(id) => setQuery({ filter: id })}
              items={FILTERS.map((item) => ({ id: item.id, label: t(item.labelKey), count: events.filter((event) => classify(event) === item.id).length }))} />
            <div {...tabPanelProps("events", filter)}>
              {shown.length === 0 ? (
                <Empty title={t(active.emptyTitleKey)} body={t(active.emptyBodyKey)} />
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
  return <Suspense fallback={<Loading label={t("events.list.loading")} layout="events" />}><Events /></Suspense>;
}
