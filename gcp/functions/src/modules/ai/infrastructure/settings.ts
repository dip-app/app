import type { AiSettings } from "../application/ports";
import { aiConfig, secretPresent } from "./aiConfig";

function int(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : fallback;
}

export function providerFromEnv(env: NodeJS.ProcessEnv): "openai" | "demo" {
  if (env.AI_PROVIDER === "demo") return "demo";
  if (env.AI_PROVIDER === "openai") return "openai";
  return env.FUNCTIONS_EMULATOR === "true" ? "demo" : "openai";
}

/** The demo provider needs no key, so there the flag alone enables the feature. */
export function settingsFromEnv(env: NodeJS.ProcessEnv, secrets: { openai: string | undefined }): AiSettings {
  const config = aiConfig(env);
  const flag = env.AI_EVENTS_ENABLED === "true";
  const decisionModel = (step: "triage" | "draftCheck") => (config[step].provider === "jev" ? config[step].jevModel : config[step].openaiModel);
  return {
    enabled: flag && (providerFromEnv(env) === "demo" || secretPresent(secrets.openai)),
    models: {
      generate: config.generate.model,
      triage: decisionModel("triage"),
      draftCheck: decisionModel("draftCheck"),
      moderation: config.moderation.model,
    },
    monthlyBudgetMicros: int(env.AI_MONTHLY_BUDGET_CENTS, 3000) * 10_000,
    dailyBudgetMicros: int(env.AI_DAILY_BUDGET_CENTS, 600) * 10_000,
    monthlyGenerationLimit: int(env.AI_MONTHLY_GENERATIONS, 30),
    dailyGenerationLimit: int(env.AI_DAILY_GENERATIONS_PER_ADMIN, 10),
    dailyFlagLimit: int(env.AI_DAILY_FLAG_LIMIT, 3),
  };
}
