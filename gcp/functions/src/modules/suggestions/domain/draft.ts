import type { GeneratedEventDraft } from "../../../generated/models";
import { lexicalTop } from "../../covers/domain/shortlist";
import type { IdeaTemplate } from "./catalog";

const RATIONALE_MAX = 160;

/** Cuts at a word boundary and ends with an ellipsis when over the limit. */
function cleanTruncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:.]+$/, "")}…`;
}

function costNote(costCents: number): string {
  if (costCents === 0) return "";
  const dollars = costCents / 100;
  return `About $${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)} per person`;
}

/**
 * The editor prefill for a catalog idea. Venue and exact time stay with the admin. The cover is the deterministic best
 * match from the cover library (no model; `excludeCovers` keeps a batch from reusing one), else the idea's legacy category image.
 */
export function ideaToDraft(idea: IdeaTemplate, rationale: string, memberCount: number | null, excludeCovers: readonly string[] = []): GeneratedEventDraft {
  const capacity = memberCount === null ? idea.groupMax : Math.max(1, Math.min(idea.groupMax, memberCount));
  return {
    title: idea.title,
    description: idea.description,
    tagIds: [...idea.tagIds],
    coverImageURL: lexicalTop({ title: idea.title, description: idea.description, tagIds: idea.tagIds, exclude: excludeCovers })?.entry.url ?? `catalog://default/${idea.coverCategory}`,
    suggestedDaypart: idea.dayparts[0]!,
    durationMinutes: idea.durationMinutes,
    venueType: idea.venueType,
    venueSearchHint: idea.venueSearchHint,
    costCents: idea.costCents,
    costNote: costNote(idea.costCents),
    capacity,
    isOutdoor: idea.isOutdoor,
    rationale: cleanTruncate(rationale, RATIONALE_MAX) || cleanTruncate(idea.pitch, RATIONALE_MAX),
  };
}
