import Link from "next/link";
import { type AdminEvent, classify, formatPrice } from "@/lib/contract";
import { Cover } from "./Cover";

export function EventCard({ event }: { event: AdminEvent }) {
  const kind = classify(event);
  const full = kind === "upcoming" && event.attendeeCount >= event.capacity;
  const when = new Date(event.startTime).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return (
    <article className="event-card" data-testid="event-card">
      <Cover url={event.coverImageURL} className="cover" />
      <div>
        <h2>{event.title}</h2>
        <div className="meta">
          <span>{when}</span>
          <span>{event.venue.name} · {event.venue.locality}</span>
          <span>{formatPrice(event.costCents)}</span>
        </div>
      </div>
      <div className="side">
        <span>
          <span className={`pill ${kind}`}>{kind === "upcoming" ? "Upcoming" : kind === "past" ? "Past" : "Cancelled"}</span>{" "}
          {full && <span className="pill full">Full</span>}
        </span>
        <span className="meta">{event.attendeeCount} / {event.capacity} going</span>
        <Link className="btn ghost" href={`/events/edit/?id=${encodeURIComponent(event.id)}`}>
          Edit
        </Link>
      </div>
    </article>
  );
}
