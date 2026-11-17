import type { AiEventChoices, GeneratedEventDraft } from "../../../generated/models";

/**
 * Closed vocabularies of the AI idea flow (contracts/v1 AiEventChoices and GeneratedEventDraft). Every structured part of a
 * request is one of these values, so nothing but the admin's free-text note reaches the model unvalidated.
 */
export const GOALS = ["team_bonding", "wellness", "learning", "give_back", "celebrate", "competition"] as const satisfies readonly AiEventChoices["goal"][];
export const GROUP_SIZES = ["small", "team", "company"] as const satisfies readonly AiEventChoices["groupSize"][];
export const SETTINGS = ["indoors", "outdoors", "offsite"] as const satisfies readonly AiEventChoices["setting"][];
export const BUDGETS = ["free", "under_15", "from_15_to_50", "over_50"] as const satisfies readonly AiEventChoices["budget"][];
export const TIMINGS = ["weekday_lunch", "after_work", "weekend"] as const satisfies readonly AiEventChoices["timing"][];
export const DAYPARTS = [
  "weekday_morning", "weekday_lunch", "weekday_afternoon", "after_work", "weekend_daytime", "weekend_evening",
] as const satisfies readonly GeneratedEventDraft["suggestedDaypart"][];
export const VENUE_TYPES = [
  "office", "park_or_outdoors", "restaurant_or_cafe", "activity_venue", "community_site",
] as const satisfies readonly GeneratedEventDraft["venueType"][];

/** Cover art the model may pick; each maps to an approved `catalog://default/<category>` value (see covers.ts). */
export const COVER_CATEGORIES = ["fitness", "outdoors", "hiking", "games", "cooking"] as const;
export type CoverCategory = (typeof COVER_CATEGORIES)[number];

/** Plain-language meaning of each choice, shown to the model (never the raw enum alone). */
export const CHOICE_LABELS = {
  goal: {
    team_bonding: "team bonding: people get to know each other",
    wellness: "wellness: movement, rest or mental health",
    learning: "learning: build a skill together",
    give_back: "give back: volunteering or a good cause",
    celebrate: "celebrate: mark a milestone or a season",
    competition: "friendly competition between teams or people",
  },
  groupSize: {
    small: "a small group, under 10 people",
    team: "a team, 10 to 30 people",
    company: "company-wide, open to everyone",
  },
  setting: {
    indoors: "indoors",
    outdoors: "outdoors",
    offsite: "a nearby offsite location",
  },
  budget: {
    free: "free for attendees (costCents must be 0)",
    under_15: "under $15 per person",
    from_15_to_50: "$15 to $50 per person",
    over_50: "over $50 per person",
  },
  timing: {
    weekday_lunch: "a weekday lunch break (about 30 to 75 minutes)",
    after_work: "after work on a weekday",
    weekend: "on the weekend",
  },
} as const;

/** Per-person cost bounds in cents for each budget choice; drafts outside them are clamped. */
export const BUDGET_CENTS: Readonly<Record<AiEventChoices["budget"], { min: number; max: number }>> = {
  free: { min: 0, max: 0 },
  under_15: { min: 0, max: 1500 },
  from_15_to_50: { min: 1500, max: 5000 },
  over_50: { min: 5000, max: 100_000 },
};

/** Capacity bounds per group size. */
export const GROUP_CAPACITY: Readonly<Record<AiEventChoices["groupSize"], { min: number; max: number }>> = {
  small: { min: 2, max: 10 },
  team: { min: 8, max: 30 },
  company: { min: 10, max: 10_000 },
};

export const LIMITS = {
  promptMax: 500,
  focusTagsMax: 3,
  draftsMax: 3,
  titleMax: 120,
  descriptionMax: 2000,
  tagsPerDraftMax: 5,
  venueHintMax: 120,
  costNoteMax: 200,
  rationaleMax: 160,
  durationMin: 15,
  durationMax: 720,
  costCentsMax: 100_000,
} as const;
