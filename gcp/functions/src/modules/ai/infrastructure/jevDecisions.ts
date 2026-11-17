import { z } from "zod";
import { LlmUnavailableError } from "../application/ports";
import type { DecisionAnswer, DecisionPort, DecisionRequest, DecisionResult } from "../application/ports";

/** TypeSafe AI "System One" (Jev): https://docs.typesafe.ai . Plain fetch; no SDK dependency. */
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface JevDecisionsOptions { apiKey: string; model: string; fetch?: typeof fetch; timeoutMs?: number }

const unit = z.number().min(0).max(1);
const probabilities = z.record(z.string(), unit);
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.discriminatedUnion("type", [
    z.object({ type: z.literal("choice"), choice: z.string(), confidence: unit, probabilities }),
    z.object({ type: z.literal("score"), score: z.number().finite(), confidence: unit, probabilities }),
    z.object({ type: z.literal("noul"), noul: unit }),
  ])),
  usage: z.object({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) }),
});

export class JevDecisions implements DecisionPort {
  constructor(private readonly options: JevDecisionsOptions) {}

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const questions: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(request.questions)) {
      if (q.type === "noul") {
        const criteria = typeof q.criteria === "string" ? { true: q.criteria } : q.criteria;
        questions[id] = { type: "noul", instructions: q.instructions, ...(criteria ? { criteria } : {}) };
      }
      else questions[id] = { type: q.type, instructions: q.instructions, criteria: q.criteria };
    }
    const body = JSON.stringify({ model: this.options.model, state: request.state, questions });
    const doFetch = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await doFetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: request.signal
          ? AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs ?? 15_000), request.signal])
          : AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch {
      throw new LlmUnavailableError(null);
    }
    if (!response.ok) throw new LlmUnavailableError(response.status);
    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(await response.json());
    } catch {
      throw new LlmUnavailableError(null);
    }
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const answer = parsed.answers[id];
      if (!answer || answer.type !== question.type) throw new LlmUnavailableError(null);
      if (answer.type === "choice" && question.type === "choice") {
        if (!Object.keys(question.criteria).includes(answer.choice)) throw new LlmUnavailableError(null);
        answers[id] = { type: "choice", choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence };
      } else if (answer.type === "score" && question.type === "score") {
        if (answer.score < 0 || answer.score > question.criteria.length - 1) throw new LlmUnavailableError(null);
        answers[id] = { type: "score", score: answer.score, probabilities: answer.probabilities, confidence: answer.confidence };
      } else if (answer.type === "noul") {
        answers[id] = { type: "noul", noul: answer.noul };
      } else {
        throw new LlmUnavailableError(null);
      }
    }
    return {
      answers,
      usage: { inputTokens: parsed.usage.input_tokens, cachedInputTokens: 0, outputTokens: parsed.usage.output_tokens, reasoningTokens: 0 },
      model: parsed.model,
      provider: "jev",
    };
  }
}
