import type { AgentModelPort, AgentTurnOutcome, AgentTurnRequest, DecisionPort, DecisionRequest, DecisionResult, LlmOutcome, LlmPort, LlmRequest, LlmUsage, ModerationResult } from "../application/ports";
import { benignDecision } from "./fakes";

const DEMO_USAGE: LlmUsage = { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 900, reasoningTokens: 0 };
const DEMO_MODEL = "demo";

const TEMPLATES = [
  { title: "Lunchtime cooking swap", description: "Bring a dish to share and swap recipes over lunch.\n\nEveryone leaves with a new favorite.", cover: "cooking", venue: "office", hint: "shared kitchen", cost: 0, outdoor: false },
  { title: "Park walk and picnic", description: "A relaxed walk followed by a picnic in the park.\n\nBring a blanket and a snack to share.", cover: "outdoors", venue: "park_or_outdoors", hint: "city park with lawn", cost: 500, outdoor: true },
  { title: "Board game afternoon", description: "Pick a table and play a few rounds of board games.\n\nNo experience needed, we teach as we go.", cover: "games", venue: "office", hint: "quiet meeting room", cost: 0, outdoor: false },
  { title: "After-work trivia", description: "Teams of four compete in a friendly trivia round.\n\nSnacks are on us.", cover: "games", venue: "restaurant_or_cafe", hint: "pub with quiz night", cost: 800, outdoor: false },
  { title: "Group stretch break", description: "Twenty minutes of guided stretching to reset the afternoon.\n\nWear whatever is comfortable.", cover: "fitness", venue: "office", hint: "open floor space", cost: 0, outdoor: false },
];

function focusTagIds(input: string): string[] {
  const body = /<request>\n([\s\S]*?)\n<\/request>/.exec(input)?.[1];
  if (!body) return [];
  try {
    const parsed = JSON.parse(body) as { focusInterests?: unknown };
    if (!Array.isArray(parsed.focusInterests)) return [];
    return parsed.focusInterests.flatMap(entry => {
      const id = (entry as { tagId?: unknown } | null)?.tagId;
      return typeof id === "string" ? [id] : [];
    });
  } catch {
    return [];
  }
}

/** The request's limits block (prompt.ts choiceLimits), so the canned drafts fit the bounded output schema. */
interface DemoLimits { cost: [number, number]; capacity: [number, number]; duration: [number, number]; dayparts: string[]; venues: string[] }

function limitsOf(input: string): DemoLimits | null {
  const body = /<request>\n([\s\S]*?)\n<\/request>/.exec(input)?.[1];
  if (!body) return null;
  try {
    const limits = (JSON.parse(body) as { limits?: Record<string, unknown> }).limits;
    if (!limits) return null;
    const range = (value: unknown): [number, number] => {
      const numbers = String(value).match(/\d+/g)?.map(Number) ?? [];
      return [numbers[0] ?? 0, numbers.length > 1 && !String(value).startsWith("0 (") ? numbers[1]! : numbers[0] ?? 0];
    };
    return {
      cost: range(limits.costCentsRange), capacity: range(limits.capacityRange), duration: range(limits.durationMinutesRange),
      dayparts: String(limits.dayparts ?? "").split(" or ").filter(Boolean), venues: String(limits.venueTypes ?? "").split(", ").filter(Boolean),
    };
  } catch {
    return null;
  }
}

const within = (value: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, value));

function drafts(count: number, tagIds: readonly string[], limits: DemoLimits | null) {
  return Array.from({ length: count }, (_, i) => {
    const t = TEMPLATES[i % TEMPLATES.length]!;
    const cost = limits ? within(t.cost, limits.cost) : t.cost;
    return {
      title: t.title,
      description: t.description,
      tagIds: [...new Set([tagIds[i % tagIds.length]!, tagIds[(i + 1) % tagIds.length]!])],
      coverCategory: t.cover,
      suggestedDaypart: limits?.dayparts[0] ?? "weekday_afternoon",
      durationMinutes: limits ? Math.ceil(within(60, limits.duration) / 15) * 15 : 60,
      venueType: !limits || limits.venues.includes(t.venue) ? t.venue : limits.venues[0]!,
      venueSearchHint: t.hint,
      costCents: cost,
      costNote: cost > 0 ? "Covers snacks and drinks" : "",
      capacity: limits ? within(20, limits.capacity) : 20,
      isOutdoor: t.outdoor,
      rationale: "A low-effort way for coworkers to meet across teams.",
    };
  });
}

/** Deterministic offline provider for the Firebase emulator and the portal demo. Only the generate step is supported. */
export class DemoLlm implements LlmPort {
  async generate<T>(request: LlmRequest<T>): Promise<LlmOutcome<T>> {
    if (request.step !== "generate") throw new Error("DemoLlm only drafts events; decisions use DemoDecisions.");
    const count = Math.min(Math.max(Number(/Write exactly (\d+) event draft/.exec(request.input)?.[1] ?? 3) || 3, 1), 10);
    const focus = focusTagIds(request.input);
    const limits = limitsOf(request.input);
    let parsed = request.schema.safeParse({ drafts: drafts(count, focus.length > 0 ? focus : ["tag-social"], limits) });
    if (!parsed.success) {
      // Focus ids missing from the catalog: recover the allowed ids from the schema's enum error.
      const issue = parsed.error.issues.find(i => i.code === "invalid_value") as { values?: unknown[] } | undefined;
      const ids = (issue?.values ?? []).filter((v): v is string => typeof v === "string");
      if (ids.length > 0) parsed = request.schema.safeParse({ drafts: drafts(count, ids, limits) });
    }
    if (!parsed.success) return { kind: "malformed", usage: DEMO_USAGE, model: DEMO_MODEL };
    return { kind: "ok", value: parsed.data, usage: DEMO_USAGE, model: DEMO_MODEL };
  }

  async moderate(inputs: readonly string[]): Promise<ModerationResult[]> {
    return inputs.map(() => ({ flagged: false, categories: [] }));
  }
}

/** Benign answers, except a triage injection flag for the classic phrases. */
export class DemoDecisions implements DecisionPort {
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const result = benignDecision(request);
    if (request.step === "triage" && request.questions.injection && /ignore previous instructions|system prompt/i.test(request.state)) {
      result.answers.injection = { type: "noul", noul: 0.95 };
    }
    return { ...result, usage: { inputTokens: 300, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 }, model: DEMO_MODEL };
  }
}

const DEMO_IDEAS = [
  { title: "Lunch walk and talk", description: "A relaxed 30 minute loop around the block with a coworker you do not work with every day. Wear comfortable shoes.", theme: "fitness", tagIds: ["tag-fitness", "tag-outdoors"], goal: "wellness", weekday: 3, daypart: "weekday_lunch", durationMinutes: 45, costBucket: "free", groupSize: "team", isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "city park with a loop path", why: "Easy to join and a good fit for a lunch hour.", considerationIds: [], catalogIdeaId: null },
  { title: "Potluck lunch and recipe swap", description: "Everyone brings a dish and the recipe. Share a long table and leave with new favorites.", theme: "food", tagIds: ["tag-food", "tag-cooking"], goal: "team_bonding", weekday: 4, daypart: "weekday_lunch", durationMinutes: 60, costBucket: "free", groupSize: "team", isOutdoor: false, venueType: "office", venueSearchHint: "shared kitchen", why: "Food events bring people together across teams.", considerationIds: [], catalogIdeaId: null },
  { title: "Board game afternoon", description: "Pick a table and play a few rounds. No experience needed, we teach as we go.", theme: "games", tagIds: ["tag-games", "tag-social"], goal: "team_bonding", weekday: 5, daypart: "weekday_afternoon", durationMinutes: 90, costBucket: "free", groupSize: "small", isOutdoor: false, venueType: "office", venueSearchHint: "quiet meeting room", why: "Games are an easy way to meet new people.", considerationIds: [], catalogIdeaId: null },
  { title: "Paint and sip evening", description: "A guided painting session with snacks. Every canvas comes out different.", theme: "arts", tagIds: ["tag-arts", "tag-chill"], goal: "celebrate", weekday: 2, daypart: "after_work", durationMinutes: 120, costBucket: "under_15", groupSize: "small", isOutdoor: false, venueType: "activity_venue", venueSearchHint: "art studio with group classes", why: "A creative break that needs no skills.", considerationIds: [], catalogIdeaId: null },
  { title: "Community cleanup morning", description: "Spend a weekend morning picking up litter in a local park, then share coffee.", theme: "volunteering", tagIds: ["tag-volunteering", "tag-outdoors"], goal: "give_back", weekday: 6, daypart: "weekend_daytime", durationMinutes: 120, costBucket: "free", groupSize: "company", isOutdoor: true, venueType: "community_site", venueSearchHint: "park cleanup day", why: "Giving back together builds team spirit.", considerationIds: [], catalogIdeaId: null },
];

/**
 * Deterministic offline tool-using model for the Firebase emulator: the first turn calls getTagUsage and getPastEvents, the
 * second answers with five canned ideas (the server still validates, schedules, covers and ranks them).
 */
export class DemoAgentModel implements AgentModelPort {
  async turn<T>(request: AgentTurnRequest<T>): Promise<AgentTurnOutcome<T>> {
    if (request.items.length === 0 && request.toolChoice === "auto") {
      return {
        kind: "calls", usage: { inputTokens: 800, cachedInputTokens: 0, outputTokens: 60, reasoningTokens: 0 }, model: DEMO_MODEL,
        calls: [{ id: "demo-1", name: "getTagUsage", arguments: "{}" }, { id: "demo-2", name: "getPastEvents", arguments: "{}" }],
      };
    }
    const usage = { inputTokens: 2400, cachedInputTokens: 0, outputTokens: 900, reasoningTokens: 0 };
    const parsed = request.schema.safeParse({ ideas: DEMO_IDEAS });
    return parsed.success ? { kind: "final", value: parsed.data, usage, model: DEMO_MODEL } : { kind: "malformed", usage, model: DEMO_MODEL };
  }
}

const DEMO_THEMES = [
  { title: "Lunch Walk Club", description: "Take a 20 minute walk at lunch on three days this week, alone or with a coworker. Post a photo from your route.", themeKey: "fitness", tagIds: ["tag-fitness", "tag-outdoors"], weekStart: null, why: ["A low-key way to move that fits a busy week."], catalogThemeId: null },
  { title: "Recipe Swap", description: "Cook something from a coworker's family recipe and share your own. Post a photo of the dish and its name.", themeKey: "food", tagIds: ["tag-food", "tag-cooking"], weekStart: null, why: ["Food themes get people talking across teams."], catalogThemeId: null },
  { title: "Five Minute Sketch", description: "Draw something on your desk for five minutes a day. No skills needed. Post your favorite sketch.", themeKey: "arts", tagIds: ["tag-arts", "tag-chill"], weekStart: null, why: ["A calm creative break anyone can try."], catalogThemeId: null },
  { title: "Song of the Day", description: "Share one song a day that gets you through the afternoon. Post the song and why you picked it.", themeKey: "music", tagIds: ["tag-music", "tag-social"], weekStart: null, why: ["Easy to join from any desk."], catalogThemeId: null },
];

/**
 * Deterministic offline tool-using model for Suggest theme in the Firebase emulator: the first turn reads the past themes
 * and the interest buckets, the second answers with four canned themes (the server still validates, de-duplicates and ranks).
 */
export class DemoThemeAgentModel implements AgentModelPort {
  async turn<T>(request: AgentTurnRequest<T>): Promise<AgentTurnOutcome<T>> {
    if (request.items.length === 0 && request.toolChoice === "auto") {
      return {
        kind: "calls", usage: { inputTokens: 700, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 }, model: DEMO_MODEL,
        calls: [{ id: "demo-1", name: "getPastThemes", arguments: "{}" }, { id: "demo-2", name: "getTagUsage", arguments: "{}" }],
      };
    }
    const usage = { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 0 };
    const parsed = request.schema.safeParse({ themes: DEMO_THEMES });
    return parsed.success ? { kind: "final", value: parsed.data, usage, model: DEMO_MODEL } : { kind: "malformed", usage, model: DEMO_MODEL };
  }
}
