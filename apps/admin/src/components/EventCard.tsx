// @i18n-migrated
import Link from "next/link";
import { type AdminEvent, classify, formatDuration, formatPrice, formatWhen } from "@/lib/contract";
import { t } from "@/lib/i18n";
import { Cover } from "./Cover";
import { TableRegion } from "./TableRegion";
import { Button, Chip } from "@/components/kit";

/** One compact table row per event: small thumbnail, title, when, where, price, going and row actions. Rendered inside `EventTable`. */
export function EventCard({ event }: { event: AdminEvent }) {
  const kind = classify(event);
  const full = kind === "upcoming" && event.attendeeCount >= event.capacity;
  const when = formatWhen(event.startTime, event.endTime);
  const duration = formatDuration(event.startTime, event.endTime);
  const label = kind === "cancelled" ? t("events.status.canceled") : kind === "past" ? t("events.status.past") : full ? t("events.status.full") : t("events.status.upcoming");
  const tone = kind === "cancelled" ? "warn" : kind === "upcoming" && !full ? "ok" : undefined;
  const pct = event.capacity > 0 ? Math.min(100, Math.round((event.attendeeCount / event.capacity) * 100)) : 0;
  return (
    <tr className={`event-row ${kind}`} data-testid="event-card">
      <td className="cell-main">
        <div className="media-cell">
          <Cover url={event.coverImageURL} className="thumb" />
          <div className="media-text">
            <Link className="row-title" href={`/events/edit/?id=${encodeURIComponent(event.id)}`} tabIndex={-1}>{event.title}</Link>
            <span className="muted clamp-1">{event.description}</span>
          </div>
        </div>
      </td>
      <td data-label={t("events.table.when")}><span className="line">{when}</span><span className="line muted">{duration}</span></td>
      <td data-label={t("events.table.where")}><span className="line">{event.venue.name}</span><span className="line muted">{event.venue.locality}</span></td>
      <td className="num" data-label={t("events.table.price")}>{formatPrice(event.costCents)}</td>
      <td className="num" data-label={t("events.table.going")}><div className="going"><span aria-label={t("events.row.going", { count: event.attendeeCount, capacity: event.capacity })}>{event.attendeeCount} / {event.capacity}</span><span className="meter-mini" aria-hidden><span style={{ width: `${pct}%` }} /></span></div></td>
      <td data-label={t("events.table.status")}><Chip tone={tone}>{label}</Chip></td>
      <td className="right">
        <span className="row-actions">
          <Button size="sm" href={`/events/attendees/?id=${encodeURIComponent(event.id)}`}>{t("events.row.attendees")}</Button>
          {kind === "past" && <Button size="sm" href={`/events/album/?id=${encodeURIComponent(event.id)}`}>{t("events.row.album")}</Button>}
          <Button size="sm" href={`/events/edit/?id=${encodeURIComponent(event.id)}`} aria-label={t("events.row.editLabel", { title: event.title })}>{t("events.row.edit")}</Button>
        </span>
      </td>
    </tr>
  );
}

export function EventTable({ children }: { children: React.ReactNode }) {
  return (
    <TableRegion label={t("events.table.label")}>
      <table className="table responsive events-table">
        <caption className="sr-only">{t("events.table.label")}</caption>
        <thead><tr><th scope="col">{t("events.table.event")}</th><th scope="col">{t("events.table.when")}</th><th scope="col">{t("events.table.where")}</th><th scope="col" className="num">{t("events.table.price")}</th><th scope="col" className="num">{t("events.table.going")}</th><th scope="col">{t("events.table.status")}</th><th scope="col"><span className="sr-only">{t("events.table.actions")}</span></th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </TableRegion>
  );
}
