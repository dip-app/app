import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { LlmUnavailableError } from "../application/ports";
import type { LlmOutcome, LlmPort, LlmRequest, LlmUsage, ModerationResult } from "../application/ports";
import { isReasoningModel } from "../domain/pricing";
import type { AiConfig, Effort } from "./aiConfig";

/** The slice of a Responses API result this adapter reads. */
export interface ParsedResponseLike {
  model: string;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output_parsed?: unknown;
  output?: ReadonlyArray<{ type: string; content?: ReadonlyArray<{ type: string }> }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

export interface ModerationLike {
  results: ReadonlyArray<{ flagged: boolean; categories: Record<string, boolean | null | undefined> }>;
}

/** Minimal structural client: only what we call, so tests can stub it without the network. */
export interface OpenAiLike {
  responses: { parse(params: Record<string, unknown>, options?: RequestOptionsLike): Promise<ParsedResponseLike> };
  moderations: { create(params: { model: string; input: string[] }, options?: RequestOptionsLike): Promise<ModerationLike> };
}

/** Per-request options of the SDK: the run deadline reaches the HTTP call through `signal`. */
export interface RequestOptionsLike { signal?: AbortSignal }

export interface OpenAiLlmOptions { client: OpenAiLike; config: AiConfig }

interface StepModel { model: string; effort: Effort; temperature: number }

export class OpenAiLlm implements LlmPort {
  constructor(private readonly options: OpenAiLlmOptions) {}

  private stepModel(step: LlmRequest<unknown>["step"]): StepModel {
    const { config } = this.options;
    if (step === "generate") return { model: config.generate.model, effort: config.generate.effort, temperature: config.generate.temperature };
    const decision = config[step];
    return { model: decision.openaiModel, effort: decision.effort, temperature: decision.temperature };
  }

  async generate<T>(request: LlmRequest<T>): Promise<LlmOutcome<T>> {
    const { model, effort, temperature } = this.stepModel(request.step);
    // Reasoning models take an effort and reject temperature; older chat models (the defaults) are the reverse.
    const tuning = isReasoningModel(model) ? { reasoning: { effort } } : { temperature };
    let response: ParsedResponseLike;
    try {
      response = await this.options.client.responses.parse({
        model,
        instructions: request.instructions,
        input: request.input,
        text: { format: zodTextFormat(request.schema as never, request.schemaName) },
        max_output_tokens: request.maxOutputTokens,
        ...tuning,
        // Do not keep prompts at OpenAI longer than needed.
        store: false,
      }, request.signal ? { signal: request.signal } : undefined);
    } catch (error) {
      // Deliberately drops the SDK message: it can echo request details.
      throw new LlmUnavailableError(statusOf(error));
    }
    const usage = usageOf(response);
    const used = response.model;
    const refused = (response.output ?? []).some(item => item.type === "message" && (item.content ?? []).some(part => part.type === "refusal"));
    if (refused) return { kind: "refusal", usage, model: used };
    if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") return { kind: "truncated", usage, model: used };
    if (response.output_parsed === null || response.output_parsed === undefined) return { kind: "malformed", usage, model: used };
    const checked = request.schema.safeParse(response.output_parsed);
    if (!checked.success) return { kind: "malformed", usage, model: used };
    return { kind: "ok", value: checked.data, usage, model: used };
  }

  async moderate(inputs: readonly string[], signal?: AbortSignal): Promise<ModerationResult[]> {
    if (inputs.length === 0) return [];
    let response: ModerationLike;
    try {
      response = await this.options.client.moderations.create({ model: this.options.config.moderation.model, input: [...inputs] }, signal ? { signal } : undefined);
    } catch (error) {
      throw new LlmUnavailableError(statusOf(error));
    }
    return inputs.map((_, i) => {
      const result = response.results[i];
      if (!result) throw new LlmUnavailableError(null);
      const categories = Object.entries(result.categories).filter(([, on]) => on === true).map(([name]) => name);
      return { flagged: result.flagged, categories };
    });
  }
}

function statusOf(error: unknown): number | null {
  return error instanceof OpenAI.APIError && typeof error.status === "number" ? error.status : null;
}

function usageOf(response: ParsedResponseLike): LlmUsage {
  const u = response.usage;
  return {
    inputTokens: u?.input_tokens ?? 0,
    cachedInputTokens: u?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** No SDK retries (the app loop is the only retry, so spend stays bounded) and a per-request timeout well under the run deadline. */
const SDK_TIMEOUT_MS = 50_000;

export function createOpenAiLlm(apiKey: string, config: AiConfig): OpenAiLlm {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: SDK_TIMEOUT_MS });
  const like: OpenAiLike = {
    responses: { parse: (params, options) => client.responses.parse(params as never, options) as unknown as Promise<ParsedResponseLike> },
    moderations: { create: (params, options) => client.moderations.create(params as never, options) as unknown as Promise<ModerationLike> },
  };
  return new OpenAiLlm({ client: like, config });
}
