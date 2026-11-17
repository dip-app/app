import type { DecisionPort, DecisionRequest, DecisionResult, LlmOutcome, LlmPort, LlmRequest, LlmUsage, ModerationResult } from "../application/ports";
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
