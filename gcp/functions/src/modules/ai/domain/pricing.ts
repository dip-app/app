import type { AiSettings, LlmUsage } from "../application/ports";

export const GENERATE_MAX_TOKENS = 8000;
export const SCREEN_MAX_TOKENS = 512;

interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

const price = (input: number, output: number): Price => ({ input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 });

/** Micro-USD per token (equal to dollars per million tokens). */
export const MODEL_PRICES: Readonly<Record<string, Price>> = {
  "claude-haiku-5-5": price(0.1, 0.5),
  "claude-sonnet-5-5": price(2, 10),
  "claude-sonnet-5": price(2, 10),
  "claude-opus-5-5": price(4, 20),
};

const KNOWN_IDS = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length);
const MOST_EXPENSIVE: Price = Object.values(MODEL_PRICES).reduce((top, p) => (p.output > top.output ? p : top));

/** Exact id, then longest known prefix (dated or suffixed ids), else the most expensive known prices. */
function priceFor(model: string): Price {
  if (Object.hasOwn(MODEL_PRICES, model)) return MODEL_PRICES[model]!;
  const prefix = KNOWN_IDS.find(id => model.startsWith(id));
  return prefix ? MODEL_PRICES[prefix]! : MOST_EXPENSIVE;
}

const count = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
const ceilMicros = (value: number) => Math.max(0, Math.ceil(value - 1e-9));

/** Cost of one call in whole micro-USD, rounded up. */
export function costMicros(model: string, usage: LlmUsage): number {
  const p = priceFor(model);
  return ceilMicros(
    count(usage.inputTokens) * p.input + count(usage.outputTokens) * p.output +
    count(usage.cacheReadTokens) * p.cacheRead + count(usage.cacheWriteTokens) * p.cacheWrite,
  );
}

/** Upper bound of one generation: one screen call plus two generate calls (a retry) at their token ceilings. */
export function worstCaseMicros(settings: Pick<AiSettings, "generateModel" | "screenModel">): number {
  const screen = priceFor(settings.screenModel);
  const generate = priceFor(settings.generateModel);
  const screenCost = 2000 * screen.input + SCREEN_MAX_TOKENS * screen.output;
  const generateCost = 6000 * generate.input + GENERATE_MAX_TOKENS * generate.output;
  return ceilMicros(screenCost + 2 * generateCost);
}
