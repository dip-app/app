import type { z } from "zod";
import type { CoverPickLimits } from "../../covers/domain/shortlist";
import type { AdminStore, Caller, RateLimiter } from "../../admin/application/ports";

export type { Caller };

/** Token counts reported by a provider for one call (cached input is a subset of input; reasoning a subset of output). */
export interface LlmUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** Steps of the flow. Each has its own provider and model id in the config module (infrastructure/aiConfig.ts). */
export type DecisionStep = "triage" | "draftCheck" | "coverPick";
/** "generate" drafts events; decision steps reach the LLM only through the OpenAI fallback of the DecisionPort. */
export type GenerationStep = "generate" | DecisionStep;

/**
 * One structured-output generation call. The zod schema is the single source of truth: the adapter turns it into the
 * provider's JSON schema and parses the reply with it. The parsed value is still untrusted business data; the domain
 * repairs and validates it again against the contract.
 */
export interface LlmRequest<T> {
  step: GenerationStep;
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
  /** Aborts the call when the run deadline passes. */
  signal?: AbortSignal;
}

/**
 * ok: parsed by the schema. refusal: the provider declined. truncated: hit the output limit. malformed: no parseable
 * output. Every outcome carries usage so spend is always metered.
 */
export type LlmOutcome<T> =
  | { kind: "ok"; value: T; usage: LlmUsage; model: string }
  | { kind: "refusal" | "truncated" | "malformed"; usage: LlmUsage; model: string };

/** Thrown by adapters for transport, auth, rate-limit or server errors (nothing billable is known). */
export class LlmUnavailableError extends Error {
  constructor(readonly status: number | null, message = "AI provider unavailable") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export interface ModerationResult {
  flagged: boolean;
  /** Category names that were flagged (never the text). */
  categories: string[];
}

export interface LlmPort {
  generate<T>(request: LlmRequest<T>): Promise<LlmOutcome<T>>;
  /** Free provider moderation (OpenAI omni-moderation). One result per input, in order. */
  moderate(inputs: readonly string[], signal?: AbortSignal): Promise<ModerationResult[]>;
}

/**
 * Decision questions (the TypeSafe AI "System One" primitives, https://docs.typesafe.ai/primitives): typed answers
 * picked from options defined in advance, each with a probability. Never free text.
 */
export type DecisionQuestion =
  | { type: "choice"; instructions: string; criteria: Readonly<Record<string, string>> }
  | { type: "score"; instructions: string; criteria: readonly string[] }
  /** Noul criteria: one sentence for yes, or concrete yes and no situations (TypeSafe's recommended form). */
  | { type: "noul"; instructions: string; criteria?: string | { true: string; false: string } };

export type DecisionAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  /** `score` is a position along the levels (0 = first level), possibly between two. */
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number }
  /** Probability that the answer is yes. */
  | { type: "noul"; noul: number };

export interface DecisionRequest {
  step: DecisionStep;
  /** The data the questions are about (plain text or JSON-encoded text). Treated as data, never as instructions. */
  state: string;
  questions: Readonly<Record<string, DecisionQuestion>>;
  /** Aborts the call when the run deadline passes. */
  signal?: AbortSignal;
}

export interface DecisionResult {
  /** Same keys as the request; every answer validated against the question (zod) before it is returned. */
  answers: Record<string, DecisionAnswer>;
  usage: LlmUsage;
  model: string;
  /** Who answered: Jev, the OpenAI fallback, or the deterministic last-resort heuristics. */
  provider: "jev" | "openai" | "heuristic";
}

/**
 * Decision provider: Jev (TypeSafe AI) by default whenever a Jev key exists, falling back to a cheap OpenAI model and
 * then to deterministic heuristics. Answers are hints for server logic (thresholds and fallbacks), never the only safety gate.
 */
export interface DecisionPort {
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

/** Per-company interest counts (companies/{c}/tagStats, built by the tag-counts module). */
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

/** Deployment-wide settings (environment and secrets presence); a company document can change limits and must opt in. */
export interface AiSettings {
  /** AI_EVENTS_ENABLED and the OpenAI key present. False makes the whole feature a clean no-op (AI_DISABLED). */
  enabled: boolean;
  /** Model id per step, used for pricing; the adapters read the same config module. */
  models: {
    generate: string; triage: string; draftCheck: string; moderation: string;
    /** OpenAI model that answers when the primary decision provider (Jev) fails; null or absent when OpenAI is primary. */
    triageFallback?: string | null; draftCheckFallback?: string | null;
  };
  /** Monthly spending cap per company in micro-USD (1 USD = 1,000,000). */
  monthlyBudgetMicros: number;
  /** Daily (UTC) spending cap per company in micro-USD. */
  dailyBudgetMicros: number;
  monthlyGenerationLimit: number;
  /** Per admin, per UTC day. */
  dailyGenerationLimit: number;
  /** Every reservation (failed runs included) per admin per UTC day; stops failing runs from draining the budget. */
  dailyAttemptLimit: number;
  /** Platform-wide spending ceiling per UTC month across all companies, in micro-USD. */
  platformMonthlyBudgetMicros: number;
  /** Declined notes per admin per UTC day before generation is blocked for the day. */
  dailyFlagLimit: number;
}

/** Content-free operational log line (ids, counts, model, outcome); never prompts, notes or drafts. */
export type AiLog = (event: string, fields: Readonly<Record<string, string | number | boolean | null>>, level?: "info" | "warn" | "error") => void;

export interface AiDeps {
  store: AdminStore;
  llm: LlmPort;
  decisions: DecisionPort;
  interests: InterestSource;
  catalog: TagCatalog;
  themes: ThemeSource;
  settings: AiSettings;
  /** Short-window burst limit shared with admin commands. */
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
  /** Overall run deadline in ms (default RUN_DEADLINE_MS). */
  deadlineMs?: number;
  /** Cover pick limits (defaults apply when absent). */
  coverLimits?: CoverPickLimits;
  /** Backoff sleep for the settle retry (tests inject a no-op). */
  sleep?: (ms: number) => Promise<void>;
}
