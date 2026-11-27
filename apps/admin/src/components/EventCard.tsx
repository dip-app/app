// @i18n-migrated
import Link from "next/link";
import { type AdminEvent, classify, formatDuration, formatPrice, formatWhen } from "@/lib/contract";
import { formatDate, formatTime, t } from "@/lib/i18n";
import { Cover } from "./Cover";
import { TableRegion } from "./TableRegion";
import { Button, Chip, RelativeTime, SortHeader, type TableSort } from "@/components/kit";

export type EventSortKey = "when" | "title" | "going" | "price";

/** Day on the first line ("Thu, Dec 10"), times and length on the second ("9:00 AM to 1:00 PM · 4 hr"). Never wraps inside a value. */
function WhenCell({ event, upcoming }: { event: AdminEvent; upcoming: boolean }) {
  const start = new Date(event.startTime), end = new Date(event.endTime);
  const sameDay = start.toDateString() === end.toDateString();
  const duration = formatDuration(event.startTime, event.endTime);
  if (!sameDay || Number.isNaN(end.getTime())) {
    return <><span className="line">{formatWhen(event.startTime, event.endTime)}</span><span className="line muted">{duration}</span></>;
  }
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return (
    <>
      <span className="line nowrap">{formatDate(start, { weekday: "short", month: "short", day: "numeric" })}{upcoming && <span className="muted"> · <RelativeTime iso={event.startTime} /></span>}</span>
      <span className="line muted nowrap">{t("events.row.timeRange", { from: formatTime(start, time), to: formatTime(end, time) })} · {duration}</span>
    </>
  );
}

/** One compact table row per event: small thumbnail, title, when, where, price, going (with Full) and row actions. Rendered inside `EventTable`. */
export function EventCard({ event }: { event: AdminEvent }) {
  const kind = classify(event);
  const full = kind === "upcoming" && event.capacity > 0 && event.attendeeCount >= event.capacity;
  const pct = event.capacity > 0 ? Math.min(100, Math.round((event.attendeeCount / event.capacity) * 100)) : 0;
  return (
    <tr className={`event-row ${kind}`} data-testid="event-card">
      <td className="cell-main">
        <div className="media-cell">
          <Cover url={event.coverImageURL} className="thumb" />
          <div className="media-text">
            <Link className="row-title" href={`/events/edit/?id=${encodeURIComponent(event.id)}`} tabIndex={-1}>{event.title}</Link>
            <span className="muted clamp-1">{event.description}</span>
            {/* Phones: the row is one card; this line carries the facts the hidden cells show on wider screens. */}
            <span className="person-sub">
              <span>{formatDate(new Date(event.startTime), { weekday: "short", month: "short", day: "numeric" })}, {formatTime(new Date(event.startTime), { hour: "numeric", minute: "2-digit" })}</span>
              <span>{event.venue.name}</span>
              <span>{formatPrice(event.costCents)}</span>
              <span>{t("events.row.going", { count: event.attendeeCount, capacity: event.capacity })}</span>
              {full && <Chip>{t("events.status.full")}</Chip>}
            </span>
          </div>
        </div>
      </td>
      <td className="phone-hide" data-label={t("events.table.when")}><WhenCell event={event} upcoming={kind === "upcoming"} /></td>
      <td className="where-cell phone-hide" data-label={t("events.table.where")}><span className="line" title={event.venue.name}>{event.venue.name}</span><span className="line muted" title={event.venue.locality}>{event.venue.locality}</span></td>
      <td className="num phone-hide" data-label={t("events.table.price")}>{formatPrice(event.costCents)}</td>
      <td className="num phone-hide" data-label={t("events.table.going")}>
        <div className="going">
          <span className="going-count" aria-label={t("events.row.going", { count: event.attendeeCount, capacity: event.capacity })}>{event.attendeeCount} / {event.capacity}</span>
          <span className="going-bar">{full && <Chip>{t("events.status.full")}</Chip>}<span className="meter-mini" aria-hidden><span style={{ width: `${pct}%` }} /></span></span>
        </div>
      </td>
      <td className="right">
        <span className="row-actions">
          <Button size="sm" href={`/events/attendees/?id=${encodeURIComponent(event.id)}`} aria-label={t("events.row.attendeesLabel", { title: event.title })}>{t("events.row.attendees")}</Button>
          {kind === "past" && <Button size="sm" href={`/events/album/?id=${encodeURIComponent(event.id)}`} aria-label={t("events.row.albumLabel", { title: event.title })}>{t("events.row.album")}</Button>}
          <Button size="sm" href={`/events/edit/?id=${encodeURIComponent(event.id)}`} aria-label={t("events.row.editLabel", { title: event.title })}>{t("events.row.edit")}</Button>
        </span>
      </td>
    </tr>
  );
}

export function EventTable({ sort, children }: { sort?: TableSort<EventSortKey>; children: React.ReactNode }) {
  const head = (key: EventSortKey, label: string, align?: "right") => sort
    ? <SortHeader column={key} sort={sort} align={align}>{label}</SortHeader>
    : <th scope="col" className={align === "right" ? "num" : undefined}>{label}</th>;
  return (
    <TableRegion label={t("events.table.label")}>
      <table className="table responsive events-table sticky-actions compact-table">
        <caption className="sr-only">{t("events.table.label")}</caption>
        <thead><tr>{head("title", t("events.table.event"))}{head("when", t("events.table.when"))}<th scope="col">{t("events.table.where")}</th>{head("price", t("events.table.price"), "right")}{head("going", t("events.table.going"), "right")}<th scope="col"><span className="sr-only">{t("events.table.actions")}</span></th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </TableRegion>
  );
}
