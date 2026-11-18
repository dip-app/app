import { type EventDraft } from "@/lib/contract";
import { dollarsToCents } from "@/lib/datetime";
import { formatDuration, formatPrice, formatWhen } from "@/lib/contract";
import { Cover } from "./Cover";
import { DipbotCoverTag } from "./DipbotCoverTag";

/** Live preview of how the event reads in the app: photo, title, key details. */
export function EventPreview({ draft, price, dipbotCover = false }: { draft: EventDraft; price: string; dipbotCover?: boolean }) {
  const start = Date.parse(draft.startTime);
  const cents = dollarsToCents(price);
  return (
    <aside className="preview" aria-label="Preview">
      <p className="preview-label">Preview</p>
      <div className="preview-card">
        <div className="cover-with-tag">
          <Cover url={draft.coverImageURL} className="photo" eager />
          {dipbotCover && <DipbotCoverTag />}
        </div>
        <div className="details">
          <h2>{draft.title.trim() || "Event title"}</h2>
          <dl>
            <div><dt>When</dt><dd>{Number.isNaN(start) ? "Pick a start time" : <><span className="line">{formatWhen(draft.startTime, draft.endTime)}</span>{formatDuration(draft.startTime, draft.endTime) && <span className="line muted">{formatDuration(draft.startTime, draft.endTime)}</span>}</>}</dd></div>
            <div><dt>Where</dt><dd><span className="line">{draft.venue.name.trim() || "Add a venue"}</span>{(draft.venue.address.trim() || draft.venue.locality.trim()) && <span className="line muted">{[draft.venue.address.trim(), draft.venue.locality.trim()].filter(Boolean).join(", ")}</span>}</dd></div>
            <div><dt>Price</dt><dd>{Number.isNaN(cents) ? "Not set" : formatPrice(cents)}</dd></div>
            <div><dt>Spots</dt><dd>{Number.isNaN(draft.capacity) ? "Not set" : draft.capacity}</dd></div>
          </dl>
        </div>
      </div>
    </aside>
  );
}
