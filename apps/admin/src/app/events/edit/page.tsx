"use client";
// @i18n-migrated

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { EventForm } from "@/components/EventForm";
import Link from "next/link";
import { Shell, useShellHeader } from "@/components/Shell";
import { LoadError, Loading } from "@/components/Ui";
import { ApiError, type AdminEvent, classify, formatWhen } from "@/lib/contract";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { t } from "@/lib/i18n";

const noEvent = () => new ApiError("not-found", t("events.edit.noneSelected"));

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
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("events.edit.loadFailed"))),
    );
    return () => { cancelled = true; };
  }, [api, session, id, version]);

  const reload = useCallback(() => { setEvent(null); setVersion((v) => v + 1); }, []);
  // The header names the event as it was loaded (the form below edits the title) and links to its people and photos.
  useShellHeader(event ? {
    title: event.title, metaKey: `${event.id}|${event.revision}`,
    meta: <>
      <span>{formatWhen(event.startTime, event.endTime)}</span>
      <span>{t("events.row.going", { count: event.attendeeCount, capacity: event.capacity })} · <Link href={`/events/attendees/?id=${encodeURIComponent(event.id)}`} className="inline-link">{t("events.row.attendees")}</Link></span>
      {classify(event) === "past" && <Link href={`/events/album/?id=${encodeURIComponent(event.id)}`} className="inline-link">{t("events.row.album")}</Link>}
    </>,
  } : null);

  const hold = useSkeletonGate(Boolean(id) && !event && !error);
  if (!id) return <LoadError error={noEvent()} onRetry={reload} backHref="/events/" backLabel={t("events.edit.backToEvents")} />;
  if (error) return <LoadError error={error} onRetry={reload} backHref="/events/" backLabel={t("events.edit.backToEvents")} />;
  if (!event || hold) return <Loading label={t("events.edit.loading")} layout="form" />;
  return <EventForm key={`${event.id}-${event.revision}`} event={event} onReload={reload} />;
}

export default function EditEventPage() {
  return (
    <Shell title={t("events.edit.title")} subtitle={t("events.edit.subtitle")} requires="events.manage" back={{ href: "/events/", label: t("shell.nav.events") }}>
      <Suspense fallback={<Loading label={t("events.edit.loading")} layout="form" />}><Editor /></Suspense>
    </Shell>
  );
}
