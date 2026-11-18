// Pure view logic for the preference chips ("considerations") on the last step: which chips are shown up front, how the
// full list is grouped and searched. No React and no network, so it is unit tested directly. The ranking comes from the
// saved company suggestions; the admin's choices so far only reorder it locally (no model call per click).

import type { AiConsiderationRank, AiSuggestionProvider } from "./adminTypes";
import { t, type AiStringKey } from "./aiStrings";
import {
  CONSIDERATIONS, CONSIDERATION_GROUPS, CONSIDERATIONS_UP_FRONT, considerationById, reorderConsiderations,
  type Consideration, type ConsiderationContext, type ConsiderationGroup,
} from "./considerations";
import type { Answers } from "./ideas";

/** What the admin's choices so far say, for the local reorder. */
export function considerationContext(a: Answers): ConsiderationContext {
  return { tagIds: a.focusTagIds, goal: a.goal, groupSize: a.groupSize, setting: a.setting, budget: a.budget, timing: a.timing };
}

export interface FrontRow {
  /** Chips shown up front: the top suggestions first, then any chosen ones that are not among them (a chosen chip never disappears). */
  shown: string[];
  /** The top suggestions alone (what "More options" leaves out when not searching). */
  top: string[];
  /** The ids that get the small "Suggested" emphasis (empty when nobody ranked them, so a plain default order claims nothing). */
  suggested: ReadonlySet<string>;
  /** Every consideration, most relevant first. */
  ranked: string[];
}

export function frontRow(base: readonly AiConsiderationRank[], answers: Answers, provider: AiSuggestionProvider, upFront = CONSIDERATIONS_UP_FRONT): FrontRow {
  const ranked = reorderConsiderations(base, considerationContext(answers)).map((r) => r.id);
  const top = ranked.slice(0, upFront);
  const extra = answers.considerations.filter((id) => !top.includes(id) && considerationById(id));
  return { shown: [...top, ...extra], top, suggested: provider === "none" ? new Set<string>() : new Set(top), ranked };
}

export interface GroupView { group: ConsiderationGroup; label: string; items: Consideration[] }

export const groupLabel = (group: ConsiderationGroup): string => t(`consider.group.${group}` as AiStringKey);

/**
 * Every consideration grouped by category, in group order, each group ordered by relevance. A query keeps the entries
 * whose label, hint or group name contains every word of it (case-insensitive); groups left empty are dropped. An empty
 * query lists everything, so nothing, accommodations included, is reachable only through the ranking.
 */
export function groupedConsiderations(ranked: readonly string[], query: string, alreadyShown: ReadonlySet<string> = new Set()): GroupView[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // Without a search the list holds the rest (what is not up front); a search looks through everything.
  const skip = words.length === 0 ? alreadyShown : new Set<string>();
  const order = new Map(ranked.map((id, index) => [id, index]));
  return CONSIDERATION_GROUPS.flatMap(({ id }) => {
    const label = groupLabel(id);
    const items = CONSIDERATIONS
      .filter((c) => c.group === id && !skip.has(c.id))
      .filter((c) => {
        const haystack = `${c.label} ${c.hint} ${label}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      })
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    return items.length > 0 ? [{ group: id, label, items }] : [];
  });
}
