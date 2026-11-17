/**
 * The ONE place that names providers and model ids per step. Everything else (adapters, settings, pricing) reads this
 * module, so swapping a model is an environment change, not a code change.
 */
export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type DecisionProvider = "jev" | "openai-mini";

export interface GenerateConfig { provider: "openai"; model: string; effort: Effort; maxOutputTokens: number }
export interface DecisionStepConfig {
  provider: DecisionProvider;
  /** OpenAI model used when the provider is "openai-mini" (and as the fallback when Jev has no key). */
  openaiModel: string;
  effort: Effort;
  maxOutputTokens: number;
  jevModel: string;
}

export interface AiConfig {
  generate: GenerateConfig;
  triage: DecisionStepConfig;
  draftCheck: DecisionStepConfig;
  moderation: { model: string };
}

/** Model ids verified on November 17, 2026 (documentation only; nothing validates against this list). */
export const KNOWN_MODELS = {
  openai: [
    "gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra",
    "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "omni-moderation-latest",
  ],
  typesafe: ["jev-latest", "jev-1.13.0"],
  notes: "jev-latest is jev-1.14.0.",
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

function provider(raw: string | undefined): DecisionProvider {
  const value = raw?.trim().toLowerCase();
  return PROVIDERS.find(p => p === value) ?? "openai-mini";
}

export function aiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const jevModel = text(env.AI_JEV_MODEL, "jev-latest");
  const decision = (providerVar: string | undefined, modelVar: string | undefined): DecisionStepConfig => ({
    provider: provider(providerVar),
    openaiModel: text(modelVar, "gpt-6-luna"),
    effort: "low",
    maxOutputTokens: 2000,
    jevModel,
  });
  return {
    generate: {
      provider: "openai",
      model: text(env.AI_MODEL_GENERATE, "gpt-6-astra"),
      effort: effort(env.AI_EFFORT_GENERATE, "low"),
      maxOutputTokens: 12000,
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
