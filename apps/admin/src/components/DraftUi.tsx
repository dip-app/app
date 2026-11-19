"use client";
// @i18n-migrated

import type { DraftStatus } from "@/lib/useFormDraft";
import { Button, InlineNotice } from "@/components/kit";
import { relativeAgo } from "@/lib/formDraft";
import { intlLocale, t } from "@/lib/i18n";

/** "5 minutes ago" or "a moment ago", in the portal's language. */
export function agoText(savedAt: number, now: number = Date.now()): string {
  return relativeAgo(savedAt, now, intlLocale()) ?? t("drafts.agoNow");
}

/**
 * The calm banner on a new form that has a draft waiting: what it is, when it was saved, Restore or Start fresh.
 * `replaces` is the variant for a page that already has content (a Dipbot draft opened here, or edits made since): the older
 * draft is offered without taking anything away until the admin asks.
 */
export function DraftOffer({ kind, ago, replaces, onRestore, onDiscard }: {
  kind: "event" | "theme";
  ago: string;
  replaces: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <InlineNotice className="draft-offer" aria-live="polite">
      <p className="draft-offer-text">{replaces ? t("drafts.offer.replaces", { ago }) : t(kind === "event" ? "drafts.offer.event" : "drafts.offer.theme", { ago })}</p>
      <div className="draft-offer-actions">
        <Button variant="outline" onClick={onRestore}>{t("drafts.restore")}</Button>
        <Button variant="plain" onClick={onDiscard}>{replaces ? t("drafts.deleteOld") : t("drafts.startFresh")}</Button>
      </div>
    </InlineNotice>
  );
}

/** A quiet line beside the form's buttons. Silent until the first save; the text then stays, so a screen reader hears it once. */
export function DraftStatusLine({ status }: { status: DraftStatus }) {
  const text = status === "saved" ? t("drafts.status.saved")
    : status === "unavailable" ? t("drafts.status.unavailable")
    : status === "too-large" ? t("drafts.status.tooLarge")
    : status === "other-tab" ? t("drafts.status.otherTab") : "";
  const problem = status === "unavailable" || status === "too-large";
  return (
    <p className={`draft-status${problem ? " problem" : ""}`} role="status" aria-live="polite">{text}</p>
  );
}
