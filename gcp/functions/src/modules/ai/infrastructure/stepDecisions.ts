import { LlmUnavailableError } from "../application/ports";
import type { DecisionPort, DecisionRequest, DecisionResult } from "../application/ports";
import type { AiConfig } from "./aiConfig";

/**
 * Routes each decision step through a fallback chain and returns the first provider that answers:
 * 1. Jev, when the step's provider is "jev" (the default) and a Jev key exists (`jev` is null otherwise);
 * 2. the cheap OpenAI model (null when there is no OpenAI key);
 * 3. the deterministic heuristics (keyword rules, free), so a provider outage never blocks the flow on its own.
 * The result's `provider` says who answered; generate.ts logs it and stores it on the request document.
 */
export class StepDecisions implements DecisionPort {
  constructor(
    private readonly config: AiConfig,
    private readonly jev: DecisionPort | null,
    private readonly openai: DecisionPort | null,
    private readonly heuristic: DecisionPort | null = null,
  ) {}

  /** Providers tried for a step, in order. */
  chain(step: DecisionRequest["step"]): DecisionPort[] {
    const chain: DecisionPort[] = [];
    if (this.jev !== null && this.config[step].provider === "jev") chain.push(this.jev);
    if (this.openai !== null) chain.push(this.openai);
    if (this.heuristic !== null) chain.push(this.heuristic);
    return chain;
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    let last: unknown = null;
    for (const provider of this.chain(request.step)) {
      try {
        return await provider.decide(request);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof LlmUnavailableError ? last : new LlmUnavailableError(null);
  }
}
