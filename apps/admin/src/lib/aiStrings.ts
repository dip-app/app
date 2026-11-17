// The single source of user-facing copy for the portal's AI features (Dipbot). A flat keyed object, so it can move to
// a full i18n catalog later: `{ai}` is the brand name (AI_NAME, one constant), other `{name}` slots are filled by
// `t()`. Plurals use `.one` / `.other` keys through `tn()`. US English, no em dashes.

export const AI_NAME = "Dipbot";

export const AI_STRINGS = {
  // Page, nav and access
  "nav.label": "{ai}",
  "page.title": "{ai}",
  "page.subtitle": "Work with {ai} to plan your next event: answer four quick questions, add a note, and get drafts to review.",
  "page.loading": "Loading {ai}",
  "access.capability": "plan events with {ai}",
  "off.title": "{ai} is off for your company",
  "off.body": "An owner can turn it on. Until then, create events the usual way.",
  "off.action": "New event",
  "privacy": "{ai} sees rounded interest counts, totals of past events and your choices. It never sees names or personal data.",

  // Steps
  "step.interests.label": "Interests",
  "step.interests.heading": "What people like",
  "step.goal.label": "Goal",
  "step.goal.heading": "What is the goal?",
  "step.group.label": "Group and setting",
  "step.group.heading": "Who is it for, and where?",
  "step.budget.label": "Budget and timing",
  "step.budget.heading": "What budget, and when?",
  "step.note.label": "Ask {ai}",
  "step.note.heading": "Anything else {ai} should know?",
  "stepper.label": "Steps",
  "stepper.done": ", done",
  "stepper.allDone": "All steps done",
  "stepper.compact": "Step {n} of {total}: {label}",
  "action.back": "Back",
  "action.next": "Next",
  "action.generate": "Generate drafts",

  // Interests step
  "interests.legend": "Interests, pick up to {n}",
  "interests.pick": "Pick up to {n}",
  "interests.atMax": "Up to {n}",
  "interests.theme": "This week’s theme:",
  "interests.themeFit": "Drafts can fit it.",
  "interests.noData": "Interest counts are not available yet, so pick any interests or let {ai} choose.",
  "interests.thin": "Fewer than 5 members: {names}",
  "interests.surprise": "Let {ai} choose",
  "interests.surpriseHint": "Any interest can fit",
  "bucket.20+": "20+ members",
  "bucket.10-19": "10 to 19 members",
  "bucket.5-9": "5 to 9 members",

  // Fieldset legends
  "legend.groupSize": "Group size",
  "legend.setting": "Setting",
  "legend.budget": "Budget per person",
  "legend.timing": "Timing",

  // Options
  "goal.team_bonding": "Team bonding", "goal.team_bonding.hint": "Get to know each other",
  "goal.wellness": "Wellness", "goal.wellness.hint": "Move, relax, recharge",
  "goal.learning": "Learning", "goal.learning.hint": "Try or teach something new",
  "goal.give_back": "Give back", "goal.give_back.hint": "Help the community",
  "goal.celebrate": "Celebrate", "goal.celebrate.hint": "Mark a win or a milestone",
  "goal.competition": "Friendly competition", "goal.competition.hint": "Teams, scores, bragging rights",
  "size.small": "Small", "size.small.hint": "Under 10 people",
  "size.team": "Team", "size.team.hint": "10 to 30 people",
  "size.company": "Company-wide", "size.company.hint": "Everyone is welcome",
  "setting.indoors": "Indoors", "setting.indoors.hint": "At the office or a venue",
  "setting.outdoors": "Outdoors", "setting.outdoors.hint": "Parks, trails, open air",
  "setting.offsite": "Nearby offsite", "setting.offsite.hint": "Somewhere close to the office",
  "budget.free": "Free", "budget.free.hint": "No cost per person",
  "budget.under_15": "Under $15", "budget.under_15.hint": "Per person",
  "budget.from_15_to_50": "$15 to $50", "budget.from_15_to_50.hint": "Per person",
  "budget.over_50": "Over $50", "budget.over_50.hint": "Per person",
  "timing.weekday_lunch": "Weekday lunch", "timing.weekday_lunch.hint": "Around noon",
  "timing.after_work": "After work", "timing.after_work.hint": "Weekday evening",
  "timing.weekend": "Weekend", "timing.weekend.hint": "Saturday or Sunday",

  // Note step
  "note.label": "Note for {ai} (optional)",
  "note.placeholder": "For example: something new, vegetarian food, easy for people who use a wheelchair",
  "note.chips": "Note ideas",
  "note.chip.new": "Something new for the team",
  "note.chip.vegetarian": "Vegetarian food options",
  "note.chip.wheelchair": "Easy for people who use a wheelchair",
  "note.chip.quiet": "Quiet and low pressure",
  "note.count": "Drafts",
  "note.quota": "Uses 1 of your {n} remaining today.",

  // Dipbot Suggest
  "suggest.feature": "{ai} Suggest",
  "suggest.count.one": "{ai} suggests 1 choice.",
  "suggest.count.other": "{ai} suggests {n} choices.",
  "suggest.poweredBy": "Powered by Jev.",
  "suggest.nothingSelected": "Nothing is selected until you choose.",
  "suggest.matched": "Your choices match {ai}’s suggestions.",
  "suggest.matchedHint": "Change anything before you generate.",
  "suggest.use": "Use suggestions",
  "suggest.applied": "Applied",
  "suggest.loading": "{ai} is looking at your members’ interests and past events…",
  "suggest.noData": "No suggestions yet. {ai} suggests choices once members pick interests or your company has past events.",
  "suggest.noFavorite": "No clear favorites this time, so every option is open.",
  "suggest.by.jev": "Suggested by Jev",
  "suggest.by.other": "Suggested",
  "suggest.spoken.jev": "Jev suggests this: {label}",
  "suggest.spoken.other": "Suggested: {label}",
  "level.perfect": "Perfect fit",
  "level.great": "Great choice",
  "level.good": "Good match",

  // Rail
  "rail.label": "Summary",
  "rail.choices": "Your choices",
  "rail.edit": ". Edit",
  "rail.notSet": "Not set",
  "rail.none": "None",
  "rail.usage": "Usage",
  "rail.left": "left today",
  "rail.monthly": "Monthly: {used} of {limit} used",
  "rail.monthlyAria": "{used} of {limit} monthly generations used",

  // Generating, errors, results
  "generating.label": "Generating drafts",
  "generating.status.one": "{ai} is writing 1 draft. This can take up to a minute.",
  "generating.status.other": "{ai} is writing {n} drafts. This can take up to a minute.",
  "error.label": "Drafts could not be written",
  "error.backToChoices": "Back to choices",
  "error.retry": "Try again",
  "error.offline": "We couldn’t reach the server. Check your connection and try again.",
  "limit.AI_DAILY_LIMIT": "You have used all {n} of today’s drafts. The limit resets tomorrow.",
  "limit.AI_MONTHLY_LIMIT": "Your company has used all {n} of this month’s generations. The limit resets on the first of next month.",
  "limit.AI_BUDGET_EXHAUSTED": "This month’s {ai} budget is used up. It resets on the first of next month.",
  "limit.AI_FLAG_LIMIT": "Several notes were turned down today, so generating is paused. Try again tomorrow.",
  "limit.AI_OUTPUT_INVALID": "{ai} returned drafts we couldn’t use. Nothing was counted against your limit. Try again.",
  "limit.AI_UNAVAILABLE": "{ai} is busy right now. Nothing was counted against your limit. Try again in a moment.",
  "limit.REQUEST_IN_PROGRESS": "This request is still running. Wait a moment, then try again.",
  "limit.REQUEST_REUSED": "That request was already used for different choices. Generate again to start a new one.",
  "limit.INSUFFICIENT_ROLE": "Only admins can use {ai}.",
  "results.label": "{ai}’s drafts",
  "results.ready": "{ai}’s drafts: {n} ready.",
  "results.review": "Review every detail before publishing.",
  "results.regenerate": "Regenerate",
  "results.regenerateLeft": "Regenerate ({n} left)",
  "results.startOver": "Start over",
  "draft.details": "Details",
  "draft.tags": "Tags",
  "draft.outdoors": "Outdoors",
  "draft.indoors": "Indoors",
  "draft.showMore": "Show more",
  "draft.showLess": "Show less",
  "draft.copy": "Copy text",
  "draft.copied": "Copied",
  "draft.open": "Open in editor",
  "editor.fromAi": "Filled from a {ai} draft. Pick a venue and time, review everything, then save.",
} as const;

export type AiStringKey = keyof typeof AI_STRINGS;
type Vars = Readonly<Record<string, string | number>>;

/** The string for `key` with `{ai}` and any `{name}` slots filled. Unknown slots are left as written. */
export function t(key: AiStringKey, vars: Vars = {}): string {
  const all: Vars = { ai: AI_NAME, ...vars };
  return AI_STRINGS[key].replace(/\{(\w+)\}/g, (slot, name: string) => (name in all ? String(all[name]) : slot));
}

/** Plural form: `${base}.one` when n is 1, else `${base}.other`, with `{n}` filled. */
export function tn(base: "suggest.count" | "generating.status", n: number, vars: Vars = {}): string {
  return t(`${base}.${n === 1 ? "one" : "other"}` as AiStringKey, { n, ...vars });
}

/** For keys built from data (option values, error reasons): the string, or null when the key does not exist. */
export function tMaybe(key: string, vars: Vars = {}): string | null {
  return key in AI_STRINGS ? t(key as AiStringKey, vars) : null;
}
