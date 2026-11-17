import type { AiSettings, LlmUsage } from "../application/ports";

export const GENERATE_MAX_TOKENS = 12_000;
export const DECISION_MAX_TOKENS = 2000;

interface Price { input: number; cachedInput: number; output: number }

const price = (input: number, cachedInput: number, output: number): Price => ({ input, cachedInput, output });

/**
 * Micro-USD per token, which equals USD per million tokens. OpenAI standard tier as listed on its pricing page on
 * November 17, 2026. Cached-input prices marked "assumed" are 10% of the input price (not listed by the provider).
 * Moderation is free. Jev (TypeSafe AI) bills input tokens only, so its output price is zero.
 */
export const MODEL_PRICES: Readonly<Record<string, Price>> = {
  "gpt-6-astra": price(10, 1, 50),
  "gpt-6.1-sol": price(2, 0.2, 10),
  "gpt-6.1-terra": price(1, 0.1, 5),
  "gpt-6-luna": price(0.1, 0.01, 0.5),
  "gpt-5.6-luna": price(0.2, 0.02, 1.2),
  "gpt-5.5": price(5, 0.5, 30),
  "gpt-5.4": price(2.5, 0.25, 15),
  "gpt-5.4-mini": price(0.75, 0.075, 4.5),
  "gpt-5.4-nano": price(0.2, 0.02, 1.25),
  "omni-moderation-latest": price(0, 0, 0),
  "jev-latest": price(0.042, 0.042, 0),
  "jev-1.14.0": price(0.042, 0.042, 0),
  "jev-1.13.0": price(0.042, 0.042, 0),
};

const KNOWN_IDS = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length);
const MOST_EXPENSIVE: Price = Object.values(MODEL_PRICES).reduce((top, p) => (p.output + p.input > top.output + top.input ? p : top));

/** Exact id, then longest known prefix (dated or suffixed ids), else the most expensive known prices. */
function priceFor(model: string): Price {
  if (Object.hasOwn(MODEL_PRICES, model)) return MODEL_PRICES[model]!;
  const prefix = KNOWN_IDS.find(id => model.startsWith(id));
  return prefix ? MODEL_PRICES[prefix]! : MOST_EXPENSIVE;
}

const count = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
const ceilMicros = (value: number) => Math.max(0, Math.ceil(value - 1e-9));

/** Cost of one call in whole micro-USD, rounded up. Cached tokens are part of input; reasoning tokens part of output. */
export function costMicros(model: string, usage: LlmUsage): number {
  const p = priceFor(model);
  const input = count(usage.inputTokens);
  const cached = Math.min(input, count(usage.cachedInputTokens));
  return ceilMicros((input - cached) * p.input + cached * p.cachedInput + count(usage.outputTokens) * p.output);
}

const callCost = (model: string, inputTokens: number, outputTokens: number) =>
  costMicros(model, { inputTokens, cachedInputTokens: 0, outputTokens, reasoningTokens: 0 });

/**
 * Upper bound of one generation at the token ceilings: one triage call, two generate calls (a retry) and three draft
 * checks (one per draft). Moderation is free.
 */
export function worstCaseMicros(settings: Pick<AiSettings, "models">): number {
  const { models } = settings;
  return callCost(models.triage, 2000, DECISION_MAX_TOKENS)
    + 2 * callCost(models.generate, 6000, GENERATE_MAX_TOKENS)
    + 3 * callCost(models.draftCheck, 1500, DECISION_MAX_TOKENS);
}
