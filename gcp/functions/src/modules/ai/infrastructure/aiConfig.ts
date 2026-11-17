import { outputCeiling } from "../domain/pricing";

/**
 * The ONE place that names providers and model ids per step. Everything else (adapters, settings, pricing) reads this
 * module, so swapping a model is an environment change, not a code change.
 */
export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type DecisionProvider = "jev" | "openai-mini";

/**
 * `effort` is sent only to reasoning models and `temperature` only to non-reasoning models (each family rejects the
 * other parameter); `maxOutputTokens` follows the model family (domain/pricing.ts, outputCeiling).
 */
export interface GenerateConfig { provider: "openai"; model: string; effort: Effort; temperature: number; maxOutputTokens: number }
export interface DecisionStepConfig {
  /** "jev" (default) uses Jev whenever JEV_API_KEY holds a real value; "openai-mini" forces the OpenAI model. */
  provider: DecisionProvider;
  /** OpenAI model used when the provider is "openai-mini", when Jev has no key, and when a Jev call fails. */
  openaiModel: string;
  effort: Effort;
  temperature: number;
  maxOutputTokens: number;
  jevModel: string;
}

export interface AiConfig {
  generate: GenerateConfig;
  triage: DecisionStepConfig;
  draftCheck: DecisionStepConfig;
  moderation: { model: string };
}

/**
 * Defaults (owner decision, November 17, 2026): cheap, small, older OpenAI models, prompted well. gpt-4o-mini is the
 * cheapest still-available model with json_schema structured outputs (gpt-4.1-nano was shut down on October 23, 2026).
 * It is deprecated and shuts down on January 14, 2027: switch AI_MODEL_* before then.
 */
export const DEFAULT_GENERATE_MODEL = "gpt-4o-mini";
export const DEFAULT_DECISION_MODEL = "gpt-4o-mini";
export const DEFAULT_JEV_MODEL = "jev-latest";
/** Low temperatures: a little variety for drafting, none for typed decisions. */
export const GENERATE_TEMPERATURE = 0.3;
export const DECISION_TEMPERATURE = 0;

/** Model ids verified on November 17, 2026 (documentation only; nothing validates against this list). */
export const KNOWN_MODELS = {
  openai: [
    "gpt-4o-mini", "gpt-4.1-mini", "gpt-5-nano", "gpt-5-mini", "gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra",
    "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "omni-moderation-latest",
  ],
  typesafe: ["jev-latest", "jev-1.13.0"],
  notes: "jev-latest is jev-1.14.0. gpt-4o-mini and gpt-4.1-mini shut down January 14, 2027; gpt-5-nano and gpt-5-mini December 11, 2026.",
} as const;

const EFFORTS: readonly Effort[] = ["minimal", "low", "medium", "high", "xhigh"];
const PROVIDERS: readonly DecisionProvider[] = ["jev", "openai-mini"];

function text(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value ? value : fallback;
}

function effort(raw: string | undefined, fallback: Effort): Effort {
  const value = raw?.trim().toLowerCase();
  return EFFORTS.find(e => e === value) ?? fallback;
}

/** Jev unless explicitly "openai-mini"; the router still uses OpenAI when no Jev key exists. */
function provider(raw: string | undefined): DecisionProvider {
  const value = raw?.trim().toLowerCase();
  return PROVIDERS.find(p => p === value) ?? "jev";
}

export function aiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const jevModel = text(env.AI_JEV_MODEL, DEFAULT_JEV_MODEL);
  const decision = (providerVar: string | undefined, modelVar: string | undefined): DecisionStepConfig => {
    const openaiModel = text(modelVar, DEFAULT_DECISION_MODEL);
    return {
      provider: provider(providerVar),
      openaiModel,
      effort: "low",
      temperature: DECISION_TEMPERATURE,
      maxOutputTokens: outputCeiling("decision", openaiModel),
      jevModel,
    };
  };
  const generateModel = text(env.AI_MODEL_GENERATE, DEFAULT_GENERATE_MODEL);
  return {
    generate: {
      provider: "openai",
      model: generateModel,
      effort: effort(env.AI_EFFORT_GENERATE, "low"),
      temperature: GENERATE_TEMPERATURE,
      maxOutputTokens: outputCeiling("generate", generateModel),
    },
    triage: decision(env.AI_DECISION_PROVIDER_TRIAGE, env.AI_MODEL_TRIAGE),
    draftCheck: decision(env.AI_DECISION_PROVIDER_DRAFT_CHECK, env.AI_MODEL_DRAFT_CHECK),
    moderation: { model: text(env.AI_MODEL_MODERATION, "omni-moderation-latest") },
  };
}

/** True when a secret value looks real (not missing, blank or a placeholder such as "none"). */
export function secretPresent(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "none" && v !== "unset" && v !== "placeholder";
}
