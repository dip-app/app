import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { z } from "zod";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { IDEA_INSTRUCTIONS, PREFETCHED_EXTRA_CALLS, PREFETCH_TOOLS, RETRY_TEXT, ideaInput, runIdeaAgent } from "../../functions/src/modules/ai/application/ideaAgent";
import { getDipbotIdeas, type IdeasDeps } from "../../functions/src/modules/ai/application/ideas";
import {
  LlmUnavailableError, type AgentModelPort, type AgentTurnOutcome, type AgentTurnRequest, type AiSettings, type LlmUsage,
} from "../../functions/src/modules/ai/application/ports";
import { CREDIT_COSTS } from "../../functions/src/modules/ai/domain/credits";
import { autoRefreshDue, ideasStatus, localDayKey, readIdeasCache } from "../../functions/src/modules/ai/domain/ideaCache";
import { ideaSnapshot, ideaToolDefinitions, runIdeaTool } from "../../functions/src/modules/ai/domain/ideaTools";
import { IDEA_LIMITS, type ModelIdea } from "../../functions/src/modules/ai/domain/ideaTypes";
import { ideasWorstCaseMicros } from "../../functions/src/modules/ai/domain/pricing";
import { DemoAgentModel } from "../../functions/src/modules/ai/infrastructure/demo";
import { ScriptedAgentModel, ScriptedDecisions, ZERO_USAGE } from "../../functions/src/modules/ai/infrastructure/fakes";
import { OpenAiAgentModel, toInputItems, type AgentResponseLike } from "../../functions/src/modules/ai/infrastructure/openAiAgent";
import { settingsFromEnv } from "../../functions/src/modules/ai/infrastructure/settings";
import type { CompanySignals, PastEvent } from "../../functions/src/modules/suggestions/domain/signals";
import type { SuggestionsStore } from "../../functions/src/modules/suggestions/application/ports";
import { NOW, caller, seedCompany, FakeAdminStore } from "./helpers/adminFakes";
import { SETTINGS, MemoryCatalog, MemoryInterests, MemoryThemes, JEV_USAGE } from "./helpers/aiFakes";
import { DEFAULT_TAGS } from "../../functions/src/modules/ai/infrastructure/firestoreSources";

const DAY = 86_400_000;
const USAGE: LlmUsage = { inputTokens: 1500, cachedInputTokens: 0, outputTokens: 600, reasoningTokens: 0 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CACHE = "companies/alpha/aiCache/ideas";
const CREDITS = "companies/alpha/aiCredits/203001";

function past(title: string, tagIds: string[], daysAgo: number, capacity: number, attendeeCount: number): PastEvent {
  const start = new Date(NOW.getTime() - daysAgo * DAY);
  return { title, tagIds, start, end: new Date(start.getTime() + 3_600_000), capacity, attendeeCount, status: "published", isOutdoor: false, costCents: 0 };
}

const PAST = [
  past("Trivia night", ["tag-games"], 10, 30, 12), past("Lunch walk", ["tag-fitness", "tag-outdoors"], 30, 20, 6),
  past("Craft evening", ["tag-arts"], 50, 12, 10), past("Pizza lunch", ["tag-food"], 20, 20, 18),
];

/** Only the reads gatherSignals and the callable use. */
class MemorySignals {
  pastReads = 0;
  async companyContext() { return { emailEnabled: false, timeZone: "America/New_York", aiSettings: null, schedule: null }; }
  async memberCount() { return 40; }
  async pastEvents() { this.pastReads += 1; return PAST; }
  async upcomingEvents() { return []; }
  async weeklyThemes() { return []; }
  async recentIdeaIds() { return []; }
  async tagCountsAboutFourWeeksAgo() { return null; }
}

function modelIdea(extra: Partial<ModelIdea> = {}): ModelIdea {
  return {
    title: "Pasta making workshop", description: "Roll and cut fresh pasta together, then share a long lunch table.", theme: "food",
    tagIds: ["tag-food", "tag-cooking"], goal: "team_bonding", weekday: 3, daypart: "weekday_lunch", durationMinutes: 90, costBucket: "under_15",
    groupSize: "team", isOutdoor: false, venueType: "activity_venue", venueSearchHint: "cooking school", why: "A cozy way to meet new teammates.",
    considerationIds: [], catalogIdeaId: null, ...extra,
  };
}

const IDEAS = [
  modelIdea(),
  modelIdea({ title: "Sunrise yoga session", theme: "wellness", tagIds: ["tag-wellness"], goal: "wellness", daypart: "weekday_morning", weekday: 2, venueType: "office", isOutdoor: false, description: "A gentle stretch to start the day together." }),
  modelIdea({ title: "Watercolor painting hour", theme: "arts", tagIds: ["tag-arts"], goal: "celebrate", daypart: "after_work", weekday: 4, description: "Paint a small landscape with a guide." }),
  modelIdea({ title: "Community park cleanup", theme: "volunteering", tagIds: ["tag-volunteering", "tag-outdoors"], goal: "give_back", daypart: "weekend_daytime", weekday: 6, isOutdoor: true, venueType: "community_site", description: "Tidy a local park and share coffee after." }),
];

const calls = (...names: Array<[string, string]>): AgentTurnOutcome<unknown> => ({
  kind: "calls", usage: USAGE, model: "gpt-4o-mini", calls: names.map(([name, args], i) => ({ id: `c${i}`, name, arguments: args })),
});
const final = (ideas: ModelIdea[] = IDEAS): AgentTurnOutcome<unknown> => ({ kind: "final", value: { ideas }, usage: USAGE, model: "gpt-4o-mini" });
const bad = (kind: "malformed" | "truncated" | "refusal"): AgentTurnOutcome<unknown> => ({ kind, usage: USAGE, model: "gpt-4o-mini" });

/** A model that calls one tool on the first turn of every run and answers on the next; counts runs. */
class LoopAgent implements AgentModelPort {
  runs = 0;
  turns = 0;
  constructor(private readonly ideas: ModelIdea[] = IDEAS, private readonly fail = false) {}
  async turn<T>(request: AgentTurnRequest<T>): Promise<AgentTurnOutcome<T>> {
    this.turns++;
    if (this.fail) throw new LlmUnavailableError(503);
    if (request.items.every(item => item.type !== "call" || item.id.startsWith("prefetch_"))) {
      this.runs++;
      return calls(["getTagUsage", "{}"], ["getPastEvents", "{\"limit\":3}"]) as AgentTurnOutcome<T>;
    }
    return final(this.ideas) as AgentTurnOutcome<T>;
  }
}

const snapshot = () => {
  const signals: CompanySignals = {
    now: NOW, timeZone: "America/New_York", memberCount: 40, pastEvents: PAST, upcomingEvents: [], interests: [{ tagId: "tag-music", memberCount: 12 }, { tagId: "tag-food", memberCount: 25 }],
    interestsMonthAgo: null, weeklyThemes: [], recentlySuggested: [], tagNames: Object.fromEntries(DEFAULT_TAGS.map(t => [t.id, t.name])),
  };
  return ideaSnapshot(signals, DEFAULT_TAGS);
};

describe("idea agent loop", () => {
  test("executes tool calls against the snapshot and ignores an invented companyId", async () => {
    const snap = snapshot();
    const model = new ScriptedAgentModel([calls(["getPastEvents", "{\"companyId\":\"beta\",\"limit\":3}"], ["getTagUsage", "{}"]), final()]);
    const run = await runIdeaAgent({ model, prefetch: false }, snap);
    assert.equal(run.outcome, "ok");
    assert.equal(run.turns, 2);
    assert.deepEqual(run.traces.map(t => t.name), ["getPastEvents", "getTagUsage"]);
    const expected = runIdeaTool(snap, "getPastEvents", { limit: 3 }).output;
    assert.deepEqual(run.traces[0]!.output, expected);
    const second = model.requests[1]!;
    assert.deepEqual(second.items.map(i => i.type), ["call", "call", "result", "result"].slice(0, 0).concat(["call", "result", "call", "result"]));
    assert.equal((second.items[1] as { output: string }).output, JSON.stringify(expected));
    assert.equal(run.usage.tokensIn, 3000);
    assert.equal(run.modelIdeas!.length, 4);
    assert.match(second.input, /Company context: fall|winter/);
    assert.equal(second.instructions, IDEA_INSTRUCTIONS);
  });

  test("more than 6 tool calls are capped: the extra calls are not executed and the next turn forces the answer", async () => {
    const eight = Array.from({ length: 8 }, () => ["getTagUsage", "{}"] as [string, string]);
    const model = new ScriptedAgentModel([calls(...eight), final()]);
    const run = await runIdeaAgent({ model, prefetch: false }, snapshot());
    assert.equal(run.traces.length, IDEA_LIMITS.maxToolCalls);
    const results = model.requests[1]!.items.filter(i => i.type === "result") as Array<{ output: string }>;
    assert.equal(results.length, 8);
    assert.deepEqual(JSON.parse(results[7]!.output), { error: "tool limit reached" });
    assert.notDeepEqual(JSON.parse(results[5]!.output), { error: "tool limit reached" });
    assert.equal(model.requests[1]!.toolChoice, "none");
    assert.equal(run.outcome, "ok");
  });

  test("the last turn forces the answer with toolChoice none", async () => {
    const model = new ScriptedAgentModel([calls(["getTagUsage", "{}"]), calls(["getAttendanceTrends", "{}"]), calls(["getIdeaCatalog", "{}"]), final()]);
    const run = await runIdeaAgent({ model, prefetch: false }, snapshot());
    assert.deepEqual(model.requests.map(r => r.toolChoice), ["auto", "auto", "auto", "none"]);
    assert.equal(run.turns, IDEA_LIMITS.maxTurns);
    assert.equal(run.outcome, "ok");
  });

  test("after the prefetch the model gets at most 2 more tool calls, then the answer is forced", async () => {
    const model = new ScriptedAgentModel([calls(["getAvailableCoverLabels", "{}"]), calls(["getAvailableCoverLabels", "{}"], ["getIdeaCatalog", "{}"]), final()]);
    const run = await runIdeaAgent({ model }, snapshot());
    assert.equal(run.outcome, "ok");
    assert.equal(run.traces.length, PREFETCH_TOOLS.length + PREFETCHED_EXTRA_CALLS);
    assert.deepEqual(model.requests.map(r => r.toolChoice), ["auto", "auto", "none"]);
    const results = model.requests[2]!.items.filter(i => i.type === "result") as Array<{ output: string }>;
    assert.deepEqual(JSON.parse(results.at(-1)!.output), { error: "tool limit reached" });
  });

  test("the deadline aborts the provider call", async () => {
    const hanging: AgentModelPort = {
      turn: (request) => new Promise((_, reject) => request.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const run = await runIdeaAgent({ model: hanging, deadlineMs: 20 }, snapshot());
    assert.equal(run.outcome, "deadline");
    assert.equal(run.modelIdeas, null);
  });

  test("malformed output gets one bounded retry that forces the answer", async () => {
    const model = new ScriptedAgentModel([bad("malformed"), final()]);
    const run = await runIdeaAgent({ model }, snapshot());
    assert.equal(run.outcome, "ok");
    assert.equal(run.turns, 2);
    assert.equal(model.requests[1]!.toolChoice, "none");
    assert.deepEqual(model.requests[1]!.items.at(-1), { type: "user", text: RETRY_TEXT });
  });

  test("malformed twice, an answer without a valid idea and provider outages end without ideas", async () => {
    const twice = await runIdeaAgent({ model: new ScriptedAgentModel([bad("malformed"), bad("truncated")]) }, snapshot());
    assert.equal(twice.outcome, "malformed");
    assert.equal(twice.modelIdeas, null);
    assert.equal(twice.turns, 2);
    const empty = await runIdeaAgent({ model: new ScriptedAgentModel([final([]), final([])]) }, snapshot());
    assert.equal(empty.outcome, "malformed");
    const down = await runIdeaAgent({ model: new ScriptedAgentModel([new LlmUnavailableError(503)]) }, snapshot());
    assert.equal(down.outcome, "unavailable");
    const refused = await runIdeaAgent({ model: new ScriptedAgentModel([bad("refusal")]) }, snapshot());
    assert.equal(refused.outcome, "refusal");
  });

  test("the demo agent answers with ideas the schema accepts", async () => {
    const run = await runIdeaAgent({ model: new DemoAgentModel() }, snapshot());
    assert.equal(run.outcome, "ok");
    assert.deepEqual(run.traces.map(t => t.name), [...PREFETCH_TOOLS], "with the data prefetched the demo answers on the first turn");
    assert.equal(run.modelIdeas!.length, 5);
  });

  test("the core tool results are in the conversation before the first turn, as calls the model can cite", async () => {
    const snap = snapshot();
    const model = new ScriptedAgentModel([final()]);
    const run = await runIdeaAgent({ model, maxOutputTokens: 9000 }, snap, { locale: "es" });
    assert.equal(run.outcome, "ok");
    assert.equal(run.turns, 1, "no tool round trip needed");
    const first = model.requests[0]!;
    assert.deepEqual(first.items.map(i => i.type), PREFETCH_TOOLS.flatMap(() => ["call", "result"]));
    const call = first.items[0] as { id: string; name: string; arguments: string };
    assert.equal(call.id, "prefetch_getTagUsage");
    assert.deepEqual(JSON.parse((first.items[2] as { arguments: string }).arguments), { sinceDays: null, theme: null, limit: null });
    assert.equal((first.items[3] as { output: string }).output, JSON.stringify(runIdeaTool(snap, "getPastEvents", {}).output));
    assert.deepEqual(run.traces.map(t => t.name), [...PREFETCH_TOOLS], "prefetched results ground the why lines");
    assert.equal(first.maxOutputTokens, 9000);
    assert.match(first.input, /Write in Latin American Spanish/);
    assert.match(first.input, /<recent_events_do_not_repeat>[\s\S]*<\/recent_events_do_not_repeat>/);
    assert.match(ideaInput(snap), /Write in US English/);
  });
});

describe("OpenAiAgentModel", () => {
  const args = (schema: z.ZodType<unknown>) => ({
    instructions: "i", input: "company", items: [], tools: ideaToolDefinitions(), toolChoice: "auto" as const, schema, schemaName: "answer", maxOutputTokens: 500,
  });
  const schema = z.object({ ok: z.boolean() });
  const response = (extra: Partial<AgentResponseLike>): AgentResponseLike => ({
    model: "gpt-4o-mini-2024-07-18", usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 0 } }, ...extra,
  });
  function stub(answer: AgentResponseLike | Error, model = "gpt-4o-mini") {
    const sent: Array<Record<string, unknown>> = [];
    const agent = new OpenAiAgentModel({
      model, effort: "low",
      client: { responses: { parse: async params => { sent.push(params); if (answer instanceof Error) throw answer; return answer; } } },
    });
    return { agent, sent };
  }

  test("sends strict function tools, structured output and no storage", async () => {
    const { agent, sent } = stub(response({ output_parsed: { ok: true }, output: [{ type: "message" }] }));
    const outcome = await agent.turn(args(schema));
    assert.deepEqual(outcome, { kind: "final", value: { ok: true }, usage: { inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, reasoningTokens: 0 }, model: "gpt-4o-mini-2024-07-18" });
    const params = sent[0]!;
    assert.equal(params.store, false);
    assert.equal(params.tool_choice, "auto");
    assert.equal(params.parallel_tool_calls, true);
    assert.equal(params.temperature, 0.4);
    assert.equal(params.reasoning, undefined);
    assert.equal(params.max_output_tokens, 500);
    const tools = params.tools as Array<{ type: string; name: string; strict: boolean; parameters: { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> } }>;
    assert.deepEqual(tools.map(t => t.name), ideaToolDefinitions().map(t => t.name));
    for (const tool of tools) {
      assert.equal(tool.type, "function");
      assert.equal(tool.strict, true);
      assert.equal(tool.parameters.additionalProperties, false);
      assert.deepEqual([...tool.parameters.required].sort(), Object.keys(tool.parameters.properties).sort());
    }
    assert.deepEqual(params.input, [{ role: "user", content: "company" }]);
  });

  test("function calls become calls, and results go back as function_call_output items", async () => {
    const { agent } = stub(response({ output: [{ type: "function_call", call_id: "call_1", name: "getTagUsage", arguments: "{}" }, { type: "function_call", call_id: "call_2", name: "getPastEvents", arguments: "{\"limit\":2}" }] }));
    const outcome = await agent.turn(args(schema));
    assert.equal(outcome.kind, "calls");
    if (outcome.kind !== "calls") return;
    assert.deepEqual(outcome.calls, [{ id: "call_1", name: "getTagUsage", arguments: "{}" }, { id: "call_2", name: "getPastEvents", arguments: "{\"limit\":2}" }]);
    const input = toInputItems("company", [
      { type: "call", id: "call_1", name: "getTagUsage", arguments: "{}" }, { type: "result", id: "call_1", output: "{\"a\":1}" },
      { type: "user", text: "again" }, { type: "opaque", item: { type: "reasoning", id: "rs_1" } },
    ]);
    assert.deepEqual(input, [
      { role: "user", content: "company" },
      { type: "function_call", call_id: "call_1", name: "getTagUsage", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "{\"a\":1}" },
      { role: "user", content: "again" },
      { type: "reasoning", id: "rs_1" },
    ]);
    const { agent: second, sent } = stub(response({ output_parsed: { ok: true } }));
    await second.turn({ ...args(schema), toolChoice: "none", items: [{ type: "call", id: "call_1", name: "getTagUsage", arguments: "{}" }, { type: "result", id: "call_1", output: "{}" }] });
    assert.equal(sent[0]!.tool_choice, "none");
    assert.deepEqual((sent[0]!.input as unknown[])[2], { type: "function_call_output", call_id: "call_1", output: "{}" });
  });

  test("refusal, truncated, malformed and transport errors", async () => {
    assert.equal((await stub(response({ output: [{ type: "message", content: [{ type: "refusal" }] }] })).agent.turn(args(schema))).kind, "refusal");
    assert.equal((await stub(response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).agent.turn(args(schema))).kind, "truncated");
    assert.equal((await stub(response({ output_parsed: null })).agent.turn(args(schema))).kind, "malformed");
    assert.equal((await stub(response({ output_parsed: { ok: "yes" } })).agent.turn(args(schema))).kind, "malformed");
    await assert.rejects(stub(new Error("secret prompt echo")).agent.turn(args(schema)), (e: unknown) => e instanceof LlmUnavailableError && !e.message.includes("secret"));
  });

  test("reasoning models get an effort and encrypted reasoning back, and no temperature", async () => {
    const { agent, sent } = stub(response({ output: [{ type: "reasoning", id: "rs_1" }, { type: "function_call", call_id: "c", name: "getTagUsage", arguments: "{}" }] }), "gpt-5-mini");
    const outcome = await agent.turn(args(schema));
    assert.equal(sent[0]!.temperature, undefined);
    assert.deepEqual(sent[0]!.reasoning, { effort: "low" });
    assert.deepEqual(sent[0]!.include, ["reasoning.encrypted_content"]);
    assert.equal(outcome.kind === "calls" && outcome.opaque?.length, 1);
  });
});

describe("daily ideas helpers", () => {
  test("local day key, freshness and the automatic rule", () => {
    assert.equal(localDayKey(new Date("2030-01-02T03:00:00Z"), "America/New_York"), "20300101");
    assert.equal(localDayKey(new Date("2030-01-02T03:00:00Z"), null), "20300102");
    const cache = { ideas: [], fingerprint: "x".repeat(8), provider: "openai" as const, model: "m", tools: [], creditsCharged: 3, rankedBy: "jev" as const, generatedAt: NOW, checkedAt: new Date(NOW.getTime() + 20 * 3_600_000) };
    const day = 24 * 3_600_000;
    assert.equal(ideasStatus(cache, new Date(NOW.getTime() + 30 * 3_600_000), day), "fresh", "checkedAt extends freshness");
    assert.equal(ideasStatus(cache, new Date(NOW.getTime() + 50 * 3_600_000), day), "stale");
    const input = { meta: { autoRunDay: null, manualRefreshes: null }, now: NOW, maxAgeMs: day, timeZone: "UTC" };
    assert.equal(autoRefreshDue({ ...input, cache: null }), true);
    assert.equal(autoRefreshDue({ ...input, cache: null, meta: { autoRunDay: "20300102", manualRefreshes: null } }), false);
    assert.equal(autoRefreshDue({ ...input, cache }), false);
    assert.equal(readIdeasCache({ ideas: [] }), null);
  });

  test("settings read the switches and the worst case is a few cents", () => {
    const on = settingsFromEnv({ AI_EVENTS_ENABLED: "true", AI_PROVIDER: "openai" }, { openai: "sk-real" });
    assert.deepEqual(on.ideas, { enabled: true, maxAgeHours: 24, manualPerDay: 3, model: "gpt-4o-mini" });
    const off = settingsFromEnv({ AI_EVENTS_ENABLED: "true", AI_PROVIDER: "openai", AI_IDEAS_ENABLED: "false", AI_IDEAS_MAX_AGE_HOURS: "12", AI_IDEAS_MANUAL_PER_DAY: "1", AI_MODEL_IDEAS: "gpt-4.1-mini" }, { openai: "sk-real" });
    assert.deepEqual(off.ideas, { enabled: false, maxAgeHours: 12, manualPerDay: 1, model: "gpt-4.1-mini" });
    assert.equal(settingsFromEnv({ AI_IDEAS_ENABLED: "true" }, { openai: undefined }).ideas?.enabled, false, "needs AI events");
    assert.equal(ideasWorstCaseMicros("gpt-4o-mini"), 16_500);
  });
});

interface Rig {
  store: FakeAdminStore; clock: { t: Date }; agent: AgentModelPort; ranker: ScriptedDecisions; deps: IdeasDeps; logs: Array<{ event: string; fields: Record<string, unknown> }>;
}

function rig(opts: { agent?: AgentModelPort | null; settings?: Partial<AiSettings>; companySettings?: Record<string, unknown> } = {}): Rig {
  const store = new FakeAdminStore();
  seedCompany(store);
  store.seed("companies/alpha/aiSettings/current", { enabled: true, ...opts.companySettings });
  const clock = { t: NOW };
  const agent = opts.agent === undefined ? new LoopAgent() : opts.agent;
  const ranker = new ScriptedDecisions([]);
  const logs: Rig["logs"] = [];
  const deps: IdeasDeps = {
    store, llm: { generate: async () => { throw new Error("no llm"); }, moderate: async () => [] }, decisions: ranker,
    interests: new MemoryInterests([{ tagId: "tag-music", memberCount: 12 }, { tagId: "tag-food", memberCount: 25 }]), catalog: new MemoryCatalog(), themes: new MemoryThemes(null),
    signals: new MemorySignals() as unknown as SuggestionsStore, agent, rankers: [{ port: ranker, model: "jev-latest" }],
    settings: { ...SETTINGS, ...opts.settings }, now: () => clock.t, log: (event, fields) => logs.push({ event, fields: fields as Record<string, unknown> }),
  };
  return { store, clock, agent: agent as AgentModelPort, ranker, deps, logs };
}

const req = (mode: "load" | "auto" | "refresh", n?: number) => ({ contractVersion: 1, companyId: "alpha", mode, ...(n ? { requestId: uuid(n) } : {}) });
const admin = caller("admin1");
const used = (r: Rig) => (r.store.get(CREDITS)?.used as number | undefined) ?? 0;
const fails = (promise: Promise<unknown>, reason: string) => assert.rejects(promise, (e: unknown) => e instanceof AdminError && e.reason === reason);

describe("getDipbotIdeasV1", () => {
  test("only admins; refresh needs a requestId", async () => {
    const r = rig();
    await fails(getDipbotIdeas(r.deps, caller("m1"), req("load")), "INSUFFICIENT_ROLE");
    await fails(getDipbotIdeas(r.deps, caller("org1"), req("load")), "INSUFFICIENT_ROLE");
    await fails(getDipbotIdeas(r.deps, caller("bo"), req("load")), "COMPANY_MISMATCH");
    await fails(getDipbotIdeas(r.deps, null, req("load")), "UNAUTHENTICATED");
    await fails(getDipbotIdeas(r.deps, admin, req("refresh")), "VALIDATION_FAILED");
    await fails(getDipbotIdeas(r.deps, admin, { ...req("load"), extra: 1 }), "VALIDATION_FAILED");
    assert.equal((r.agent as LoopAgent).turns, 0);
  });

  test("load never calls the model: first visit shows the free fallback and reports an automatic refresh due", async () => {
    const r = rig();
    const out = await getDipbotIdeas(r.deps, admin, req("load"));
    assert.equal(out.enabled, true);
    assert.equal(out.status, "fallback");
    assert.equal(out.autoRefreshDue, true);
    assert.ok(out.ideas.length >= 4);
    assert.ok(out.ideas.every(i => i.source === "catalog"));
    assert.equal(out.generatedAt, undefined);
    assert.equal(out.refreshesLeftToday, 3);
    assert.equal(out.creditsCharged, 0);
    assert.equal(out.outcome, undefined);
    assert.equal(out.credits.creditCost?.ideas, 3);
    assert.equal((r.agent as LoopAgent).turns, 0);
    assert.equal(r.store.get(CACHE), undefined);
  });

  test("auto runs once, charges 3 credits, stores the ideas and a second auto the same day is skipped", async () => {
    const r = rig();
    const agent = r.agent as LoopAgent;
    const out = await getDipbotIdeas(r.deps, admin, req("auto"));
    assert.equal(out.outcome, "updated");
    assert.equal(out.status, "computed");
    assert.equal(out.creditsCharged, CREDIT_COSTS.ideas);
    assert.equal(out.credits.creditsUsed, 3);
    assert.equal(out.autoRefreshDue, false);
    assert.ok(out.ideas.length >= 4 && out.ideas.length <= 6);
    assert.ok(out.ideas.some(i => i.source === "agent"));
    assert.equal(agent.runs, 1);
    assert.equal(used(r), 3);
    const stored = r.store.get(CACHE)!;
    assert.equal(stored.provider, "openai");
    assert.deepEqual(stored.tools, [...PREFETCH_TOOLS, "getTagUsage", "getPastEvents"]);
    assert.equal(stored.leaseHolder, "");
    assert.equal(typeof stored.autoRunDay, "string");
    // Spend is metered into the month and the platform, never as a generation.
    const month = r.store.get("companies/alpha/aiUsage/203001")!;
    assert.equal(month.generations, 0);
    assert.ok((month.spentMicros as number) > 0);
    assert.ok((r.store.get("aiUsagePlatform/203001")!.spentMicros as number) > 0);
    // Load now: fresh, not due, the same ideas, and no company event reads at all.
    const signals = r.deps.signals as unknown as MemorySignals;
    const reads = signals.pastReads;
    const loaded = await getDipbotIdeas(r.deps, admin, req("load"));
    assert.equal(signals.pastReads, reads);
    assert.equal(loaded.dataLevel, out.dataLevel);
    assert.equal(loaded.status, "fresh");
    assert.equal(loaded.autoRefreshDue, false);
    assert.deepEqual(loaded.ideas.map(i => i.id), out.ideas.map(i => i.id));
    assert.equal(loaded.generatedAt, NOW.toISOString());
    // A second auto the same day (even when stale) is skipped.
    r.clock.t = new Date(NOW.getTime() + 20 * 3_600_000);
    const again = await getDipbotIdeas(r.deps, admin, req("auto"));
    assert.equal(again.outcome, "skipped");
    assert.equal(agent.runs, 1);
    assert.equal(used(r), 3);
    // The audit entry is content free.
    const audits = [...r.store.docs].filter(([p]) => p.startsWith("companies/alpha/auditLog/"));
    assert.equal(audits.length, 1);
    assert.equal((audits[0]![1].data as { action: string }).action, "ai.ideasGenerated");
  });

  test("auto with unchanged inputs only extends the stored ideas: free, no model call", async () => {
    const r = rig();
    const agent = r.agent as LoopAgent;
    const first = await getDipbotIdeas(r.deps, admin, req("auto"));
    r.clock.t = new Date(NOW.getTime() + 25 * 3_600_000);
    const stale = await getDipbotIdeas(r.deps, admin, req("load"));
    assert.equal(stale.status, "stale");
    assert.equal(stale.autoRefreshDue, true);
    const extended = await getDipbotIdeas(r.deps, admin, req("auto"));
    assert.equal(extended.outcome, "extended");
    assert.equal(extended.status, "fresh");
    assert.equal(extended.creditsCharged, 0);
    assert.equal(extended.generatedAt, NOW.toISOString(), "generatedAt stays, checkedAt moves");
    assert.deepEqual(extended.ideas.map(i => i.id), first.ideas.map(i => i.id));
    assert.equal(agent.runs, 1);
    assert.equal(used(r), 3);
    assert.equal((await getDipbotIdeas(r.deps, admin, req("load"))).autoRefreshDue, false);
  });

  test("refresh costs 3 credits, is idempotent per requestId and limited per local day", async () => {
    const r = rig();
    const agent = r.agent as LoopAgent;
    const one = await getDipbotIdeas(r.deps, admin, req("refresh", 1));
    assert.equal(one.outcome, "updated");
    assert.equal(one.creditsCharged, 3);
    assert.equal(one.refreshesLeftToday, 2);
    assert.equal(used(r), 3);
    const replay = await getDipbotIdeas(r.deps, admin, req("refresh", 1));
    assert.equal(replay.outcome, "unchanged");
    assert.equal(replay.creditsCharged, 0);
    assert.equal(replay.refreshesLeftToday, 2);
    assert.deepEqual(replay.ideas.map(i => i.id), one.ideas.map(i => i.id));
    assert.equal(agent.runs, 1);
    assert.equal(used(r), 3);
    await getDipbotIdeas(r.deps, admin, req("refresh", 2));
    // A late replay of an earlier, already paid press never runs or charges again (its key is on the ledger).
    const late = await getDipbotIdeas(r.deps, admin, req("refresh", 1));
    assert.equal(late.outcome, "unchanged");
    assert.equal(late.creditsCharged, 0);
    assert.equal(agent.runs, 2);
    assert.equal(used(r), 6);
    const third = await getDipbotIdeas(r.deps, admin, req("refresh", 3));
    assert.equal(third.refreshesLeftToday, 0);
    assert.equal(used(r), 9);
    await fails(getDipbotIdeas(r.deps, admin, req("refresh", 4)), "AI_IDEAS_REFRESH_LIMIT");
    assert.equal(agent.runs, 3);
    assert.equal(used(r), 9);
    // The next local day has a fresh allowance.
    r.clock.t = new Date(NOW.getTime() + 24 * 3_600_000);
    assert.equal((await getDipbotIdeas(r.deps, admin, req("load"))).refreshesLeftToday, 3);
    assert.equal((await getDipbotIdeas(r.deps, admin, req("refresh", 4))).outcome, "updated");
  });

  test("exhausted credits: refresh is refused before any model call and load is not due", async () => {
    const r = rig();
    r.store.seed(CREDITS, { period: "203001", used: 499, charges: {} });
    await fails(getDipbotIdeas(r.deps, admin, req("refresh", 1)), "AI_CREDITS_EXHAUSTED");
    const loaded = await getDipbotIdeas(r.deps, admin, req("load"));
    assert.equal(loaded.autoRefreshDue, false);
    assert.equal(loaded.status, "fallback");
    const auto = await getDipbotIdeas(r.deps, admin, req("auto"));
    assert.equal(auto.outcome, "skipped");
    assert.equal((r.agent as LoopAgent).turns, 0);
    assert.equal(used(r), 499);
  });

  test("a model failure refunds the credits, keeps the stored ideas and still uses up the day's attempt", async () => {
    const r = rig({ agent: new LoopAgent(IDEAS, true) });
    const out = await getDipbotIdeas(r.deps, admin, req("refresh", 1));
    assert.equal(out.outcome, "failed");
    assert.equal(out.creditsCharged, 0);
    assert.equal(out.status, "fallback");
    assert.equal(out.credits.creditsUsed, 0);
    assert.equal(used(r), 0);
    assert.deepEqual(r.store.get(CREDITS)!.charges, {});
    assert.equal(r.store.get(CACHE)!.leaseHolder, "");
    assert.equal(r.store.get(CACHE)!.ideas, undefined, "nothing stored for a failed run");
    assert.equal(out.refreshesLeftToday, 2);
    const audits = [...r.store.docs].filter(([p]) => p.startsWith("companies/alpha/auditLog/"));
    assert.equal((audits[0]![1].data as { action: string }).action, "ai.ideasFailed");
    // An automatic failure uses up the day: no second automatic run.
    const auto = await getDipbotIdeas(rig({ agent: new LoopAgent(IDEAS, true) }).deps, admin, req("auto"));
    assert.equal(auto.outcome, "failed");
    assert.equal(auto.autoRefreshDue, false);
  });

  test("a failed refresh keeps previously stored ideas", async () => {
    const good = rig();
    const first = await getDipbotIdeas(good.deps, admin, req("auto"));
    const broken = new LoopAgent(IDEAS, true);
    good.deps.agent = broken;
    const out = await getDipbotIdeas(good.deps, admin, req("refresh", 7));
    assert.equal(out.outcome, "failed");
    assert.equal(out.status, "fresh");
    assert.deepEqual(out.ideas.map(i => i.id), first.ideas.map(i => i.id));
    assert.equal(used(good), 3);
  });

  test("an answer with no usable idea (malformed twice) is refunded", async () => {
    const r = rig({ agent: new ScriptedAgentModel([bad("malformed"), bad("malformed")]) });
    const out = await getDipbotIdeas(r.deps, admin, req("refresh", 1));
    assert.equal(out.outcome, "failed");
    assert.equal(used(r), 0);
    const month = r.store.get("companies/alpha/aiUsage/203001")!;
    assert.ok((month.spentMicros as number) > 0, "the spent tokens are still metered");
  });

  test("concurrent automatic calls share one model run through the lease", async () => {
    const r = rig();
    const agent = r.agent as LoopAgent;
    const results = await Promise.all([getDipbotIdeas(r.deps, admin, req("auto")), getDipbotIdeas(r.deps, caller("admin2"), req("auto"))]);
    assert.equal(agent.runs, 1);
    assert.equal(used(r), 3);
    assert.deepEqual(results.map(x => x.outcome).sort(), ["skipped", "updated"]);
  });

  test("kill switches return enabled false without errors and without a model call", async () => {
    const cases: Array<[string, Rig]> = [
      ["env", rig({ settings: { ideas: { enabled: false, maxAgeHours: 24, manualPerDay: 3, model: "gpt-4o-mini" } } })],
      ["company", rig({ companySettings: { ideasEnabled: false } })],
      ["ai off", rig({ companySettings: { enabled: false } })],
      ["ai off globally", rig({ settings: { enabled: false } })],
    ];
    for (const [name, r] of cases) {
      for (const mode of ["load", "auto"] as const) {
        const out = await getDipbotIdeas(r.deps, admin, req(mode));
        assert.deepEqual([out.enabled, out.ideas, out.autoRefreshDue, out.refreshesLeftToday, out.creditsCharged, out.status, out.dataLevel], [false, [], false, 0, 0, "fallback", "none"], name);
      }
      assert.equal((await getDipbotIdeas(r.deps, admin, req("refresh", 1))).enabled, false, name);
      assert.equal((r.agent as LoopAgent).turns, 0, name);
    }
  });

  test("no model configured, or no budget: the fallback shows, nothing is charged", async () => {
    const none = rig({ agent: null });
    assert.equal((await getDipbotIdeas(none.deps, admin, req("load"))).autoRefreshDue, false);
    assert.equal((await getDipbotIdeas(none.deps, admin, req("refresh", 1))).outcome, "skipped");
    assert.equal(used(none), 0);
    const broke = rig({ settings: { dailyBudgetMicros: 100 } });
    assert.equal((await getDipbotIdeas(broke.deps, admin, req("load"))).autoRefreshDue, false);
    assert.equal((await getDipbotIdeas(broke.deps, admin, req("auto"))).outcome, "skipped");
    assert.equal((broke.agent as LoopAgent).turns, 0);
  });

  test("ranking providers are tried in order and the prior is the last resort; logs and audit hold no idea text", async () => {
    const r = rig();
    r.deps = { ...r.deps, rankers: [
      { port: new ScriptedDecisions([new LlmUnavailableError(500)]), model: "jev-latest" },
      { port: new ScriptedDecisions([{ ...(await new ScriptedDecisions().decide({ step: "draftCheck", state: "", questions: {} })), usage: JEV_USAGE, model: "jev-latest", provider: "jev" }]), model: "jev-latest" },
    ] };
    const out = await getDipbotIdeas(r.deps, admin, req("auto"));
    assert.equal(out.outcome, "updated");
    assert.equal(r.store.get(CACHE)!.rankedBy, "jev");
    const everything = JSON.stringify([r.logs, [...r.store.docs].filter(([p]) => p.startsWith("companies/alpha/auditLog/")).map(([, e]) => e.data)]);
    for (const idea of out.ideas) {
      assert.ok(!everything.includes(idea.title), idea.title);
      assert.ok(!everything.includes(idea.description.slice(0, 20)));
    }
    for (const event of PAST) assert.ok(!everything.includes(event.title), event.title);
    const line = r.logs.find(l => l.event === "ai.ideas")!.fields;
    assert.equal(line.companyId, "alpha");
    assert.equal(line.creditsCharged, 3);
    assert.equal(line.tools, PREFETCH_TOOLS.length + 2);
    assert.equal(line.toolNames, [...PREFETCH_TOOLS, "getTagUsage", "getPastEvents"].join(","));
    assert.equal(typeof line.tokensIn, "number");
    const down = rig();
    down.deps = { ...down.deps, rankers: [{ port: new ScriptedDecisions([new LlmUnavailableError(500)]), model: "jev-latest" }] };
    await getDipbotIdeas(down.deps, admin, req("auto"));
    assert.equal(down.store.get(CACHE)!.rankedBy, "heuristic");
  });

  test("tenant isolation: the other company's admin cannot read or refresh, and its tool data is not used", async () => {
    const r = rig();
    await fails(getDipbotIdeas(r.deps, caller("bo"), { ...req("refresh", 1), companyId: "alpha" }), "COMPANY_MISMATCH");
    assert.equal(r.store.get(CACHE), undefined);
    assert.equal(used(r), 0);
    assert.ok(runIdeaTool(snapshot(), "getPastEvents", { companyId: "beta" }).ok);
  });
});

void ZERO_USAGE;
