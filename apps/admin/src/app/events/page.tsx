"use client";
// @i18n-migrated

import { Suspense } from "react";
import { useLoad } from "@/components/useLoad";
import { EventCard, type EventSortKey, EventTable } from "@/components/EventCard";
import { Shell } from "@/components/Shell";
import { Tabs, tabPanelProps } from "@/components/Tabs";
import { Empty, LoadError, Loading, ResultCount, SearchBox } from "@/components/Ui";
import { ApiError, type AdminEvent, classify } from "@/lib/contract";
import { oneOf, useQueryState } from "@/lib/useQueryState";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, SortSelect, sortRows, useTableSort } from "@/components/kit";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { t } from "@/lib/i18n";

type Filter = "upcoming" | "past" | "cancelled";
const FILTERS = [
  { id: "upcoming", labelKey: "events.filter.upcoming", emptyTitleKey: "events.list.empty.upcoming.title", emptyBodyKey: "events.list.empty.upcoming.body" },
  { id: "past", labelKey: "events.filter.past", emptyTitleKey: "events.list.empty.past.title", emptyBodyKey: "events.list.empty.past.body" },
  { id: "cancelled", labelKey: "events.filter.cancelled", emptyTitleKey: "events.list.empty.cancelled.title", emptyBodyKey: "events.list.empty.cancelled.body" },
] as const satisfies readonly { id: Filter; labelKey: string; emptyTitleKey: string; emptyBodyKey: string }[];
const IDS = FILTERS.map((item) => item.id);
const DEFAULTS = { filter: "upcoming", q: "" };
const SORT_KEYS = ["when", "title", "going", "price"] as const satisfies readonly EventSortKey[];
const fill = (event: AdminEvent) => (event.capacity > 0 ? event.attendeeCount / event.capacity : 0);
const SORT_VALUE: Record<EventSortKey, (event: AdminEvent) => string | number> = {
  when: (event) => Date.parse(event.startTime), title: (event) => event.title, going: fill, price: (event) => event.costCents,
};

function Events() {
  // Cached for the session: coming back to Events shows the list at once and refreshes it behind the scenes.
  const list = useLoad((a) => a.listEvents().catch((failure: unknown) => {
    throw failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("events.list.loadFailed"));
  }), "events.list");
  const events = list.data;
  const error = list.error;
  const [query, setQuery] = useQueryState(DEFAULTS);
  const filter = oneOf(query.filter, IDS, "upcoming");
  const search = query.q;
  useSlashFocus("events-search");
  // Upcoming reads soonest first; past and canceled newest first. Each tab remembers its own choice.
  const sort = useTableSort<EventSortKey>(`events-${filter}`, SORT_KEYS, { key: "when", dir: filter === "upcoming" ? "asc" : "desc" }, { when: filter === "upcoming" ? "asc" : "desc", going: "desc", price: "desc" });

  const hold = useSkeletonGate(events === null && !error);
  const inTab = events?.filter((event) => classify(event) === filter) ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const matches = needle ? inTab.filter((event) => `${event.title} ${event.description} ${event.venue.name} ${event.venue.locality}`.toLocaleLowerCase().includes(needle)) : inTab;
  const shown = sortRows(matches, SORT_VALUE[sort.key], sort.dir);
  const active = FILTERS.find((item) => item.id === filter)!;

  return (
    <Shell title={t("events.list.title")} subtitle={t("events.list.subtitle")} requires="events.manage" action={<Button variant="primary" href="/events/new/">{t("events.list.new")}</Button>}>
      {error ? <LoadError error={error} onRetry={list.reload} />
        : events === null || hold ? <Loading label={t("events.list.loading")} layout="events" />
        : (
          <>
            <Tabs idBase="events" label={t("events.list.filterLabel")} value={filter} onChange={(id) => setQuery({ filter: id })}
              items={FILTERS.map((item) => ({ id: item.id, label: t(item.labelKey), count: events.filter((event) => classify(event) === item.id).length }))} />
            <div {...tabPanelProps("events", filter)}>
              {inTab.length > 0 && (
                <div className="list-toolbar">
                  <SearchBox shortcut id="events-search" value={search} onChange={(v) => setQuery({ q: v })} label={t("events.list.search.label")} placeholder={t("events.list.search.placeholder")} />
                  <SortSelect id="events-sort" sort={sort} options={[
                    { key: "when", dir: filter === "upcoming" ? "asc" : "desc", label: t(filter === "upcoming" ? "events.sort.soonest" : "events.sort.newest") },
                    { key: "going", dir: "desc", label: t("events.sort.mostGoing") },
                    { key: "price", dir: "asc", label: t("events.sort.cheapest") },
                    { key: "title", dir: "asc", label: t("events.sort.title") },
                  ]} />
                  {needle && <ResultCount>{t("events.list.matches", { shown: shown.length, total: inTab.length })}</ResultCount>}
                </div>
              )}
              {inTab.length === 0 ? (
                <Empty title={t(active.emptyTitleKey)} body={t(active.emptyBodyKey)} />
              ) : shown.length === 0 ? (
                <Empty title={t("events.list.noMatches.title")} body={t("events.list.noMatches.body")} action={<Button onClick={() => setQuery({ q: "" })}>{t("events.list.clearSearch")}</Button>} />
              ) : (
                <EventTable sort={sort}>{shown.map((event) => <EventCard key={event.id} event={event} />)}</EventTable>
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
