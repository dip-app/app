import OpenAI from "openai";
import { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
import { LlmUnavailableError } from "../application/ports";
import type { AgentItem, AgentModelPort, AgentTurnOutcome, AgentTurnRequest, LlmUsage } from "../application/ports";
import { isReasoningModel } from "../domain/pricing";
import { IDEAS_TEMPERATURE, type Effort } from "./aiConfig";
import type { RequestOptionsLike } from "./openaiLlm";

/** One output item of a Responses API result, as far as this adapter reads it. */
export interface AgentOutputItem { type: string; id?: string; name?: string; call_id?: string; arguments?: string; content?: ReadonlyArray<{ type: string }> }

/** The slice of a Responses API result this adapter reads. */
export interface AgentResponseLike {
  model: string;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output_parsed?: unknown;
  output?: ReadonlyArray<AgentOutputItem>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

/** Minimal structural client: only what we call, so tests can stub it without the network. */
export interface OpenAiAgentClientLike {
  responses: { parse(params: Record<string, unknown>, options?: RequestOptionsLike): Promise<AgentResponseLike> };
}

export interface OpenAiAgentOptions { client: OpenAiAgentClientLike; model: string; effort?: Effort; temperature?: number }

/** Provider-neutral items to Responses API input items. Opaque items (reasoning) go back exactly as received. */
export function toInputItems(input: string, items: readonly AgentItem[]): unknown[] {
  const out: unknown[] = [{ role: "user", content: input }];
  for (const item of items) {
    if (item.type === "call") out.push({ type: "function_call", call_id: item.id, name: item.name, arguments: item.arguments });
    else if (item.type === "result") out.push({ type: "function_call_output", call_id: item.id, output: item.output });
    else if (item.type === "user") out.push({ role: "user", content: item.text });
    else out.push(item.item);
  }
  return out;
}

/**
 * The tool-using model of Dipbot daily ideas over the OpenAI Responses API: strict function tools generated from the
 * tools' zod argument schemas, strict structured output for the final answer, no storage at OpenAI. Reasoning models
 * (gpt-5 and later) get an effort and their encrypted reasoning items are passed back on the next turn; other models
 * get a temperature. SDK error messages are dropped because they can echo request details.
 */
export class OpenAiAgentModel implements AgentModelPort {
  constructor(private readonly options: OpenAiAgentOptions) {}

  async turn<T>(request: AgentTurnRequest<T>): Promise<AgentTurnOutcome<T>> {
    const { model, effort = "low", temperature = IDEAS_TEMPERATURE } = this.options;
    const reasoning = isReasoningModel(model);
    const tools = request.tools.map(tool => {
      const built = zodResponsesFunction({ name: tool.name, parameters: tool.args as never, description: tool.description });
      return { type: "function", name: built.name, description: built.description, parameters: built.parameters, strict: true };
    });
    let response: AgentResponseLike;
    try {
      response = await this.options.client.responses.parse({
        model,
        instructions: request.instructions,
        input: toInputItems(request.input, request.items),
        tools,
        tool_choice: request.toolChoice,
        parallel_tool_calls: true,
        text: { format: zodTextFormat(request.schema as never, request.schemaName) },
        max_output_tokens: request.maxOutputTokens,
        ...(reasoning ? { reasoning: { effort }, include: ["reasoning.encrypted_content"] } : { temperature }),
        store: false,
      }, request.signal ? { signal: request.signal } : undefined);
    } catch (error) {
      throw new LlmUnavailableError(statusOf(error));
    }
    const usage = usageOf(response);
    const used = response.model;
    const output = response.output ?? [];
    const refused = output.some(item => item.type === "message" && (item.content ?? []).some(part => part.type === "refusal"));
    if (refused) return { kind: "refusal", usage, model: used };
    if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") return { kind: "truncated", usage, model: used };
    const calls = output.flatMap(item => (item.type === "function_call" && item.call_id && item.name ? [{ id: item.call_id, name: item.name, arguments: item.arguments ?? "" }] : []));
    if (calls.length > 0) {
      const opaque = output.filter(item => item.type === "reasoning");
      return { kind: "calls", calls, usage, model: used, ...(opaque.length > 0 ? { opaque } : {}) };
    }
    if (response.output_parsed === null || response.output_parsed === undefined) return { kind: "malformed", usage, model: used };
    const checked = request.schema.safeParse(response.output_parsed);
    return checked.success ? { kind: "final", value: checked.data, usage, model: used } : { kind: "malformed", usage, model: used };
  }
}

function statusOf(error: unknown): number | null {
  return error instanceof OpenAI.APIError && typeof error.status === "number" ? error.status : null;
}

function usageOf(response: AgentResponseLike): LlmUsage {
  const u = response.usage;
  return {
    inputTokens: u?.input_tokens ?? 0,
    cachedInputTokens: u?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** No SDK retries (the agent loop is the only retry, so spend stays bounded) and a timeout under the 25 s run deadline plus margin. */
const SDK_TIMEOUT_MS = 30_000;

export function createOpenAiAgentModel(apiKey: string, model: string, effort?: Effort): OpenAiAgentModel {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: SDK_TIMEOUT_MS });
  const like: OpenAiAgentClientLike = {
    responses: { parse: (params, options) => client.responses.parse(params as never, options) as unknown as Promise<AgentResponseLike> },
  };
  return new OpenAiAgentModel({ client: like, model, ...(effort ? { effort } : {}) });
}
