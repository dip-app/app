import type { AdminStore, Caller, RateLimiter } from "../../admin/application/ports";

export type { Caller };

/** Token counts reported by the provider for one call. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * One structured-output call. `purpose` picks the model tier (screen: cheap classifier, generate: drafting); the
 * adapter owns model ids, effort and SDK details. `schema` is the JSON schema the provider constrains output to.
 */
export interface LlmRequest {
  purpose: "screen" | "generate";
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

/**
 * ok: parsed JSON (still untrusted; the domain validates it). refusal: the provider's safety stop. truncated: hit
 * max_tokens. malformed: text that is not JSON. Every outcome carries usage so spend is always metered.
 */
export type LlmOutcome =
  | { kind: "ok"; json: unknown; usage: LlmUsage; model: string }
  | { kind: "refusal" | "truncated" | "malformed"; usage: LlmUsage; model: string };

/** Thrown by adapters for transport, auth, rate-limit or server errors (nothing billable is known). */
export class LlmUnavailableError extends Error {
  constructor(readonly status: number | null, message = "LLM provider unavailable") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export interface LlmPort {
  complete(request: LlmRequest): Promise<LlmOutcome>;
}

/** Per-company interest counts (companies/{c}/tagStats, built by the tag-counts work, TAG-1 to TAG-6). */
export interface InterestStat { tagId: string; memberCount: number }

export interface InterestSource {
  /** Exact counts for the company, or null when no stats exist yet. Never leaves the server unbucketed. */
  countsFor(companyId: string): Promise<InterestStat[] | null>;
}

export interface CatalogTag { id: string; name: string }

export interface TagCatalog {
  /** The global tag catalog (tags/{tagId}), in display order. */
  list(): Promise<CatalogTag[]>;
}

export interface CurrentTheme { title: string; tagIds: string[] }

export interface ThemeSource {
  /** The company's weekly theme running at `now`, if any. */
  current(companyId: string, now: Date): Promise<CurrentTheme | null>;
}

/** Deployment-wide settings (environment); a company document can narrow or widen limits and must opt in. */
export interface AiSettings {
  /** Global kill switch (AI_EVENTS_ENABLED). */
  enabled: boolean;
  generateModel: string;
  screenModel: string;
  /** Monthly spending cap per company in micro-USD (1 USD = 1,000,000). */
  monthlyBudgetMicros: number;
  monthlyGenerationLimit: number;
  /** Per admin, per UTC day. */
  dailyGenerationLimit: number;
  /** Declined notes per admin per UTC day before generation is blocked for the day. */
  dailyFlagLimit: number;
}

/** Content-free operational log line (ids, counts, model, outcome); never prompts, notes or drafts. */
export type AiLog = (event: string, fields: Readonly<Record<string, string | number | boolean | null>>) => void;

export interface AiDeps {
  store: AdminStore;
  llm: LlmPort;
  interests: InterestSource;
  catalog: TagCatalog;
  themes: ThemeSource;
  settings: AiSettings;
  /** Short-window burst limit shared with admin commands. */
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
}
