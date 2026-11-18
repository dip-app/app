/**
 * Dipbot considerations: the fixed pool of preference chips an admin can attach to an AI event request ("Vegetarian food
 * options", "Step-free access", ...). The catalog is closed: generateEventDraftsV1 accepts only these ids, and the
 * labels below are the only text of a consideration that ever reaches the model.
 *
 * THIS FILE EXISTS TWICE, byte for byte: gcp/functions/src/modules/ai/domain/considerations.ts (server) and
 * apps/admin/src/lib/considerations.ts (portal). It has no imports so both builds compile it as is; a unit test
 * (gcp/tests/unit/ai-considerations.test.ts) fails when the copies differ. Edit one, then copy it over the other.
 *
 * Ranking only decides what is surfaced first. Every consideration, accommodations included, is always reachable under
 * "More options", so a ranking can never hide an accessibility or dietary need.
 */

export type ConsiderationGroup = "accessibility" | "dietary" | "vibe" | "logistics" | "inclusion" | "safety";

export const CONSIDERATION_GROUPS: readonly { id: ConsiderationGroup; label: string }[] = [
  { id: "accessibility", label: "Accessibility" },
  { id: "dietary", label: "Food and drink" },
  { id: "vibe", label: "Vibe" },
  { id: "logistics", label: "Logistics" },
  { id: "inclusion", label: "Inclusion" },
  { id: "safety", label: "Safety" },
];

/** What makes a consideration more relevant. Each field lists the values (of the matching dimension) that raise it. */
export interface ConsiderationAffinity {
  /** Catalog interest tag ids (member interests, the weekly theme, past events). */
  tags?: readonly string[];
  goals?: readonly string[];
  groups?: readonly string[];
  settings?: readonly string[];
  budgets?: readonly string[];
  timings?: readonly string[];
}

export interface Consideration {
  id: string;
  label: string;
  hint: string;
  group: ConsiderationGroup;
  affinity?: ConsiderationAffinity;
}

const c = (group: ConsiderationGroup, id: string, label: string, hint: string, affinity?: ConsiderationAffinity): Consideration =>
  affinity ? { id, label, hint, group, affinity } : { id, label, hint, group };

export const CONSIDERATIONS: readonly Consideration[] = [
  // Accessibility
  c("accessibility", "wheelchair_accessible", "Wheelchair accessible", "Ramps or level entry, and room to move", { settings: ["outdoors", "offsite"], groups: ["company"] }),
  c("accessibility", "step_free", "Step-free access", "No stairs between the entrance and the activity", { settings: ["offsite"] }),
  c("accessibility", "seated_friendly", "Seated and low-mobility friendly", "People can take part sitting down or moving slowly", { goals: ["wellness", "celebrate"], tags: ["tag-chill", "tag-arts"] }),
  c("accessibility", "hearing_friendly", "Hearing friendly with captions", "Captions or written instructions, and a quiet enough room", { tags: ["tag-learning", "tag-music"], goals: ["learning"] }),
  c("accessibility", "sensory_friendly", "Sensory friendly with a quiet space", "Low noise and lights, plus somewhere to step away", { tags: ["tag-chill", "tag-wellness"], goals: ["wellness"] }),
  c("accessibility", "accessible_restrooms", "Accessible restrooms nearby", "Restrooms that people with limited mobility can use", { settings: ["outdoors", "offsite"] }),
  c("accessibility", "plain_language", "Plain language and low reading", "Short, simple instructions that need little reading", { tags: ["tag-games", "tag-learning"] }),
  c("accessibility", "visual_friendly", "Easy to follow without sharp vision", "Large print and clear spoken directions", { tags: ["tag-arts", "tag-learning"] }),
  // Dietary
  c("dietary", "vegetarian", "Vegetarian food options", "Meat-free dishes that are a real meal", { tags: ["tag-food", "tag-cooking"], timings: ["weekday_lunch"] }),
  c("dietary", "vegan", "Vegan food options", "Dishes without any animal products", { tags: ["tag-food", "tag-cooking", "tag-wellness"] }),
  c("dietary", "gluten_free", "Gluten-free options", "Choices that are safe for people avoiding gluten", { tags: ["tag-food", "tag-cooking"] }),
  c("dietary", "nut_free", "Nut-free", "No nuts in the food, with allergies in mind", { tags: ["tag-food", "tag-cooking"], groups: ["company"] }),
  c("dietary", "halal", "Halal options", "Food prepared according to halal practice", { tags: ["tag-food"], groups: ["company"] }),
  c("dietary", "kosher", "Kosher-friendly options", "Choices that suit people who keep kosher", { tags: ["tag-food"], groups: ["company"] }),
  c("dietary", "alcohol_free", "Alcohol-free", "A good time without drinks, or with alcohol-free choices", { timings: ["weekday_lunch", "weekend"], goals: ["wellness", "learning"] }),
  c("dietary", "caffeine_free", "Caffeine-free options", "Drinks for people who skip coffee and tea", { tags: ["tag-food", "tag-wellness"] }),
  // Vibe
  c("vibe", "something_new", "Something new for the team", "An activity the team has not done before", { goals: ["team_bonding", "learning"] }),
  c("vibe", "quiet_low_pressure", "Quiet and low pressure", "Easy to join, nobody put on the spot", { tags: ["tag-chill", "tag-wellness"], goals: ["wellness"] }),
  c("vibe", "high_energy", "High energy", "Active, loud and lively", { tags: ["tag-energetic", "tag-hype", "tag-fitness"], goals: ["competition", "celebrate"] }),
  c("vibe", "introvert_friendly", "Introvert friendly", "Works well for people who prefer small talk in small doses", { tags: ["tag-chill", "tag-arts"], groups: ["small"] }),
  c("vibe", "no_public_speaking", "No public speaking", "Nobody has to perform or talk in front of the group", { goals: ["team_bonding", "celebrate"] }),
  c("vibe", "competitive", "Competitive", "Scores, teams and bragging rights", { goals: ["competition"], tags: ["tag-games", "tag-fitness", "tag-energetic"] }),
  c("vibe", "cooperative", "Cooperative, not competitive", "Everyone works toward one goal together", { goals: ["team_bonding", "give_back", "learning"] }),
  c("vibe", "icebreakers", "Icebreakers included", "Simple ways to get conversations started", { goals: ["team_bonding"], groups: ["company", "team"], tags: ["tag-social"] }),
  c("vibe", "creative", "Creative and hands-on", "Making something together", { tags: ["tag-arts", "tag-cooking"], goals: ["learning", "team_bonding"] }),
  c("vibe", "learning_focused", "Learning focused", "People walk away with a new skill", { tags: ["tag-learning", "tag-arts", "tag-cooking"], goals: ["learning"] }),
  c("vibe", "reflective", "Calm and reflective", "Slow pace, time to breathe and think", { tags: ["tag-wellness", "tag-chill"], goals: ["wellness"] }),
  c("vibe", "celebratory", "Festive and celebratory", "A moment to mark a win or a season", { goals: ["celebrate"], tags: ["tag-hype", "tag-music", "tag-social"] }),
  c("vibe", "music_background", "Music in the background", "Light music without making it hard to talk", { tags: ["tag-music", "tag-social"] }),
  // Logistics
  c("logistics", "during_work_hours", "During work hours", "Fits inside the workday", { timings: ["weekday_lunch"] }),
  c("logistics", "lunch_friendly", "Lunch-hour friendly", "Done in about an hour, food optional", { timings: ["weekday_lunch"] }),
  c("logistics", "after_hours", "After hours", "Planned for after the workday ends", { timings: ["after_work", "weekend"] }),
  c("logistics", "under_one_hour", "Short, under 1 hour", "A quick way to take part", { timings: ["weekday_lunch"], budgets: ["free"] }),
  c("logistics", "near_transit", "Close to the office or transit", "Easy to reach without a car", { settings: ["offsite"], timings: ["after_work"] }),
  c("logistics", "rain_plan", "Indoor backup or rain plan", "Still works if the weather turns", { settings: ["outdoors"], tags: ["tag-outdoors"] }),
  c("logistics", "remote_friendly", "Remote or hybrid friendly", "People who work from home can join too", { groups: ["company", "team"], timings: ["weekday_lunch"] }),
  c("logistics", "plus_one", "Bring a plus-one", "Partners or friends are welcome", { timings: ["weekend", "after_work"], goals: ["celebrate"] }),
  c("logistics", "low_prep", "Low prep for organizers", "Little setup, little to carry", { budgets: ["free", "under_15"], groups: ["small", "team"] }),
  c("logistics", "no_equipment", "No special equipment", "Nothing to buy or bring", { budgets: ["free", "under_15"] }),
  c("logistics", "low_cost", "Low cost or free", "Easy on the budget", { budgets: ["free", "under_15"] }),
  c("logistics", "split_cost", "Split the cost", "People chip in a small amount", { budgets: ["from_15_to_50", "over_50"] }),
  c("logistics", "easy_parking", "Easy parking", "Room for people who drive", { settings: ["offsite", "outdoors"], timings: ["after_work", "weekend"] }),
  // Inclusion
  c("inclusion", "all_fitness_levels", "All fitness levels", "Everyone can join at their own pace", { tags: ["tag-fitness", "tag-outdoors", "tag-energetic"], goals: ["wellness"] }),
  c("inclusion", "no_physical_contact", "No physical contact", "Nothing that needs touching or close contact", { tags: ["tag-fitness", "tag-games"], goals: ["competition"] }),
  c("inclusion", "language_friendly", "Language friendly", "Easy for people who speak English as a second language", { groups: ["company"], tags: ["tag-games", "tag-arts"] }),
  c("inclusion", "family_friendly", "Family friendly", "Kids can join if people want to bring them", { timings: ["weekend"], goals: ["celebrate"] }),
  c("inclusion", "all_ages", "Welcoming to all ages", "Works for people early and late in their careers", { groups: ["company", "team"] }),
  c("inclusion", "inclusive_culture", "Respectful of all cultures and beliefs", "No theme or joke that leaves someone out", { groups: ["company"], goals: ["celebrate"] }),
  // Safety
  c("safety", "supervised", "Led by a trained guide", "A host or instructor keeps things safe", { tags: ["tag-fitness", "tag-outdoors", "tag-cooking"], settings: ["outdoors"] }),
  c("safety", "first_aid", "First aid aware", "Someone knows where the first aid kit is", { settings: ["outdoors"], tags: ["tag-fitness", "tag-outdoors", "tag-energetic"], goals: ["competition"] }),
  c("safety", "low_risk", "Low risk of injury", "Gentle activities with little chance of getting hurt", { goals: ["wellness", "learning"], tags: ["tag-chill", "tag-arts"] }),
  c("safety", "well_lit", "Well lit and easy to find", "A safe, lit place to meet and leave", { timings: ["after_work"], settings: ["outdoors", "offsite"] }),
];

export const CONSIDERATION_IDS: readonly string[] = CONSIDERATIONS.map(entry => entry.id);
const BY_ID: ReadonlyMap<string, Consideration> = new Map(CONSIDERATIONS.map(entry => [entry.id, entry]));

export const considerationById = (id: string): Consideration | undefined => BY_ID.get(id);
export const isConsiderationId = (id: string): boolean => BY_ID.has(id);

/** Bump when the pool changes: it is part of the suggestion cache fingerprint. */
export const CONSIDERATION_CATALOG_VERSION = 1;
/** How many considerations are surfaced up front; the rest sit under "More options". */
export const CONSIDERATIONS_UP_FRONT = 6;
/** Most considerations one request can carry. */
export const MAX_CONSIDERATIONS = 12;

/**
 * The old fixed note chips, mapped to catalog ids. The portal used to append their text to the note; the ids are what a
 * stored or bookmarked preference maps to now.
 */
export const LEGACY_NOTE_CHIPS: Readonly<Record<string, string>> = {
  "Something new for the team": "something_new",
  "Vegetarian food options": "vegetarian",
  "Easy for people who use a wheelchair": "wheelchair_accessible",
  "Quiet and low pressure": "quiet_low_pressure",
};

/** What a ranking looks at. Every field is optional: a missing one simply raises nothing. */
export interface ConsiderationContext {
  tagIds?: readonly string[];
  goal?: string | null;
  groupSize?: string | null;
  setting?: string | null;
  budget?: string | null;
  timing?: string | null;
}

const BASE_RELEVANCE = 0.12;
const PER_MATCH = 0.2;
const MAX_RELEVANCE = 0.92;

/**
 * Deterministic relevance from 0 to 1 of one consideration for a context: a small base plus a step per matching
 * dimension (any interest tag, goal, group size, setting, budget, timing). The same rule runs on the server when no
 * model answered, and in the portal to reorder by the admin's choices so far (no model call per click).
 */
export function considerationRelevance(entry: Consideration, context: ConsiderationContext): number {
  const a = entry.affinity;
  if (!a) return BASE_RELEVANCE;
  let score = BASE_RELEVANCE;
  if (a.tags && (context.tagIds ?? []).some(tag => a.tags!.includes(tag))) score += PER_MATCH;
  if (a.goals && context.goal && a.goals.includes(context.goal)) score += PER_MATCH;
  if (a.groups && context.groupSize && a.groups.includes(context.groupSize)) score += PER_MATCH;
  if (a.settings && context.setting && a.settings.includes(context.setting)) score += PER_MATCH;
  if (a.budgets && context.budget && a.budgets.includes(context.budget)) score += PER_MATCH;
  if (a.timings && context.timing && a.timings.includes(context.timing)) score += PER_MATCH;
  return Math.min(MAX_RELEVANCE, Math.round(score * 1000) / 1000);
}

export interface ConsiderationRank { id: string; probability: number }

/** Every consideration, most relevant first (ties keep catalog order, so the result is stable). */
export function rankConsiderationsByRules(context: ConsiderationContext): ConsiderationRank[] {
  return CONSIDERATIONS
    .map((entry, index) => ({ id: entry.id, probability: considerationRelevance(entry, context), index }))
    .sort((x, y) => y.probability - x.probability || x.index - y.index)
    .map(({ id, probability }) => ({ id, probability }));
}

/**
 * Reorders a base ranking (the saved, company-level one) by the admin's choices: base relevance plus the local rule
 * score, with ties kept in the base order. Pure and instant, so it can run on every click.
 */
export function reorderConsiderations(base: readonly ConsiderationRank[], context: ConsiderationContext): ConsiderationRank[] {
  const seen = new Set(base.map(rank => rank.id));
  const all = [...base, ...CONSIDERATION_IDS.filter(id => !seen.has(id)).map(id => ({ id, probability: BASE_RELEVANCE }))]
    .filter(rank => BY_ID.has(rank.id));
  return all
    .map((rank, index) => {
      const entry = BY_ID.get(rank.id)!;
      const local = considerationRelevance(entry, context) - BASE_RELEVANCE;
      return { id: rank.id, probability: Math.min(1, Math.round((rank.probability + local) * 1000) / 1000), index };
    })
    .sort((x, y) => y.probability - x.probability || x.index - y.index)
    .map(({ id, probability }) => ({ id, probability }));
}
