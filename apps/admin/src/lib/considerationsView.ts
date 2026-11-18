// @i18n-migrated
// Pure view logic for the preference chips ("considerations") on the last step: which chips are shown up front, how the
// full list is grouped and searched. No React and no network, so it is unit tested directly. The ranking comes from the
// saved company suggestions; the admin's choices so far only reorder it locally (no model call per click).

import type { AiConsiderationRank, AiSuggestionProvider } from "./adminTypes";
import { t, type AiStringKey } from "./aiStrings";
import {
  CONSIDERATIONS, CONSIDERATION_GROUPS, CONSIDERATIONS_UP_FRONT, considerationById, reorderConsiderations,
  type Consideration, type ConsiderationContext, type ConsiderationGroup,
} from "./considerations";
import { type MessageKey, t as tText } from "./i18n";
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

/**
 * The label and hint of each consideration in the portal's language. considerations.ts keeps the English text (the model
 * receives it, and the file is shared with the server), so the screen reads these messages instead.
 */
const ITEM_TEXT: Readonly<Record<string, readonly [label: MessageKey, hint: MessageKey]>> = {
  wheelchair_accessible: ["dipbot.consider.item.wheelchairAccessible.label", "dipbot.consider.item.wheelchairAccessible.hint"],
  step_free: ["dipbot.consider.item.stepFree.label", "dipbot.consider.item.stepFree.hint"],
  seated_friendly: ["dipbot.consider.item.seatedFriendly.label", "dipbot.consider.item.seatedFriendly.hint"],
  hearing_friendly: ["dipbot.consider.item.hearingFriendly.label", "dipbot.consider.item.hearingFriendly.hint"],
  sensory_friendly: ["dipbot.consider.item.sensoryFriendly.label", "dipbot.consider.item.sensoryFriendly.hint"],
  accessible_restrooms: ["dipbot.consider.item.accessibleRestrooms.label", "dipbot.consider.item.accessibleRestrooms.hint"],
  plain_language: ["dipbot.consider.item.plainLanguage.label", "dipbot.consider.item.plainLanguage.hint"],
  visual_friendly: ["dipbot.consider.item.visualFriendly.label", "dipbot.consider.item.visualFriendly.hint"],
  vegetarian: ["dipbot.consider.item.vegetarian.label", "dipbot.consider.item.vegetarian.hint"],
  vegan: ["dipbot.consider.item.vegan.label", "dipbot.consider.item.vegan.hint"],
  gluten_free: ["dipbot.consider.item.glutenFree.label", "dipbot.consider.item.glutenFree.hint"],
  nut_free: ["dipbot.consider.item.nutFree.label", "dipbot.consider.item.nutFree.hint"],
  halal: ["dipbot.consider.item.halal.label", "dipbot.consider.item.halal.hint"],
  kosher: ["dipbot.consider.item.kosher.label", "dipbot.consider.item.kosher.hint"],
  alcohol_free: ["dipbot.consider.item.alcoholFree.label", "dipbot.consider.item.alcoholFree.hint"],
  caffeine_free: ["dipbot.consider.item.caffeineFree.label", "dipbot.consider.item.caffeineFree.hint"],
  something_new: ["dipbot.consider.item.somethingNew.label", "dipbot.consider.item.somethingNew.hint"],
  quiet_low_pressure: ["dipbot.consider.item.quietLowPressure.label", "dipbot.consider.item.quietLowPressure.hint"],
  high_energy: ["dipbot.consider.item.highEnergy.label", "dipbot.consider.item.highEnergy.hint"],
  introvert_friendly: ["dipbot.consider.item.introvertFriendly.label", "dipbot.consider.item.introvertFriendly.hint"],
  no_public_speaking: ["dipbot.consider.item.noPublicSpeaking.label", "dipbot.consider.item.noPublicSpeaking.hint"],
  competitive: ["dipbot.consider.item.competitive.label", "dipbot.consider.item.competitive.hint"],
  cooperative: ["dipbot.consider.item.cooperative.label", "dipbot.consider.item.cooperative.hint"],
  icebreakers: ["dipbot.consider.item.icebreakers.label", "dipbot.consider.item.icebreakers.hint"],
  creative: ["dipbot.consider.item.creative.label", "dipbot.consider.item.creative.hint"],
  learning_focused: ["dipbot.consider.item.learningFocused.label", "dipbot.consider.item.learningFocused.hint"],
  reflective: ["dipbot.consider.item.reflective.label", "dipbot.consider.item.reflective.hint"],
  celebratory: ["dipbot.consider.item.celebratory.label", "dipbot.consider.item.celebratory.hint"],
  music_background: ["dipbot.consider.item.musicBackground.label", "dipbot.consider.item.musicBackground.hint"],
  during_work_hours: ["dipbot.consider.item.duringWorkHours.label", "dipbot.consider.item.duringWorkHours.hint"],
  lunch_friendly: ["dipbot.consider.item.lunchFriendly.label", "dipbot.consider.item.lunchFriendly.hint"],
  after_hours: ["dipbot.consider.item.afterHours.label", "dipbot.consider.item.afterHours.hint"],
  under_one_hour: ["dipbot.consider.item.underOneHour.label", "dipbot.consider.item.underOneHour.hint"],
  near_transit: ["dipbot.consider.item.nearTransit.label", "dipbot.consider.item.nearTransit.hint"],
  rain_plan: ["dipbot.consider.item.rainPlan.label", "dipbot.consider.item.rainPlan.hint"],
  remote_friendly: ["dipbot.consider.item.remoteFriendly.label", "dipbot.consider.item.remoteFriendly.hint"],
  plus_one: ["dipbot.consider.item.plusOne.label", "dipbot.consider.item.plusOne.hint"],
  low_prep: ["dipbot.consider.item.lowPrep.label", "dipbot.consider.item.lowPrep.hint"],
  no_equipment: ["dipbot.consider.item.noEquipment.label", "dipbot.consider.item.noEquipment.hint"],
  low_cost: ["dipbot.consider.item.lowCost.label", "dipbot.consider.item.lowCost.hint"],
  split_cost: ["dipbot.consider.item.splitCost.label", "dipbot.consider.item.splitCost.hint"],
  easy_parking: ["dipbot.consider.item.easyParking.label", "dipbot.consider.item.easyParking.hint"],
  all_fitness_levels: ["dipbot.consider.item.allFitnessLevels.label", "dipbot.consider.item.allFitnessLevels.hint"],
  no_physical_contact: ["dipbot.consider.item.noPhysicalContact.label", "dipbot.consider.item.noPhysicalContact.hint"],
  language_friendly: ["dipbot.consider.item.languageFriendly.label", "dipbot.consider.item.languageFriendly.hint"],
  family_friendly: ["dipbot.consider.item.familyFriendly.label", "dipbot.consider.item.familyFriendly.hint"],
  all_ages: ["dipbot.consider.item.allAges.label", "dipbot.consider.item.allAges.hint"],
  inclusive_culture: ["dipbot.consider.item.inclusiveCulture.label", "dipbot.consider.item.inclusiveCulture.hint"],
  supervised: ["dipbot.consider.item.supervised.label", "dipbot.consider.item.supervised.hint"],
  first_aid: ["dipbot.consider.item.firstAid.label", "dipbot.consider.item.firstAid.hint"],
  low_risk: ["dipbot.consider.item.lowRisk.label", "dipbot.consider.item.lowRisk.hint"],
  well_lit: ["dipbot.consider.item.wellLit.label", "dipbot.consider.item.wellLit.hint"],
};
export const considerationLabel = (item: Pick<Consideration, "id" | "label">): string => (ITEM_TEXT[item.id] ? tText(ITEM_TEXT[item.id][0]) : item.label);
export const considerationHint = (item: Pick<Consideration, "id" | "hint">): string => (ITEM_TEXT[item.id] ? tText(ITEM_TEXT[item.id][1]) : item.hint);

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
        const haystack = `${considerationLabel(c)} ${considerationHint(c)} ${label}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      })
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    return items.length > 0 ? [{ group: id, label, items }] : [];
  });
}
