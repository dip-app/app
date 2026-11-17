import Anthropic from "@anthropic-ai/sdk";
import { LlmUnavailableError } from "../application/ports";
import type { LlmOutcome, LlmPort, LlmRequest, LlmUsage } from "../application/ports";

interface IterationLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** The slice of a Messages API response this adapter reads. */
export interface MessageLike {
  model: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: IterationLike & { iterations?: ReadonlyArray<IterationLike> | null };
}

/** Minimal structural client: only what we call, so tests can stub it without the network. */
export interface AnthropicLike {
  messages: { create(params: Record<string, unknown>): Promise<MessageLike> };
  beta: { messages: { create(params: Record<string, unknown>): Promise<MessageLike> } };
}

export interface AnthropicLlmOptions { client: AnthropicLike; generateModel: string; screenModel: string }

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AnthropicLlm implements LlmPort {
  constructor(private readonly options: AnthropicLlmOptions) {}

  async complete(request: LlmRequest): Promise<LlmOutcome> {
    const generate = request.purpose === "generate";
    const base = {
      model: generate ? this.options.generateModel : this.options.screenModel,
      max_tokens: request.maxTokens,
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: request.user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: request.schema } },
    };
    let response: MessageLike;
    try {
      response = generate
        ? await this.options.client.beta.messages.create({ ...base, betas: [FALLBACK_BETA], fallbacks: "default" })
        : await this.options.client.messages.create(base);
    } catch (error) {
      const status = error instanceof Anthropic.APIError && typeof error.status === "number" ? error.status : null;
      // Deliberately drops the SDK message: it can echo request details.
      throw new LlmUnavailableError(status);
    }
    return toOutcome(response);
  }
}

export function createAnthropicLlm(apiKey: string, models: { generateModel: string; screenModel: string }): AnthropicLlm {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 50_000 });
  const like: AnthropicLike = {
    messages: { create: params => client.messages.create(params as never) as unknown as Promise<MessageLike> },
    beta: { messages: { create: params => client.beta.messages.create(params as never) as unknown as Promise<MessageLike> } },
  };
  return new AnthropicLlm({ client: like, ...models });
}

function toOutcome(response: MessageLike): LlmOutcome {
  const usage = usageOf(response);
  const model = response.model;
  if (response.stop_reason === "refusal") return { kind: "refusal", usage, model };
  if (response.stop_reason === "max_tokens") return { kind: "truncated", usage, model };
  const text = response.content.filter(block => block.type === "text").map(block => block.text ?? "").join("");
  try {
    return { kind: "ok", json: JSON.parse(text) as unknown, usage, model };
  } catch {
    return { kind: "malformed", usage, model };
  }
}

function usageOf(response: MessageLike): LlmUsage {
  const u = response.usage;
  const usage: LlmUsage = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  // Fallback runs report every hop in iterations; meter the larger total so a declined-then-rescued call is paid for.
  const iterations = u.iterations;
  if (Array.isArray(iterations) && iterations.length > 0) {
    const sum = (pick: (i: IterationLike) => number | null | undefined) => iterations.reduce((total, i) => total + (pick(i) ?? 0), 0);
    usage.inputTokens = Math.max(usage.inputTokens, sum(i => i.input_tokens));
    usage.outputTokens = Math.max(usage.outputTokens, sum(i => i.output_tokens));
    usage.cacheReadTokens = Math.max(usage.cacheReadTokens, sum(i => i.cache_read_input_tokens));
    usage.cacheWriteTokens = Math.max(usage.cacheWriteTokens, sum(i => i.cache_creation_input_tokens));
  }
  return usage;
}
