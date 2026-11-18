import type { AiSettings, LlmUsage } from "../application/ports";
import { IDEA_LIMITS } from "./ideaTypes";

/** Output ceilings for reasoning models (gpt-5 and later, o-series), whose hidden reasoning counts as output. */
export const GENERATE_MAX_TOKENS = 12_000;
export const DECISION_MAX_TOKENS = 2000;
/** Output ceilings for small non-reasoning models (the defaults): three drafts fit in about 1,200 tokens. */
export const GENERATE_MAX_TOKENS_SMALL = 2500;
export const DECISION_MAX_TOKENS_SMALL = 400;
/** Input bounds used for the reservation: system prompt with examples plus the request, and a decision call. */
export const GENERATE_MAX_INPUT_TOKENS = 6000;
export const DECISION_MAX_INPUT_TOKENS = 2500;

/** Reasoning models reject `temperature` and need a larger output ceiling; older chat models reject `reasoning`. */
export function isReasoningModel(model: string): boolean {
  return /^(?:o\d|gpt-5|gpt-6|gpt-7)/.test(model.trim().toLowerCase());
}

/** Output token ceiling for a step on a given model. */
export function outputCeiling(step: "generate" | "decision", model: string): number {
  const reasoning = isReasoningModel(model);
  if (step === "generate") return reasoning ? GENERATE_MAX_TOKENS : GENERATE_MAX_TOKENS_SMALL;
  return reasoning ? DECISION_MAX_TOKENS : DECISION_MAX_TOKENS_SMALL;
}

interface Price { input: number; cachedInput: number; output: number }

const price = (input: number, cachedInput: number, output: number): Price => ({ input, cachedInput, output });

/**
 * Micro-USD per token, which equals USD per million tokens. OpenAI standard tier as listed on its pricing page on
 * November 17, 2026 (developers.openai.com/api/docs/pricing). gpt-4o-mini and gpt-4.1-mini are deprecated with a
 * shutdown on January 14, 2027; gpt-5-nano and gpt-5-mini on December 11, 2026; gpt-4.1-nano was shut down on
 * October 23, 2026 and is not listed.
 * Moderation is free. Jev (TypeSafe AI) bills input tokens only, so its output price is zero.
 */
export const MODEL_PRICES: Readonly<Record<string, Price>> = {
  "gpt-4o-mini": price(0.15, 0.075, 0.6),
  "gpt-4.1-mini": price(0.4, 0.1, 1.6),
  "gpt-5-nano": price(0.05, 0.005, 0.4),
  "gpt-5-mini": price(0.25, 0.025, 2),
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

/** Generate attempts per run (one retry) and the draft cap per attempt; review runs inside every attempt. */
export const GENERATE_ATTEMPTS = 2;
export const MAX_DRAFTS = 3;

type PricedStep = "triage" | "generate" | "draftCheck";

/**
 * Conservative cost of one call of a step at the token ceilings, including the OpenAI fallback of a decision step whose
 * primary provider is Jev (a failed Jev call is retried there). Charged when a call failed and its real usage is unknown.
 */
export function callWorstCaseMicros(settings: Pick<AiSettings, "models">, step: PricedStep): number {
  const { models } = settings;
  const decision = (model: string, fallback: string | null | undefined) =>
    callCost(model, DECISION_MAX_INPUT_TOKENS, outputCeiling("decision", model))
    + (fallback ? callCost(fallback, DECISION_MAX_INPUT_TOKENS, outputCeiling("decision", fallback)) : 0);
  if (step === "triage") return decision(models.triage, models.triageFallback);
  if (step === "generate") return callCost(models.generate, GENERATE_MAX_INPUT_TOKENS, outputCeiling("generate", models.generate));
  return decision(models.draftCheck, models.draftCheckFallback);
}

/**
 * Upper bound of one generation at the token ceilings: one triage, then per generate attempt (GENERATE_ATTEMPTS) one
 * generate call plus one draft check per draft (each with its decision fallback). Moderation is free; the heuristic
 * fallback costs nothing.
 */
export function worstCaseMicros(settings: Pick<AiSettings, "models">, drafts: number = MAX_DRAFTS): number {
  return callWorstCaseMicros(settings, "triage")
    + GENERATE_ATTEMPTS * (callWorstCaseMicros(settings, "generate") + drafts * callWorstCaseMicros(settings, "draftCheck"));
}

/** Output ceiling of one ideas turn: reasoning models need room for hidden reasoning on top of the ideas. */
export function ideaOutputCeiling(model: string): number {
  return isReasoningModel(model) ? 3 * IDEA_LIMITS.maxOutputTokens : IDEA_LIMITS.maxOutputTokens;
}

/**
 * Upper bound of one Dipbot ideas run on `model`: every turn (maxTurns plus the one bounded retry) at the input and
 * output ceilings. The ranking decision call is priced separately by the caller (it depends on the provider chain).
 */
export function ideasWorstCaseMicros(model: string): number {
  return (IDEA_LIMITS.maxTurns + 1) * callCost(model, IDEA_LIMITS.maxInputTokensPerTurn, ideaOutputCeiling(model));
}
