import { MONTH_NAMES } from "../../suggestions/domain/signals";
import { sizeBucket } from "../../suggestions/domain/questions";
import { CONSIDERATION_IDS } from "../domain/considerations";
import { ideaToolDefinitions, runIdeaTool } from "../domain/ideaTools";
import { IDEA_LIMITS, modelIdeasSchema, type IdeaSnapshot, type ModelIdea, type ToolTrace } from "../domain/ideaTypes";
import { parseModelIdeas } from "../domain/ideaValidate";
import type { AgentItem, AgentModelPort, AgentTurnOutcome, LlmUsage } from "./ports";

/**
 * The tool-using loop of Dipbot daily ideas (docs/design/stretch/dipbot-daily-ideas.md, Agent loop). Limits come from
 * IDEA_LIMITS: 6 tool calls in total, 4 turns (the last forces the answer), one bounded retry for a malformed answer and a
 * whole-run deadline that aborts the provider call. The tools read the snapshot only, so the model cannot reach another
 * company whatever arguments it sends.
 */

export const IDEA_INSTRUCTIONS = [
  "You are Dipbot, an assistant that suggests workplace social events for one company's HR admin.",
  "You have read-only data tools about this company: getPastEvents, getTagUsage, getUpcomingCalendar, getAttendanceTrends, getIdeaCatalog and getAvailableCoverLabels.",
  "Call 2 to 4 tools first, in parallel when you can, then answer. Do not call more than 6 tools in total.",
  "Answer with 4 to 6 event ideas across at least 3 different themes. Prefer what members like and what filled up before; avoid repeating recent or scheduled events.",
  "In each why line quote only numbers that appear in your tool results, or use no numbers at all.",
  "Never mention people, names, links, emails or phone numbers. Use generic venue words, never business names.",
  "Write in US English, in plain words, without em dashes.",
].join("\n");

export const RETRY_TEXT = "Return only the JSON object with 4 to 6 ideas.";

export interface IdeaAgentDeps {
  model: AgentModelPort;
  /** Whole-run deadline in ms (default IDEA_LIMITS.deadlineMs). */
  deadlineMs?: number;
  /** An outer signal (for example a request abort); aborting it ends the run as a deadline. */
  signal?: AbortSignal;
}

export type IdeaAgentOutcome = "ok" | "malformed" | "deadline" | "unavailable" | "refusal";

export interface IdeaAgentResult {
  /** The validated model answer, or null (the caller then falls back to the catalog and refunds the run). */
  modelIdeas: ModelIdea[] | null;
  traces: ToolTrace[];
  usage: { tokensIn: number; tokensOut: number; cachedIn: number; reasoning: number };
  model: string;
  turns: number;
  outcome: IdeaAgentOutcome;
}

/** One-line company context: season, month, how much data there is and the member size bucket. */
export function ideaInput(snapshot: IdeaSnapshot): string {
  const s = snapshot.summary;
  const data = s.dataLevel === "none" ? "no event history yet" : s.dataLevel === "some" ? "some event history" : "rich event history";
  return `Company context: ${s.season}, ${MONTH_NAMES[s.month - 1]}, ${data}, ${sizeBucket(s.memberCount)}. Suggest events for the next 4 weeks.`;
}

export async function runIdeaAgent(deps: IdeaAgentDeps, snapshot: IdeaSnapshot): Promise<IdeaAgentResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.deadlineMs ?? IDEA_LIMITS.deadlineMs);
  const onOuterAbort = () => controller.abort();
  deps.signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (deps.signal?.aborted) controller.abort();

  const tools = ideaToolDefinitions();
  const schema = modelIdeasSchema(snapshot.catalogTags.map(t => t.id), CONSIDERATION_IDS);
  const input = ideaInput(snapshot);
  const items: AgentItem[] = [];
  const traces: ToolTrace[] = [];
  const total = { tokensIn: 0, tokensOut: 0, cachedIn: 0, reasoning: 0 };
  let model = "";
  let turns = 0;
  let toolCalls = 0;
  let retried = false;

  const finish = (outcome: IdeaAgentOutcome, modelIdeas: ModelIdea[] | null = null): IdeaAgentResult =>
    ({ modelIdeas, traces, usage: total, model, turns, outcome });

  const take = (usage: LlmUsage, used: string) => {
    total.tokensIn += usage.inputTokens;
    total.tokensOut += usage.outputTokens;
    total.cachedIn += usage.cachedInputTokens;
    total.reasoning += usage.reasoningTokens;
    model = used || model;
  };

  try {
    for (;;) {
      if (controller.signal.aborted) return finish("deadline");
      const last = retried || turns + 1 >= IDEA_LIMITS.maxTurns || toolCalls >= IDEA_LIMITS.maxToolCalls;
      let outcome: AgentTurnOutcome<{ ideas: ModelIdea[] }>;
      turns += 1;
      try {
        outcome = await deps.model.turn({
          instructions: IDEA_INSTRUCTIONS, input, items, tools, toolChoice: last ? "none" : "auto", schema: schema as never,
          schemaName: "dipbot_ideas", maxOutputTokens: IDEA_LIMITS.maxOutputTokens, signal: controller.signal,
        }) as AgentTurnOutcome<{ ideas: ModelIdea[] }>;
      } catch {
        return finish(controller.signal.aborted ? "deadline" : "unavailable");
      }
      take(outcome.usage, outcome.model);
      if (controller.signal.aborted) return finish("deadline");
      if (outcome.kind === "refusal") return finish("refusal");

      if (outcome.kind === "calls" && !last) {
        for (const opaque of outcome.opaque ?? []) items.push({ type: "opaque", item: opaque });
        for (const call of outcome.calls) {
          items.push({ type: "call", id: call.id, name: call.name, arguments: call.arguments });
          if (toolCalls >= IDEA_LIMITS.maxToolCalls) {
            items.push({ type: "result", id: call.id, output: JSON.stringify({ error: "tool limit reached" }) });
            continue;
          }
          toolCalls += 1;
          const result = runIdeaTool(snapshot, call.name, call.arguments);
          if (result.name !== null) traces.push({ name: result.name, ok: result.ok, output: result.output });
          items.push({ type: "result", id: call.id, output: JSON.stringify(result.output) });
        }
        continue;
      }

      if (outcome.kind === "final") {
        const ideas = parseModelIdeas(outcome.value, snapshot);
        if (ideas) return finish("ok", ideas);
      }
      // Malformed, truncated, a tool call on the forced turn, or an answer that holds no valid idea: one bounded retry.
      if (retried) return finish("malformed");
      retried = true;
      items.push({ type: "user", text: RETRY_TEXT });
    }
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onOuterAbort);
  }
}
