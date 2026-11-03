import { type EventDraft } from "@/lib/contract";
import { dollarsToCents } from "@/lib/datetime";
import { formatPrice } from "@/lib/contract";
import { Cover } from "./Cover";

/** Live preview of how the event reads in the app: photo, title, key details. */
export function EventPreview({ draft, price }: { draft: EventDraft; price: string }) {
  const start = Date.parse(draft.startTime);
  const cents = dollarsToCents(price);
  return (
    <aside className="preview" aria-label="Preview">
      <p className="preview-label">Preview</p>
      <div className="preview-card">
        <Cover url={draft.coverImageURL} className="photo" eager />
        <div className="details">
          <h2>{draft.title.trim() || "Event title"}</h2>
          <dl>
            <div><dt>When</dt><dd>{Number.isNaN(start) ? "Pick a start time" : new Date(start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd></div>
            <div><dt>Where</dt><dd>{draft.venue.name.trim() || "Add a venue"}{draft.venue.locality.trim() ? ` · ${draft.venue.locality.trim()}` : ""}</dd></div>
            <div><dt>Price</dt><dd>{Number.isNaN(cents) ? "—" : formatPrice(cents)}</dd></div>
            <div><dt>Spots</dt><dd>{Number.isNaN(draft.capacity) ? "—" : draft.capacity}</dd></div>
          </dl>
        </div>
      </div>
    </aside>
  );
}
