import type {
  AiBucket, AiDaypart, AiEventChoices, AiUsage, AiVenueType, EventIdeaContext, GeneratedEventDraft,
} from "./adminTypes";
import { COVERS, TAGS, tagName } from "./catalog";
import { bucketText } from "./ideas";

// Preview data for Event ideas. The mock follows the server rules: admin only, usage counters, requestId replay
// and a prompt safety check. `?ai=` picks a scenario for design review: off, nodata, quota, error or slow.

export type AiScenario = "default" | "off" | "nodata" | "quota" | "error" | "slow";

export function aiScenarioFromSearch(search: string): AiScenario {
  const value = new URLSearchParams(search).get("ai");
  return value === "off" || value === "nodata" || value === "quota" || value === "error" || value === "slow" ? value : "default";
}

export const MOCK_MONTHLY_LIMIT = 30;
export const MOCK_DAILY_LIMIT = 10;

const TOP: { tagId: string; bucket: AiBucket }[] = [
  { tagId: "tag-fitness", bucket: "20+" },
  { tagId: "tag-food", bucket: "20+" },
  { tagId: "tag-games", bucket: "10-19" },
  { tagId: "tag-outdoors", bucket: "10-19" },
  { tagId: "tag-social", bucket: "10-19" },
  { tagId: "tag-cooking", bucket: "5-9" },
  { tagId: "tag-wellness", bucket: "5-9" },
];
const THIN = ["tag-music", "tag-arts", "tag-volunteering", "tag-learning"];

export function usageOf(monthlyUsed: number, dailyUsed: number): AiUsage {
  const remaining = Math.max(0, Math.min(MOCK_MONTHLY_LIMIT - monthlyUsed, MOCK_DAILY_LIMIT - dailyUsed));
  return {
    monthlyGenerationLimit: MOCK_MONTHLY_LIMIT, monthlyGenerationsUsed: monthlyUsed,
    dailyGenerationLimit: MOCK_DAILY_LIMIT, dailyGenerationsUsed: dailyUsed, generationsRemaining: remaining, budgetExhausted: false,
  };
}

export function mockIdeaContext(scenario: AiScenario, monthlyUsed: number, dailyUsed: number): EventIdeaContext {
  const usage = scenario === "quota" ? usageOf(monthlyUsed, MOCK_DAILY_LIMIT) : usageOf(monthlyUsed, dailyUsed);
  const known = scenario !== "nodata";
  return {
    enabled: scenario !== "off",
    interestDataAvailable: known,
    topInterests: known ? TOP : [],
    thinInterestTagIds: known ? THIN : [],
    currentTheme: { title: "Fall Fitness Week", tagIds: ["tag-fitness"] },
    usage,
  };
}

interface Template {
  title: string;
  tags: string[];
  cover: string;
  venueType: AiVenueType;
  hint: string;
  outdoor: boolean;
  minutes: number;
  text: string;
  /** Goals the activity suits, used to rank. */
  goals: string[];
  /** What makes this activity a good pick, in its own words. */
  why: string;
}

const TEMPLATES: Template[] = [
  { title: "Lunchtime Walk and Talk", tags: ["tag-fitness", "tag-outdoors", "tag-social"], cover: "outdoors", venueType: "park_or_outdoors", hint: "park near the office", outdoor: true, minutes: 60,
    text: "A relaxed loop around the neighborhood in pairs that switch halfway, so everyone chats with someone new. Wear comfortable shoes. The route has no steep sections.", goals: ["wellness", "team_bonding"], why: "Gentle and outdoors, easy to fit into a lunch break." },
  { title: "Team Trivia Showdown", tags: ["tag-games", "tag-social"], cover: "games", venueType: "restaurant_or_cafe", hint: "cafe with a private room", outdoor: false, minutes: 90,
    text: "Mixed teams compete across five short rounds, from pop culture to office history. Bring your sharpest guesses. Snacks are on the table and there is a small prize for the winning team.", goals: ["competition", "celebrate", "team_bonding"], why: "Seated and competitive, lets quieter people shine in a team." },
  { title: "Cook-Along Potluck", tags: ["tag-cooking", "tag-food", "tag-social"], cover: "cooking", venueType: "community_site", hint: "community kitchen", outdoor: false, minutes: 120,
    text: "Small groups cook one dish each from a simple recipe, then everyone shares the meal. Vegetarian options are included by default, and ingredient lists are posted ahead of time.", goals: ["team_bonding", "learning", "celebrate"], why: "Hands-on and shared, people leave having made something together." },
  { title: "Beginner Bowling League Night", tags: ["tag-games", "tag-energetic"], cover: "games", venueType: "activity_venue", hint: "bowling alley", outdoor: false, minutes: 120,
    text: "Two games of casual bowling with rotating lanes. No experience needed, and bumpers are available. Shoe rental is included in the price.", goals: ["competition", "celebrate"], why: "Casual and active, no skills needed to join in." },
  { title: "Sunrise Stretch and Coffee", tags: ["tag-wellness", "tag-fitness", "tag-chill"], cover: "fitness", venueType: "office", hint: "open area at the office", outdoor: false, minutes: 45,
    text: "A gentle, instructor-led stretch session followed by coffee and a short chat. All levels are welcome and mats are provided.", goals: ["wellness"], why: "Low effort and calm, a soft start to the day." },
  { title: "Trail Cleanup and Picnic", tags: ["tag-volunteering", "tag-outdoors"], cover: "hiking", venueType: "park_or_outdoors", hint: "local nature preserve", outdoor: true, minutes: 150,
    text: "Help tidy a nearby trail in small crews, then enjoy a picnic lunch together. Gloves and bags are supplied. The path is mostly flat.", goals: ["give_back", "team_bonding"], why: "Gives back locally and ends with a relaxed meal." },
  { title: "Lunch and Learn: Skills Swap", tags: ["tag-learning", "tag-social"], cover: "cooking", venueType: "office", hint: "meeting room", outdoor: false, minutes: 60,
    text: "Three colleagues each teach a five minute skill, from keyboard shortcuts to quick stretches. Everyone leaves with something new to try.", goals: ["learning", "team_bonding"], why: "Short and low-pressure, people teach and learn from peers." },
  { title: "Charity 5K Fun Run", tags: ["tag-fitness", "tag-volunteering", "tag-energetic"], cover: "fitness", venueType: "park_or_outdoors", hint: "city park loop", outdoor: true, minutes: 120,
    text: "Walk, jog or run a friendly 5K that raises money for a local cause. Teams of four track a combined time, and there is a finish line snack table.", goals: ["give_back", "competition", "wellness"], why: "Active and purposeful, any pace works." },
  { title: "Board Game Cafe Social", tags: ["tag-games", "tag-chill", "tag-social"], cover: "games", venueType: "restaurant_or_cafe", hint: "board game cafe", outdoor: false, minutes: 120,
    text: "Pick from a shelf of easy-to-learn games and play in relaxed groups. A host explains the rules, so no one needs to read a manual.", goals: ["team_bonding", "celebrate"], why: "Relaxed and seated, easy to join late or leave early." },
];

const DAYPART: Record<AiEventChoices["timing"], AiDaypart> = { weekday_lunch: "weekday_lunch", after_work: "after_work", weekend: "weekend_daytime" };
const GOAL_TEXT: Record<AiEventChoices["goal"], string> = { team_bonding: "team bonding", wellness: "wellness", learning: "learning", give_back: "giving back", celebrate: "celebrating", competition: "friendly competition" };
const CAPACITY: Record<AiEventChoices["groupSize"], number> = { small: 8, team: 24, company: 80 };
const COST: Record<AiEventChoices["budget"], number> = { free: 0, under_15: 1200, from_15_to_50: 3000, over_50: 6500 };

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ");
/** The server's safety check rejects notes that try to steer the model instead of describing the event. */
export function promptRejected(prompt: string): boolean {
  return /ignore (all |the )?(previous|prior|above) (instructions|rules)|disregard (the |all )?(system|previous) (prompt|instructions)|reveal (the |your )?system prompt/.test(norm(prompt));
}

/** Deterministic drafts: the best matches for the focus tags, goal and setting, three different activities. */
export function buildMockDrafts(choices: AiEventChoices, _prompt: string, count: number): GeneratedEventDraft[] {
  const score = (t: Template) =>
    t.tags.filter((tag) => choices.focusTagIds.includes(tag)).length * 3
    + (t.goals.includes(choices.goal) ? 2 : 0)
    + (choices.setting === "outdoors" ? (t.outdoor ? 2 : -2) : choices.setting === "indoors" ? (t.outdoor ? -2 : 1) : 0)
    + (choices.budget === "free" && t.venueType === "activity_venue" ? -3 : 0);
  const ranked = TEMPLATES.map((t, i) => ({ t, i, s: score(t) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, Math.max(1, Math.min(3, count)));
  return ranked.map(({ t }): GeneratedEventDraft => {
    const hit = t.tags.find((id) => choices.focusTagIds.includes(id));
    const cited = TOP.find((x) => x.tagId === (hit ?? t.tags[0]));
    const goal = GOAL_TEXT[choices.goal];
    const rationale = hit && cited
      ? `${t.why} ${bucketText(cited.bucket)} like ${tagName(hit)}.`
      : `${t.why} Suits your goal of ${goal}.`;
    const cover = COVERS.find((c) => c.id === t.cover) ?? COVERS[0];
    const cost = COST[choices.budget];
    return {
      title: t.title,
      description: t.text,
      tagIds: t.tags.filter((id) => TAGS.some((tag) => tag.id === id)),
      coverImageURL: cover.url,
      suggestedDaypart: DAYPART[choices.timing],
      durationMinutes: choices.timing === "weekday_lunch" ? Math.min(t.minutes, 60) : t.minutes,
      venueType: choices.setting === "outdoors" ? "park_or_outdoors" : t.venueType,
      venueSearchHint: t.hint,
      costCents: cost,
      costNote: cost > 0 ? "Covers supplies and snacks" : "",
      capacity: CAPACITY[choices.groupSize],
      isOutdoor: choices.setting === "outdoors" ? true : choices.setting === "indoors" ? false : t.outdoor,
      rationale,
    };
  });
}
