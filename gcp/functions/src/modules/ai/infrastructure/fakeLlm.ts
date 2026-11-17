import type { LlmOutcome, LlmPort, LlmRequest } from "../application/ports";

export type ScriptStep = LlmOutcome | Error | ((request: LlmRequest) => LlmOutcome | Promise<LlmOutcome>);

/** Returns scripted steps in order and records every request. For tests. */
export class ScriptedLlm implements LlmPort {
  readonly calls: LlmRequest[] = [];
  private index = 0;

  constructor(private readonly steps: ScriptStep[]) {}

  async complete(request: LlmRequest): Promise<LlmOutcome> {
    this.calls.push(request);
    const step = this.steps[this.index++];
    if (step === undefined) throw new Error(`ScriptedLlm: script exhausted at call ${this.index}`);
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(request) : step;
  }
}

const DEMO_USAGE = { inputTokens: 1200, outputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 };
const DEMO_MODEL = "demo-fake";

const TEMPLATES = [
  { title: "Lunchtime cooking swap", description: "Bring a dish to share and swap recipes over lunch.\n\nEveryone leaves with a new favorite.", cover: "cooking", venue: "office", hint: "shared kitchen", cost: 0, outdoor: false },
  { title: "Park walk and picnic", description: "A relaxed walk followed by a picnic in the park.\n\nBring a blanket and a snack to share.", cover: "outdoors", venue: "park_or_outdoors", hint: "city park with lawn", cost: 500, outdoor: true },
  { title: "Board game afternoon", description: "Pick a table and play a few rounds of board games.\n\nNo experience needed, we teach as we go.", cover: "games", venue: "office", hint: "quiet meeting room", cost: 0, outdoor: false },
  { title: "After-work trivia", description: "Teams of four compete in a friendly trivia round.\n\nSnacks are on us.", cover: "games", venue: "restaurant_or_cafe", hint: "pub with quiz night", cost: 800, outdoor: false },
  { title: "Group stretch break", description: "Twenty minutes of guided stretching to reset the afternoon.\n\nWear whatever is comfortable.", cover: "fitness", venue: "office", hint: "open floor space", cost: 0, outdoor: false },
];

interface EnumNode { enum?: string[]; items?: { enum?: string[] } }

function enumOf(schema: Record<string, unknown>, field: string): string[] | null {
  const props = (schema.properties as { drafts?: { items?: { properties?: Record<string, EnumNode> } } } | undefined)?.drafts?.items?.properties;
  const node = props?.[field];
  const values = node?.enum ?? node?.items?.enum;
  return Array.isArray(values) && values.length > 0 ? values : null;
}

function focusTagIds(user: string): string[] {
  const block = /<request>\n([\s\S]*?)\n<\/request>/.exec(user)?.[1];
  if (!block) return [];
  try {
    const parsed = JSON.parse(block) as { focusInterests?: unknown };
    if (!Array.isArray(parsed.focusInterests)) return [];
    return parsed.focusInterests.flatMap(entry => {
      const id = (entry as { tagId?: unknown } | null)?.tagId;
      return typeof id === "string" ? [id] : [];
    });
  } catch {
    return [];
  }
}

/** Deterministic offline provider for the Firebase emulator and the portal demo. */
export class DemoLlm implements LlmPort {
  async complete(request: LlmRequest): Promise<LlmOutcome> {
    if (request.purpose === "screen") {
      const note = /<admin_note>([\s\S]*?)<\/admin_note>/.exec(request.user)?.[1] ?? "";
      const bad = /ignore previous instructions|system prompt/i.test(note);
      return { kind: "ok", json: { verdict: bad ? "injection" : "ok" }, usage: DEMO_USAGE, model: DEMO_MODEL };
    }
    const count = Math.min(Math.max(Number(/Write exactly (\d+) event draft/.exec(request.user)?.[1] ?? 3) || 3, 1), 10);
    const allTags = enumOf(request.schema, "tagIds") ?? ["tag-social"];
    const focus = focusTagIds(request.user).filter(id => allTags.includes(id));
    const pool = focus.length > 0 ? focus : allTags;
    const pick = (field: string, wanted: string) => {
      const values = enumOf(request.schema, field);
      return values === null || values.includes(wanted) ? wanted : values[0] ?? wanted;
    };
    const drafts = Array.from({ length: count }, (_, i) => {
      const t = TEMPLATES[i % TEMPLATES.length]!;
      const tagIds = [...new Set([pool[i % pool.length]!, pool[(i + 1) % pool.length]!])];
      return {
        title: t.title,
        description: t.description,
        tagIds,
        coverCategory: pick("coverCategory", t.cover),
        suggestedDaypart: pick("suggestedDaypart", "weekday_afternoon"),
        durationMinutes: 60,
        venueType: pick("venueType", t.venue),
        venueSearchHint: t.hint,
        costCents: t.cost,
        costNote: t.cost > 0 ? "Covers snacks and drinks" : "",
        capacity: 20,
        isOutdoor: t.outdoor,
        rationale: "A low-effort way for coworkers to meet across teams.",
      };
    });
    return { kind: "ok", json: { drafts }, usage: DEMO_USAGE, model: DEMO_MODEL };
  }
}
