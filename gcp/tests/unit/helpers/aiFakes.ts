import type {
  AiSettings, CatalogTag, CurrentTheme, InterestSource, InterestStat, LlmOutcome, TagCatalog, ThemeSource,
} from "../../../functions/src/modules/ai/application/ports";
import { DEFAULT_TAGS } from "../../../functions/src/modules/ai/infrastructure/firestoreSources";

/** Shared builders for the AI event-draft tests. Nothing here talks to a real provider. */

export const SETTINGS: AiSettings = {
  enabled: true,
  generateModel: "claude-sonnet-5-5",
  screenModel: "claude-haiku-5-5",
  monthlyBudgetMicros: 10_000_000,
  monthlyGenerationLimit: 5,
  dailyGenerationLimit: 3,
  dailyFlagLimit: 2,
};

export const USAGE = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

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

export const ok = (json: unknown, model = SETTINGS.generateModel): LlmOutcome => ({ kind: "ok", json, usage: USAGE, model });
export const drafts = (n = 3): LlmOutcome => ok({ drafts: Array.from({ length: n }, (_, i) => modelDraft(i)) });
export const verdict = (v: string): LlmOutcome => ok({ verdict: v }, SETTINGS.screenModel);
export const bad = (kind: "refusal" | "truncated" | "malformed", model = SETTINGS.generateModel): LlmOutcome => ({ kind, usage: USAGE, model });

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
