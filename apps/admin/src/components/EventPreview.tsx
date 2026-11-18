// @i18n-migrated
import { type EventDraft } from "@/lib/contract";
import { t } from "@/lib/i18n";
import { dollarsToCents } from "@/lib/datetime";
import { formatDuration, formatPrice, formatWhen } from "@/lib/contract";
import { Cover } from "./Cover";
import { DipbotCoverTag } from "./DipbotCoverTag";

/** Live preview of how the event reads in the app: photo, title, key details. */
export function EventPreview({ draft, price, dipbotCover = false }: { draft: EventDraft; price: string; dipbotCover?: boolean }) {
  const start = Date.parse(draft.startTime);
  const cents = dollarsToCents(price);
  return (
    <aside className="preview" aria-label={t("events.preview.label")}>
      <p className="preview-label">{t("events.preview.label")}</p>
      <div className="preview-card">
        <div className="cover-with-tag">
          <Cover url={draft.coverImageURL} className="photo" eager />
          {dipbotCover && <DipbotCoverTag />}
        </div>
        <div className="details">
          <h2>{draft.title.trim() || t("events.preview.titlePlaceholder")}</h2>
          <dl>
            <div><dt>{t("events.preview.when")}</dt><dd>{Number.isNaN(start) ? t("events.preview.pickStart") : <><span className="line">{formatWhen(draft.startTime, draft.endTime)}</span>{formatDuration(draft.startTime, draft.endTime) && <span className="line muted">{formatDuration(draft.startTime, draft.endTime)}</span>}</>}</dd></div>
            <div><dt>{t("events.preview.where")}</dt><dd><span className="line">{draft.venue.name.trim() || t("events.preview.addVenue")}</span>{(draft.venue.address.trim() || draft.venue.locality.trim()) && <span className="line muted">{[draft.venue.address.trim(), draft.venue.locality.trim()].filter(Boolean).join(", ")}</span>}</dd></div>
            <div><dt>{t("events.preview.price")}</dt><dd>{Number.isNaN(cents) ? t("events.preview.notSet") : formatPrice(cents)}</dd></div>
            <div><dt>{t("events.preview.spots")}</dt><dd>{Number.isNaN(draft.capacity) ? t("events.preview.notSet") : draft.capacity}</dd></div>
          </dl>
        </div>
      </div>
    </aside>
  );
}
