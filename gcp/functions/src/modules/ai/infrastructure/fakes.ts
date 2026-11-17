import type {
  DecisionPort, DecisionRequest, DecisionResult, LlmOutcome, LlmPort, LlmRequest, LlmUsage, ModerationResult,
} from "../application/ports";

/** Scripted fakes for unit and emulator tests: no network, no key, deterministic. */
export const ZERO_USAGE: LlmUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

export type GenerateStep = LlmOutcome<unknown> | Error | ((request: LlmRequest<unknown>) => LlmOutcome<unknown> | Promise<LlmOutcome<unknown>>);
export type ModerateStep = ModerationResult[] | Error | ((inputs: readonly string[]) => ModerationResult[] | Promise<ModerationResult[]>);

export class ScriptedLlm implements LlmPort {
  readonly calls: LlmRequest<unknown>[] = [];
  readonly moderationCalls: string[][] = [];
  private generateIndex = 0;
  private moderateIndex = 0;

  /** `moderation` defaults to "nothing flagged" for every input once its script (if any) runs out. */
  constructor(private readonly script: GenerateStep[], private readonly moderation: ModerateStep[] = []) {}

  async generate<T>(request: LlmRequest<T>): Promise<LlmOutcome<T>> {
    this.calls.push(request as LlmRequest<unknown>);
    const step = this.script[this.generateIndex++];
    if (step === undefined) throw new Error(`ScriptedLlm: no scripted outcome for call ${this.generateIndex}`);
    if (step instanceof Error) throw step;
    const outcome = typeof step === "function" ? await step(request as LlmRequest<unknown>) : step;
    return outcome as LlmOutcome<T>;
  }

  async moderate(inputs: readonly string[]): Promise<ModerationResult[]> {
    this.moderationCalls.push([...inputs]);
    const step = this.moderation[this.moderateIndex++];
    if (step === undefined) return inputs.map(() => ({ flagged: false, categories: [] }));
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(inputs) : step;
  }
}

/** A harmless answer to every question: no on every Noul, the first option of a Choice, the third Score level. */
export function benignDecision(request: DecisionRequest): DecisionResult {
  const answers: DecisionResult["answers"] = {};
  for (const [key, question] of Object.entries(request.questions)) {
    if (question.type === "noul") {
      answers[key] = { type: "noul", noul: 0.02 };
    } else if (question.type === "choice") {
      const options = Object.keys(question.criteria);
      const probabilities = Object.fromEntries(options.map((option, i) => [option, i === 0 ? 0.9 : 0.1 / Math.max(1, options.length - 1)]));
      answers[key] = { type: "choice", choice: options[0]!, probabilities, confidence: 0.9 };
    } else {
      const level = Math.min(2, question.criteria.length - 1);
      const probabilities = Object.fromEntries(question.criteria.map((_, i) => [String(i), i === level ? 0.8 : 0.2 / Math.max(1, question.criteria.length - 1)]));
      answers[key] = { type: "score", score: level, probabilities, confidence: 0.8 };
    }
  }
  return { answers, usage: ZERO_USAGE, model: "fake-decisions", provider: "openai" };
}

export type DecisionStepScript = DecisionResult | Error | ((request: DecisionRequest) => DecisionResult | Promise<DecisionResult>);

export class ScriptedDecisions implements DecisionPort {
  readonly calls: DecisionRequest[] = [];
  private index = 0;

  /** Falls back to `benignDecision` once the script runs out. */
  constructor(private readonly script: DecisionStepScript[] = []) {}

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    this.calls.push(request);
    const step = this.script[this.index++];
    if (step === undefined) return benignDecision(request);
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(request) : step;
  }
}
