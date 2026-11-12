import Link from "next/link";
import { type AdminEvent, classify, formatDuration, formatPrice, formatWhen } from "@/lib/contract";
import { Cover } from "./Cover";

/** One compact table row per event: small thumbnail, title, when, where, price, going and row actions. Rendered inside `EventTable`. */
export function EventCard({ event }: { event: AdminEvent }) {
  const kind = classify(event);
  const full = kind === "upcoming" && event.attendeeCount >= event.capacity;
  const when = formatWhen(event.startTime, event.endTime);
  const duration = formatDuration(event.startTime, event.endTime);
  const label = kind === "cancelled" ? "Cancelled" : kind === "past" ? "Past" : full ? "Full" : "Upcoming";
  const tone = kind === "cancelled" ? "warn" : kind === "upcoming" && !full ? "ok" : "";
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
      <td data-label="When"><span className="line">{when}</span><span className="line muted">{duration}</span></td>
      <td data-label="Where"><span className="line">{event.venue.name}</span><span className="line muted">{event.venue.locality}</span></td>
      <td className="num" data-label="Price">{formatPrice(event.costCents)}</td>
      <td className="num" data-label="Going"><div className="going"><span aria-label={`${event.attendeeCount} of ${event.capacity} going`}>{event.attendeeCount} / {event.capacity}</span><span className="meter-mini" aria-hidden><span style={{ width: `${pct}%` }} /></span></div></td>
      <td data-label="Status"><span className={`info-pill${tone ? ` ${tone}` : ""}`}>{label}</span></td>
      <td className="right">
        <span className="row-actions">
          <Link className="pill-btn gray small" href={`/events/attendees/?id=${encodeURIComponent(event.id)}`}>Attendees</Link>
          {kind === "past" && <Link className="pill-btn gray small" href={`/events/album/?id=${encodeURIComponent(event.id)}`}>Album</Link>}
          <Link className="pill-btn gray small" href={`/events/edit/?id=${encodeURIComponent(event.id)}`} aria-label={`Edit ${event.title}`}>Edit</Link>
        </span>
      </td>
    </tr>
  );
}

export function EventTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="table responsive events-table">
        <caption className="sr-only">Events</caption>
        <thead><tr><th scope="col">Event</th><th scope="col">When</th><th scope="col">Where</th><th scope="col" className="num">Price</th><th scope="col" className="num">Going</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
