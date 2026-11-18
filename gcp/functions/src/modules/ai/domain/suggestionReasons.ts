import type { AiEventChoices } from "../../../generated/models";
import type { PastEventStats, SuggestionFacts, SuggestionQuestion } from "./suggestions";

/**
 * The one-line "why" under a Dipbot suggestion. Honesty rule: wording that sounds personalized ("your team", "your
 * recent events") is used only when the suggestion is backed by the company's own data above the privacy floor
 * (`reasonBasis: "company_data"`). Otherwise the line is generic and never implies personalization
 * (`reasonBasis: "generic"`). Lines never carry counts under the floor, exact small numbers, names or event titles, are
 * short (about 60 characters), and rotate deterministically by option so neighboring cards do not read like a template.
 * The copy is code-owned and contains no provider names.
 */
export type ReasonBasis = "company_data" | "generic";
export interface Reason { reason: string; basis: ReasonBasis }

/** Past-event aggregates are only a signal from this many events on (a handful of events would be nearly identifiable). */
export const PAST_EVENTS_FLOOR = 5;
/** A share of recent events counts as "most" from this level on. */
const MOST = 0.5;
/** Shorter than this is a real habit; longer is just a trace. */
const FEW = 0.1;

/** Deterministic pick: the same option always gets the same phrasing, adjacent options differ. */
function rotate(variants: readonly string[], key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return variants[hash % variants.length]!;
}

const mine = (text: string): Reason => ({ reason: text, basis: "company_data" });
const generic = (text: string): Reason => ({ reason: text, basis: "generic" });

const INTEREST_POPULAR = [
  "Fits what your team has been interested in lately",
  "A popular pick among your members",
  "Plenty of your members share this interest",
];
const INTEREST_GENERIC = ["A crowd favorite for workplace events", "A well-liked choice for most teams"];
const GOAL_MINE = [
  "Fits what your members enjoy most",
  "Matches your team's top interests",
  "Suits the interests your members picked",
];
const GOAL_GENERIC = ["A good fit for most workplace groups", "A goal most teams enjoy"];
const SIZE_MOST = ["Most of your recent events were this size", "Your recent events mostly drew this group size"];
const SIZE_SOME = ["Your recent events often had room for this size", "A group size you have hosted before"];
const SIZE_NEW = ["Few events this size lately, so it adds variety", "A group size you have not tried much lately"];
const SIZE_BIG = ["Many members share an interest, so a big group works", "Enough shared interests for a company-wide event"];
const SIZE_GENERIC = ["Works for most team sizes", "A flexible group size"];
const OUTDOORS_MOST = ["Most of your recent events were outdoors", "You have been outdoors a lot lately"];
const OUTDOORS_INTEREST = ["Outdoors is popular with your members", "Many of your members like the outdoors"];
const SETTING_SOME = ["A setting your recent events used often", "Your recent events have used this setting"];
const SETTING_NEW = ["Few events like this lately, so it adds variety", "A change of scene from your recent events"];
const SETTING_GENERIC = ["A reliable choice in any season", "Easy to plan around"];
const BUDGET_MOST = ["Most of your recent events were in this range", "A range your recent events often used"];
const BUDGET_SOME = ["A range you have used before", "Your recent events have included this range"];
const BUDGET_NEW = ["Few events in this range lately, so it adds variety", "A range you have not used much lately"];
const BUDGET_GENERIC_LOW = ["Low cost makes it easy for everyone to join", "Keeps it easy for everyone to say yes"];
const BUDGET_GENERIC = ["A common range for workplace events", "A budget many teams choose"];
const TIMING_MOST = ["Most of your recent events were at this time", "Your recent events mostly met at this time"];
const TIMING_SOME = ["A time your recent events have used", "A slot your team has joined before"];
const TIMING_NEW = ["Few events at this time lately, so it adds variety", "A time slot you have not used much lately"];
const TIMING_GENERIC_AFTER = ["Easy to join without missing work", "Works well after a busy day"];
const TIMING_GENERIC = ["Easy for most people to join", "A time that suits most schedules"];

/** Share of the recent events with this value, or null when there are too few events to say anything. */
function share(past: PastEventStats | null, count: number | undefined): number | null {
  if (!past || past.total < PAST_EVENTS_FLOOR || count === undefined) return null;
  return count / past.total;
}

/** For past-event signals: most, some, or none lately ("adds variety"). */
function fromShare(s: number, key: string, most: readonly string[], some: readonly string[], none: readonly string[]): Reason {
  if (s >= MOST) return mine(rotate(most, key));
  if (s > FEW) return mine(rotate(some, key));
  return mine(rotate(none, key));
}

export function reasonWithBasis(question: SuggestionQuestion, value: string, facts: SuggestionFacts): Reason {
  const key = `${question}:${value}`;
  const past = facts.past;
  switch (question) {
    case "interest": {
      const hit = facts.interests.find(i => i.tagId === value);
      if (!hit) return generic(rotate(INTEREST_GENERIC, key));
      if (facts.theme?.tagIds.includes(value)) return mine(`Lines up with this week's ${facts.theme.title}`.slice(0, 80));
      return mine(rotate(INTEREST_POPULAR, key));
    }
    case "goal":
      // Interest buckets already exclude tags under the privacy floor, so any entry is real company data.
      return facts.interests.length > 0 ? mine(rotate(GOAL_MINE, key)) : generic(rotate(GOAL_GENERIC, key));
    case "groupSize": {
      const s = share(past, past?.size[value as AiEventChoices["groupSize"]]);
      if (s !== null) return fromShare(s, key, SIZE_MOST, SIZE_SOME, SIZE_NEW);
      if (value === "company" && facts.interests.some(i => i.bucket === "20+")) return mine(rotate(SIZE_BIG, key));
      return generic(rotate(SIZE_GENERIC, key));
    }
    case "setting": {
      const outdoors = value === "outdoors";
      const s = share(past, outdoors ? past?.outdoor : past ? past.total - past.outdoor : undefined);
      if (s !== null && value !== "offsite") {
        if (outdoors && s >= MOST) return mine(rotate(OUTDOORS_MOST, key));
        return fromShare(s, key, SETTING_SOME, SETTING_SOME, SETTING_NEW);
      }
      if (outdoors && facts.interests.some(i => i.tagId === "tag-outdoors")) return mine(rotate(OUTDOORS_INTEREST, key));
      return generic(rotate(SETTING_GENERIC, key));
    }
    case "budget": {
      const s = share(past, past?.budget[value as AiEventChoices["budget"]]);
      if (s !== null) return fromShare(s, key, BUDGET_MOST, BUDGET_SOME, BUDGET_NEW);
      return generic(rotate(value === "free" || value === "under_15" ? BUDGET_GENERIC_LOW : BUDGET_GENERIC, key));
    }
    case "timing": {
      const s = share(past, past?.timing[value as AiEventChoices["timing"]]);
      if (s !== null) return fromShare(s, key, TIMING_MOST, TIMING_SOME, TIMING_NEW);
      return generic(rotate(value === "after_work" ? TIMING_GENERIC_AFTER : TIMING_GENERIC, key));
    }
  }
}
