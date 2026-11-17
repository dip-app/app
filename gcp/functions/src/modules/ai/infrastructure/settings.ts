import type { AiSettings } from "../application/ports";

function int(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : fallback;
}

export function settingsFromEnv(env: NodeJS.ProcessEnv): AiSettings {
  return {
    enabled: env.AI_EVENTS_ENABLED === "true",
    generateModel: env.AI_GENERATE_MODEL?.trim() || "claude-sonnet-5-5",
    screenModel: env.AI_SCREEN_MODEL?.trim() || "claude-haiku-5-5",
    monthlyBudgetMicros: int(env.AI_MONTHLY_BUDGET_CENTS, 500) * 10_000,
    monthlyGenerationLimit: int(env.AI_MONTHLY_GENERATIONS, 30),
    dailyGenerationLimit: int(env.AI_DAILY_GENERATIONS_PER_ADMIN, 10),
    dailyFlagLimit: int(env.AI_DAILY_FLAG_LIMIT, 3),
  };
}

export function providerFromEnv(env: NodeJS.ProcessEnv): "anthropic" | "demo" {
  if (env.AI_PROVIDER === "demo") return "demo";
  if (env.AI_PROVIDER === "anthropic") return "anthropic";
  return env.FUNCTIONS_EMULATOR === "true" ? "demo" : "anthropic";
}
