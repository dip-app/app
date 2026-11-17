import type {
  AiSettings, CatalogTag, CurrentTheme, DecisionAnswer, DecisionRequest, DecisionResult, InterestSource, InterestStat, LlmOutcome, LlmUsage,
  TagCatalog, ThemeSource,
} from "../../../functions/src/modules/ai/application/ports";
import { DEFAULT_TAGS } from "../../../functions/src/modules/ai/infrastructure/firestoreSources";
import { benignDecision } from "../../../functions/src/modules/ai/infrastructure/fakes";

/** Shared builders for the AI event-draft tests. Nothing here talks to a real provider. */

export const SETTINGS: AiSettings = {
  enabled: true,
  models: {
    generate: "gpt-4o-mini", triage: "jev-latest", draftCheck: "jev-latest", moderation: "omni-moderation-latest",
    triageFallback: "gpt-4o-mini", draftCheckFallback: "gpt-4o-mini",
  },
  monthlyBudgetMicros: 10_000_000,
  dailyBudgetMicros: 5_000_000,
  monthlyGenerationLimit: 5,
  dailyGenerationLimit: 3,
  dailyFlagLimit: 2,
};

export const USAGE: LlmUsage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 0 };
/** Jev bills input tokens only. */
export const JEV_USAGE: LlmUsage = { inputTokens: 800, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

export const CHOICES = {
  focusTagIds: ["tag-games"], goal: "team_bonding", groupSize: "small", setting: "indoors", budget: "under_15", timing: "after_work",
} as const;

/** A valid idempotency key (UUID shape). */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const request = (n: number, extra: Record<string, unknown> = {}) => ({
  contractVersion: 1, companyId: "alpha", requestId: uuid(n), choices: { ...CHOICES, focusTagIds: [...CHOICES.focusTagIds] }, prompt: "", count: 3, ...extra,
});

const TITLES = ["Board game afternoon", "Lunchtime cooking swap", "Park walk and picnic", "Trivia with snacks", "Group stretch break"];

/** A raw model draft that passes the server validator. */
export function modelDraft(i: number, extra: Record<string, unknown> = {}) {
  return {
    title: TITLES[i % TITLES.length]!, description: "Bring a snack to share.\n\nEveryone can join at their own pace.", tagIds: ["tag-games"],
    coverCategory: "games", suggestedDaypart: "after_work", durationMinutes: 60, venueType: "office", venueSearchHint: "quiet meeting room",
    costCents: 500, costNote: "Snacks", capacity: 8, isOutdoor: false, rationale: "Games are a popular way to meet across teams.", ...extra,
  };
}

export const ok = (value: unknown, model = SETTINGS.models.generate): LlmOutcome<unknown> => ({ kind: "ok", value, usage: USAGE, model });
export const drafts = (n = 3): LlmOutcome<unknown> => ok({ drafts: Array.from({ length: n }, (_, i) => modelDraft(i)) });
export const bad = (kind: "refusal" | "truncated" | "malformed", model = SETTINGS.models.generate): LlmOutcome<unknown> => ({ kind, usage: USAGE, model });

/** A benign decision with Jev-priced usage, so tests can see the spend; `override` replaces single answers. */
export function decision(request: DecisionRequest, override: Record<string, DecisionAnswer> = {}, usage: LlmUsage = JEV_USAGE): DecisionResult {
  const base = benignDecision(request);
  return { ...base, answers: { ...base.answers, ...override }, usage, model: "jev-latest", provider: "jev" };
}

export const noulAnswer = (noul: number): DecisionAnswer => ({ type: "noul", noul });
export const scoreAnswer = (score: number): DecisionAnswer => ({ type: "score", score, probabilities: { [String(Math.round(score))]: 0.8 }, confidence: 0.8 });
export const choiceAnswer = (choice: string, probability: number): DecisionAnswer => ({ type: "choice", choice, probabilities: { [choice]: probability }, confidence: probability });

export class MemoryInterests implements InterestSource {
  readonly asked: string[] = [];
  constructor(public stats: InterestStat[] | null = null) {}
  async countsFor(companyId: string) { this.asked.push(companyId); return this.stats; }
}

export class MemoryCatalog implements TagCatalog {
  constructor(public tags: CatalogTag[] = DEFAULT_TAGS.map(tag => ({ ...tag }))) {}
  async list() { return this.tags; }
}

export class MemoryThemes implements ThemeSource {
  readonly asked: string[] = [];
  constructor(public theme: CurrentTheme | null = null) {}
  async current(companyId: string) { this.asked.push(companyId); return this.theme; }
}

/** Inner JSON of a `<name>` block in a user turn. */
export function blockOf(user: string, name: string): unknown {
  const match = new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(user);
  if (!match) throw new Error(`block ${name} missing`);
  return JSON.parse(match[1]!);
}

export const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
