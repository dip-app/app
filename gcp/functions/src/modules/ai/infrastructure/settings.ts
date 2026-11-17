import type { AiSettings } from "../application/ports";
import { aiConfig, secretPresent } from "./aiConfig";

function int(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : fallback;
}

/** The demo provider returns fake drafts, so it is honored only inside the Functions emulator. */
export function providerFromEnv(env: NodeJS.ProcessEnv, warn?: (message: string) => void): "openai" | "demo" | "disabled" {
  if (env.AI_PROVIDER === "demo") {
    if (env.FUNCTIONS_EMULATOR === "true") return "demo";
    warn?.("AI_PROVIDER=demo is ignored outside the emulator; the AI feature is disabled.");
    return "disabled";
  }
  if (env.AI_PROVIDER === "openai") return "openai";
  return env.FUNCTIONS_EMULATOR === "true" ? "demo" : "openai";
}

/**
 * Budget defaults per company, sized for the cheap default models (about $0.001 typical and under $0.01 reserved per
 * generation): the generation caps bind long before these do. They mainly stop a costly model override from running away.
 */
export const DEFAULT_MONTHLY_BUDGET_CENTS = 200;
export const DEFAULT_DAILY_BUDGET_CENTS = 50;

/** The demo provider needs no key, so there the flag alone enables the feature. */
export function settingsFromEnv(env: NodeJS.ProcessEnv, secrets: { openai: string | undefined; jev?: string | undefined }): AiSettings {
  const config = aiConfig(env);
  const provider = providerFromEnv(env);
  const flag = env.AI_EVENTS_ENABLED === "true";
  const jevOn = (step: "triage" | "draftCheck") => config[step].provider === "jev" && secretPresent(secrets.jev);
  const decisionModel = (step: "triage" | "draftCheck") => (jevOn(step) ? config[step].jevModel : config[step].openaiModel);
  const fallbackModel = (step: "triage" | "draftCheck") => (jevOn(step) ? config[step].openaiModel : null);
  return {
    enabled: flag && (provider === "demo" || (provider === "openai" && secretPresent(secrets.openai))),
    models: {
      generate: config.generate.model,
      triage: decisionModel("triage"),
      draftCheck: decisionModel("draftCheck"),
      moderation: config.moderation.model,
      triageFallback: fallbackModel("triage"),
      draftCheckFallback: fallbackModel("draftCheck"),
    },
    monthlyBudgetMicros: int(env.AI_MONTHLY_BUDGET_CENTS, DEFAULT_MONTHLY_BUDGET_CENTS) * 10_000,
    dailyBudgetMicros: int(env.AI_DAILY_BUDGET_CENTS, DEFAULT_DAILY_BUDGET_CENTS) * 10_000,
    monthlyGenerationLimit: int(env.AI_MONTHLY_GENERATIONS, 30),
    dailyGenerationLimit: int(env.AI_DAILY_GENERATIONS_PER_ADMIN, 10),
    dailyFlagLimit: int(env.AI_DAILY_FLAG_LIMIT, 3),
    dailyAttemptLimit: int(env.AI_DAILY_ATTEMPTS_PER_ADMIN, 20),
    platformMonthlyBudgetMicros: int(env.AI_PLATFORM_MONTHLY_BUDGET_CENTS, 20000) * 10_000,
  };
}
