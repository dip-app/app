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

function drafts(count: number, tagIds: readonly string[]) {
  return Array.from({ length: count }, (_, i) => {
    const t = TEMPLATES[i % TEMPLATES.length]!;
    return {
      title: t.title,
      description: t.description,
      tagIds: [...new Set([tagIds[i % tagIds.length]!, tagIds[(i + 1) % tagIds.length]!])],
      coverCategory: t.cover,
      suggestedDaypart: "weekday_afternoon",
      durationMinutes: 60,
      venueType: t.venue,
      venueSearchHint: t.hint,
      costCents: t.cost,
      costNote: t.cost > 0 ? "Covers snacks and drinks" : "",
      capacity: 20,
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
    let parsed = request.schema.safeParse({ drafts: drafts(count, focus.length > 0 ? focus : ["tag-social"]) });
    if (!parsed.success) {
      // Focus ids missing from the catalog: recover the allowed ids from the schema's enum error.
      const issue = parsed.error.issues.find(i => i.code === "invalid_value") as { values?: unknown[] } | undefined;
      const ids = (issue?.values ?? []).filter((v): v is string => typeof v === "string");
      if (ids.length > 0) parsed = request.schema.safeParse({ drafts: drafts(count, ids) });
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
