import type { DecisionPort, DecisionRequest, DecisionResult } from "../application/ports";
import type { AiConfig } from "./aiConfig";

/**
 * Routes each decision step to its configured provider: Jev only when the step says "jev" and a Jev key exists
 * (`jev` is null otherwise), else the OpenAI mini-tier fallback.
 */
export class StepDecisions implements DecisionPort {
  constructor(private readonly config: AiConfig, private readonly jev: DecisionPort | null, private readonly openai: DecisionPort) {}

  decide(request: DecisionRequest): Promise<DecisionResult> {
    const target = this.jev !== null && this.config[request.step].provider === "jev" ? this.jev : this.openai;
    return target.decide(request);
  }
}
