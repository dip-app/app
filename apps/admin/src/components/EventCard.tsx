import Link from "next/link";
import { type AdminEvent, classify, formatDuration, formatPrice, formatWhen } from "@/lib/contract";
import { Cover } from "./Cover";

/** Large photo on the left, details on the right, on a solid neutral card. */
export function EventCard({ event }: { event: AdminEvent }) {
  const kind = classify(event);
  const full = kind === "upcoming" && event.attendeeCount >= event.capacity;
  const when = formatWhen(event.startTime, event.endTime);
  const duration = formatDuration(event.startTime, event.endTime);
  const label = kind === "cancelled" ? "Cancelled" : kind === "past" ? "Past" : full ? "Full" : "Upcoming";
  return (
    <div className="card-cell">
    <article className={`event-card ${kind}`} data-testid="event-card">
      <Cover url={event.coverImageURL} className="photo" />
      <Link className="edit-icon" href={`/events/edit/?id=${encodeURIComponent(event.id)}`} aria-label={`Edit ${event.title}`} title="Edit event">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16.9 3.6a2.2 2.2 0 0 1 3.1 3.1L8.4 18.3 3.5 19.5l1.2-4.9L16.9 3.6Z" />
          <path d="m15 5.5 3.5 3.5" />
        </svg>
      </Link>
      <div className="details">
        <span className="status-pill">{label}</span>
        <h2>{event.title}</h2>
        <p className="blurb">{event.description}</p>
        <dl>
          <div><dt>When</dt><dd><span className="line">{when}</span><span className="line muted">{duration}</span></dd></div>
          <div><dt>Where</dt><dd><span className="line">{event.venue.name}</span><span className="line muted">{event.venue.address}, {event.venue.locality}</span></dd></div>
          <div><dt>Price</dt><dd>{formatPrice(event.costCents)}</dd></div>
          <div><dt>Going</dt><dd>{event.attendeeCount} of {event.capacity}</dd></div>
        </dl>
        <div className="card-links">
          <Link className="pill-btn dark small" href={`/events/attendees/?id=${encodeURIComponent(event.id)}`}>Attendees</Link>
          {kind === "past" && <Link className="pill-btn dark small" href={`/events/album/?id=${encodeURIComponent(event.id)}`}>Album</Link>}
        </div>
      </div>
    </article>
    </div>
  );
}
