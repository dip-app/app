// @i18n-migrated
// Pure helpers for the saved company suggestions (getEventIdeaSuggestionsV1 cacheStatus): the "Updated 3 days ago" line.

import type { EventIdeaSuggestions } from "./adminTypes";
import { t, tn } from "./aiStrings";

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". An unreadable or future time reads "just now". */
export function relativeAgo(iso: string | undefined, now: Date): string {
  const at = iso ? new Date(iso).getTime() : NaN;
  const minutes = Number.isFinite(at) ? Math.floor((now.getTime() - at) / 60_000) : 0;
  if (minutes < 1) return t("suggest.when.now");
  if (minutes < 60) return tn("suggest.when.minutes", minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tn("suggest.when.hours", hours);
  return tn("suggest.when.days", Math.floor(hours / 24));
}

export interface FreshnessLine {
  text: string;
  stale: boolean;
  /** Short "New data available" note, only when the saved answer is stale because the underlying data changed. */
  hint?: string;
}

/**
 * The quiet line under the suggestions, or null when there is nothing saved to describe (a free heuristic answer, or no
 * data). Stale because of new data says so; stale only by age just says when it was updated.
 */
export function freshnessLine(s: EventIdeaSuggestions, now: Date): FreshnessLine | null {
  const saved = s.cacheStatus !== "computed" || s.provider === "jev" || s.provider === "openai";
  if (!saved || !s.computedAt) return null;
  const when = relativeAgo(s.computedAt, now);
  if (s.cacheStatus === "stale" && s.staleReason !== "age") return { text: t("suggest.updated", { when }), stale: true, hint: t("suggest.newData") };
  return { text: t("suggest.updated", { when }), stale: s.cacheStatus === "stale" };
}
