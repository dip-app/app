import type { AiBudget, AiDaypart, AiEventChoices, AiGroupSize, AiVenueType, DipbotIdea } from "./adminTypes";
import { COVER_LIBRARY } from "./covers";

// Preview data for "Ideas for you" (getDipbotIdeasV1). `?ideas=` picks a scenario for design review:
// default (yesterday's ideas), fresh, computing (starter ideas first, then the background run swaps in new ones),
// empty (no data, starter ideas), error, exhausted (0 credits), off, limit (no manual refreshes left today).

export type IdeasScenario = "default" | "fresh" | "computing" | "empty" | "error" | "exhausted" | "off" | "limit";
const IDEAS_SCENARIOS: readonly IdeasScenario[] = ["fresh", "computing", "empty", "error", "exhausted", "off", "limit"];
export function ideasScenarioFromSearch(search: string): IdeasScenario {
  const value = new URLSearchParams(search).get("ideas") as IdeasScenario | null;
  return value && IDEAS_SCENARIOS.includes(value) ? value : "default";
}

interface IdeaSeed {
  id: string; title: string; theme: DipbotIdea["theme"]; cover: string; tags: string[]; why: string; fit?: DipbotIdea["fitLabel"];
  weekday: number; daypart: AiDaypart; minutes: number; cost: AiBudget; size: AiGroupSize; goal: AiEventChoices["goal"]; setting: AiEventChoices["setting"];
  considerations: string[]; text: string; venue: AiVenueType; hint: string; capacity: number;
}

const SEEDS_A: IdeaSeed[] = [
  { id: "idea-trivia", title: "Thursday Trivia Showdown", theme: "games", cover: "board-games-table-2730034", tags: ["tag-games", "tag-social"], why: "Games drew 14 of your last 20 signups, and Thursday evenings fill to 86%.", fit: "perfect",
    weekday: 4, daypart: "after_work", minutes: 90, cost: "free", size: "team", goal: "competition", setting: "indoors", considerations: ["seated_friendly"], venue: "restaurant_or_cafe", hint: "cafe with a private room", capacity: 24,
    text: "Mixed teams compete across five short rounds, from pop culture to office history. Snacks are on the table and the winning team gets a small prize." },
  { id: "idea-lunch-run", title: "Lunch Break 5K Jog", theme: "fitness", cover: "breathwork-outdoors-1822459", tags: ["tag-fitness", "tag-outdoors"], why: "Fitness is your top interest, and lunch events average 82% full, your best slot.", fit: "great",
    weekday: 2, daypart: "weekday_lunch", minutes: 60, cost: "free", size: "team", goal: "wellness", setting: "outdoors", considerations: ["step_free"], venue: "park_or_outdoors", hint: "park near the office", capacity: 20,
    text: "An easy-paced loop with a walking group for anyone who prefers it. The route is flat and 5 kilometers." },
  { id: "idea-cookies", title: "Cookie Decorating Workshop", theme: "food", cover: "baking-cookies-6881348", tags: ["tag-cooking", "tag-food", "tag-social"], why: "Food and cooking interests grew by 9 members this month, with no cooking event planned.", fit: "great",
    weekday: 3, daypart: "after_work", minutes: 120, cost: "under_15", size: "team", goal: "team_bonding", setting: "indoors", considerations: ["vegetarian"], venue: "community_site", hint: "community kitchen", capacity: 18,
    text: "Everyone decorates a box of cookies with icing and sprinkles, guided by a short demo. Vegetarian and nut-free options are included." },
  { id: "idea-beach", title: "Beach Cleanup Morning", theme: "volunteering", cover: "beach-cleanup-volunteers-7788809", tags: ["tag-volunteering", "tag-outdoors"], why: "No giving back event is planned in the next 4 weeks, and 11 members like volunteering.", fit: "good",
    weekday: 6, daypart: "weekend_daytime", minutes: 150, cost: "free", size: "company", goal: "give_back", setting: "outdoors", considerations: ["wheelchair_accessible"], venue: "park_or_outdoors", hint: "nearest public beach", capacity: 60,
    text: "Crews tidy a stretch of shoreline, then share a picnic lunch. Gloves and bags are supplied and the path is mostly flat." },
  { id: "idea-tea", title: "Tea and Gratitude Hour", theme: "wellness", cover: "herbal-tea-cozy-1410565", tags: ["tag-wellness", "tag-chill"], why: "A calm way to close the week, and nothing in wellness is scheduled yet.",
    weekday: 5, daypart: "weekday_afternoon", minutes: 45, cost: "free", size: "small", goal: "wellness", setting: "indoors", considerations: ["sensory_friendly"], venue: "office", hint: "meeting room", capacity: 10,
    text: "A quiet hour with herbal tea, a short guided gratitude note and an optional share-out. Low noise and no pressure to talk." },
];
const SEEDS_B: IdeaSeed[] = [
  { id: "idea-choir", title: "Sing-Along Lunch", theme: "music", cover: "choir-rehearsal-5781096", tags: ["tag-music", "tag-social"], why: "Music is one of 4 interests with few events this quarter, and 8 members chose it.", fit: "great",
    weekday: 3, daypart: "weekday_lunch", minutes: 45, cost: "free", size: "company", goal: "celebrate", setting: "indoors", considerations: ["hearing_friendly"], venue: "office", hint: "open area at the office", capacity: 40,
    text: "A volunteer leads easy group songs with printed lyrics. No singing experience needed, and listening along is just as welcome." },
  { id: "idea-bootcamp", title: "Park Bootcamp", theme: "fitness", cover: "bootcamp-outdoors-4127336", tags: ["tag-fitness", "tag-energetic", "tag-outdoors"], why: "Your last 3 fitness events were all over 80% full, so there is room for more.", fit: "perfect",
    weekday: 2, daypart: "after_work", minutes: 60, cost: "under_15", size: "team", goal: "wellness", setting: "outdoors", considerations: ["step_free"], venue: "park_or_outdoors", hint: "city park lawn", capacity: 20,
    text: "A trainer leads a mixed-level circuit with scaled options for every move. Bring water; mats are provided." },
  { id: "idea-chess", title: "Chess and Chill", theme: "games", cover: "board-games-strategy-1511866", tags: ["tag-games", "tag-chill"], why: "Games remain your most active interest with 22 members, and trivia fills fast.", fit: "great",
    weekday: 4, daypart: "weekday_lunch", minutes: 60, cost: "free", size: "small", goal: "team_bonding", setting: "indoors", considerations: ["seated_friendly"], venue: "office", hint: "meeting room", capacity: 12,
    text: "Casual chess and other quick games over lunch, with a few boards set up for beginners and a relaxed ladder for regulars." },
  { id: "idea-code", title: "Lunch and Learn: Build Together", theme: "learning", cover: "coding-laptops-group-1873854", tags: ["tag-learning", "tag-social"], why: "Learning events filled fastest last month, and 12 members picked it as an interest.", fit: "good",
    weekday: 3, daypart: "weekday_afternoon", minutes: 90, cost: "free", size: "team", goal: "learning", setting: "indoors", considerations: ["plain_language"], venue: "office", hint: "conference room", capacity: 16,
    text: "Pairs build a tiny project from a guided starter, no coding background needed. Everyone leaves with something that works." },
  { id: "idea-draw", title: "Drawing Social Night", theme: "arts", cover: "drawing-life-class-5671673", tags: ["tag-arts", "tag-chill"], why: "A relaxed after-work option for quieter members, and arts is thin on your calendar.",
    weekday: 4, daypart: "after_work", minutes: 90, cost: "under_15", size: "small", goal: "celebrate", setting: "indoors", considerations: ["sensory_friendly"], venue: "community_site", hint: "art studio", capacity: 12,
    text: "Simple still-life drawing with materials provided and a friendly guide. Skill is not the point, and the evening ends with a mini gallery wall." },
];
const SEEDS_STARTER: IdeaSeed[] = [
  { id: "starter-trivia", title: "Team Trivia Night", theme: "games", cover: "board-games-table-2730034", tags: ["tag-games", "tag-social"], why: "A crowd pleaser that works for teams of any size.",
    weekday: 4, daypart: "after_work", minutes: 90, cost: "free", size: "team", goal: "competition", setting: "indoors", considerations: ["seated_friendly"], venue: "restaurant_or_cafe", hint: "cafe with a private room", capacity: 24,
    text: "Mixed teams compete across five short rounds. Snacks are on the table and there is a small prize for the winners." },
  { id: "starter-walk", title: "Lunchtime Walk and Talk", theme: "outdoors", cover: "beach-sunset-walk-7112018", tags: ["tag-outdoors", "tag-social"], why: "Easy to join, and a good first event for a new group.",
    weekday: 3, daypart: "weekday_lunch", minutes: 45, cost: "free", size: "small", goal: "team_bonding", setting: "outdoors", considerations: ["step_free"], venue: "park_or_outdoors", hint: "park near the office", capacity: 12,
    text: "A relaxed loop around the neighborhood in pairs that switch halfway, so everyone chats with someone new." },
  { id: "starter-bake", title: "Bake and Share", theme: "food", cover: "baking-cookies-6881348", tags: ["tag-cooking", "tag-food"], why: "Food events are popular with almost every group.",
    weekday: 3, daypart: "after_work", minutes: 120, cost: "under_15", size: "team", goal: "celebrate", setting: "indoors", considerations: ["vegetarian"], venue: "community_site", hint: "community kitchen", capacity: 18,
    text: "Small groups decorate and share cookies. Vegetarian options are included by default." },
  { id: "starter-cleanup", title: "Community Cleanup Hour", theme: "volunteering", cover: "beach-cleanup-volunteers-7788809", tags: ["tag-volunteering", "tag-outdoors"], why: "Gives back locally and ends with a relaxed chat.",
    weekday: 6, daypart: "weekend_daytime", minutes: 90, cost: "free", size: "company", goal: "give_back", setting: "outdoors", considerations: [], venue: "park_or_outdoors", hint: "local park", capacity: 40,
    text: "Tidy a nearby green space in small crews. Gloves and bags are supplied." },
  { id: "starter-tea", title: "Tea Break and Chat", theme: "wellness", cover: "herbal-tea-cozy-1410565", tags: ["tag-wellness", "tag-chill"], why: "Low effort and calm, a soft start for any group.",
    weekday: 5, daypart: "weekday_afternoon", minutes: 45, cost: "free", size: "small", goal: "wellness", setting: "indoors", considerations: ["sensory_friendly"], venue: "office", hint: "meeting room", capacity: 10,
    text: "A quiet hour with tea and an optional conversation prompt." },
];

const IDEA_HOURS: Record<AiDaypart, number> = { weekday_morning: 9, weekday_lunch: 12, weekday_afternoon: 15, after_work: 17, weekend_daytime: 10, weekend_evening: 18 };
const COST_CENTS: Record<AiBudget, number> = { free: 0, under_15: 1200, from_15_to_50: 3000, over_50: 6500 };

/** The next occurrence of `weekday` (Sunday = 0) after `now`, at the daypart's usual hour. */
function nextStart(now: Date, weekday: number, daypart: AiDaypart): string {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), IDEA_HOURS[daypart], 0, 0, 0);
  at.setDate(at.getDate() + ((weekday - at.getDay() + 7) % 7 || 7));
  return at.toISOString();
}

function ideaOf(seed: IdeaSeed, now: Date, source: DipbotIdea["source"]): DipbotIdea {
  const coverImageURL = COVER_LIBRARY.find((c) => c.key === seed.cover)?.url ?? `catalog://cover/${seed.cover}`;
  const timing: AiEventChoices["timing"] = seed.daypart.startsWith("weekend") ? "weekend" : seed.daypart === "weekday_lunch" ? "weekday_lunch" : "after_work";
  const choices: AiEventChoices = { focusTagIds: seed.tags, goal: seed.goal, groupSize: seed.size, setting: seed.setting, budget: seed.cost, timing };
  const grounded = source === "agent" && seed.fit !== undefined;
  return {
    id: seed.id, title: seed.title, description: seed.text, theme: seed.theme, tagIds: seed.tags, why: seed.why,
    reasonBasis: grounded ? "company_data" : "generic", ...(grounded ? { fitLabel: seed.fit } : {}),
    weekday: seed.weekday, daypart: seed.daypart, startsAt: nextStart(now, seed.weekday, seed.daypart), durationMinutes: seed.minutes,
    costBucket: seed.cost, groupSize: seed.size, considerationIds: seed.considerations, coverImageURL, choices, source,
    draft: {
      title: seed.title, description: seed.text, tagIds: seed.tags, coverImageURL, suggestedDaypart: seed.daypart, durationMinutes: seed.minutes,
      venueType: seed.venue, venueSearchHint: seed.hint, costCents: COST_CENTS[seed.cost], costNote: seed.cost === "free" ? "" : "Covers supplies and snacks",
      capacity: seed.capacity, isOutdoor: seed.setting === "outdoors", rationale: seed.why,
    },
  };
}

/** `generation` 0 is the stored set; every refresh alternates to the other set. `starter` is the free catalog fallback. */
export function buildMockIdeas(kind: "stored" | "starter", generation: number, now: Date): DipbotIdea[] {
  if (kind === "starter") return SEEDS_STARTER.map((s) => ideaOf(s, now, "catalog"));
  return (generation % 2 === 0 ? SEEDS_A : SEEDS_B).map((s) => ideaOf(s, now, "agent"));
}
