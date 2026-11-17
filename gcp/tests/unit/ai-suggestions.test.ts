import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { LlmUnavailableError, type AiSettings, type DecisionRequest, type DecisionResult } from "../../functions/src/modules/ai/application/ports";
import {
  getEventIdeaSuggestions, suggestionPath, suggestionWorstMicros, type PastEventSource, type SuggestionDeps, type SuggestionProvider,
} from "../../functions/src/modules/ai/application/suggestions";
import {
  aggregatePastEvents, fromAnswers, heuristicSuggestions, suggestionQuestions, suggestionState, timingOf, topOption, type PastEventInput, type SuggestionFacts,
} from "../../functions/src/modules/ai/domain/suggestions";
import { DEFAULT_TAGS } from "../../functions/src/modules/ai/infrastructure/firestoreSources";
import { ScriptedDecisions, benignDecision, type DecisionStepScript } from "../../functions/src/modules/ai/infrastructure/fakes";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { NOW, caller, seedCompany, FakeAdminStore } from "./helpers/adminFakes";
import { JEV_USAGE, SETTINGS, USAGE, MemoryCatalog, MemoryInterests, MemoryThemes } from "./helpers/aiFakes";

const SESSION = "00000000-0000-4000-8000-0000000000aa";
const req = (extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", sessionId: SESSION, ...extra });
const MONTH = "companies/alpha/aiUsage/203001";

class MemoryPast implements PastEventSource {
  constructor(public events: PastEventInput[] = []) {}
  async recent() { return this.events; }
}

/** A Jev-shaped answer: the first option of every Choice at `p`, budget level 1 at `p`. */
function jevAnswer(request: DecisionRequest, p = 0.9, provider: DecisionResult["provider"] = "jev"): DecisionResult {
  const base = benignDecision(request);
  for (const [id, q] of Object.entries(request.questions)) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      base.answers[id] = { type: "choice", choice: keys[0]!, confidence: p, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? p : (1 - p) / (keys.length - 1)])) };
    } else if (q.type === "score") {
      base.answers[id] = { type: "score", score: 1, confidence: p, probabilities: Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 1 ? p : (1 - p) / (q.criteria.length - 1)])) };
    }
  }
  return { ...base, usage: provider === "jev" ? JEV_USAGE : USAGE, model: provider === "jev" ? "jev-latest" : "gpt-6-luna", provider };
}

interface Rig { store: FakeAdminStore; jev: ScriptedDecisions; openai: ScriptedDecisions; deps: SuggestionDeps; logs: Array<{ event: string; fields: Record<string, unknown> }> }

function rig(opts: { jev?: DecisionStepScript[]; openai?: DecisionStepScript[]; withJev?: boolean; settings?: Partial<AiSettings>; data?: boolean } = {}): Rig {
  const store = new FakeAdminStore();
  seedCompany(store);
  store.seed("companies/alpha/aiSettings/current", { enabled: true });
  const jev = new ScriptedDecisions(opts.jev ?? [(r: DecisionRequest) => jevAnswer(r)]);
  const openai = new ScriptedDecisions(opts.openai ?? [(r: DecisionRequest) => jevAnswer(r, 0.8, "openai")]);
  const providers: SuggestionProvider[] = [];
  if (opts.withJev !== false) providers.push({ port: jev, model: "jev-latest" });
  providers.push({ port: openai, model: "gpt-6-luna" });
  const data = opts.data !== false;
  const interests = new MemoryInterests(data ? [{ tagId: "tag-fitness", memberCount: 25 }, { tagId: "tag-games", memberCount: 12 }, { tagId: "tag-arts", memberCount: 2 }] : null);
  const past = new MemoryPast(data ? [
    { startTime: new Date("2029-12-18T22:00:00Z"), costCents: 1000, capacity: 20, isOutdoor: false, tagIds: ["tag-games"] },
    { startTime: new Date("2029-12-11T22:00:00Z"), costCents: 800, capacity: 25, isOutdoor: true, tagIds: ["tag-fitness"] },
  ] : []);
  const logs: Rig["logs"] = [];
  const deps: SuggestionDeps = {
    store, llm: { generate: async () => { throw new Error("no llm"); }, moderate: async () => [] }, decisions: jev, interests, catalog: new MemoryCatalog(),
    themes: new MemoryThemes({ title: "Fall Fitness Week", tagIds: ["tag-fitness"] }), pastEvents: past, providers,
    settings: { ...SETTINGS, ...opts.settings }, now: () => NOW, log: (event, fields) => logs.push({ event, fields: fields as Record<string, unknown> }),
  };
  return { store, jev, openai, deps, logs };
}

async function fails(promise: Promise<unknown>, reason: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof AdminError && e.reason === reason);
}

const FACTS: SuggestionFacts = {
  interests: [{ tagId: "tag-fitness", bucket: "20+" }, { tagId: "tag-games", bucket: "10-19" }],
  theme: { title: "Fall Fitness Week", tagIds: ["tag-fitness"] },
  past: null,
  catalog: DEFAULT_TAGS,
};

describe("suggestion domain", () => {
  test("topOption takes the highest probability, earlier option on a tie, and maps Score levels to options", () => {
    assert.deepEqual(topOption({ type: "choice", choice: "b", confidence: 0.5, probabilities: { a: 0.4, b: 0.4, c: 0.2 } }, ["a", "b", "c"]), { value: "a", probability: 0.4 });
    assert.deepEqual(topOption({ type: "score", score: 1.4, confidence: 0.6, probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 } }, ["free", "under_15", "from_15_to_50"]), { value: "from_15_to_50", probability: 0.6 });
    assert.equal(topOption(undefined, ["a"]), null);
    assert.equal(topOption({ type: "noul", noul: 0.9 }, ["a"]), null);
    assert.equal(topOption({ type: "choice", choice: "zzz", confidence: 2, probabilities: { a: 7 } }, ["a"]), null, "out-of-range values are no suggestion");
  });

  test("questions share one state that carries buckets, names and counts but no ids, titles or people", () => {
    const facts = { ...FACTS, past: aggregatePastEvents([{ startTime: new Date("2029-12-18T22:00:00Z"), costCents: 0, capacity: 8, isOutdoor: true, tagIds: ["tag-games", "nope"] }], new Set(DEFAULT_TAGS.map(t => t.id))) };
    const state = suggestionState(facts);
    assert.match(state, /20 or more members/);
    assert.match(state, /Fall Fitness Week/);
    assert.doesNotMatch(state, /tag-/);
    const questions = suggestionQuestions(facts);
    assert.deepEqual(Object.keys(questions), ["interest", "goal", "groupSize", "setting", "budget", "timing"]);
    assert.equal(questions.budget!.type, "score");
    assert.deepEqual(Object.keys(suggestionQuestions({ ...facts, interests: [FACTS.interests[0]!] })).includes("interest"), false, "one candidate is not a choice");
  });

  test("fromAnswers builds one suggestion per answered question with a code-written reason", () => {
    const answers = jevAnswer({ step: "triage", state: "", questions: suggestionQuestions(FACTS) }, 0.88).answers;
    const out = fromAnswers(answers, FACTS);
    assert.equal(out.length, 6);
    assert.deepEqual(out[0], { question: "interest", value: "tag-fitness", probability: 0.88, reason: "20+ members like Fitness, and it fits this week's theme" });
    assert.equal(out.find(s => s.question === "budget")!.value, "under_15");
  });

  test("heuristic answers from buckets and past counts, and nothing without data", () => {
    assert.deepEqual(heuristicSuggestions({ ...FACTS, interests: [], past: null }), []);
    const out = heuristicSuggestions({ ...FACTS, past: aggregatePastEvents([
      { startTime: new Date("2029-12-18T22:00:00Z"), costCents: 1000, capacity: 20, isOutdoor: false, tagIds: [] },
      { startTime: new Date("2029-12-11T22:00:00Z"), costCents: 1200, capacity: 22, isOutdoor: false, tagIds: [] },
    ], new Set()) });
    const pick = (q: string) => out.find(s => s.question === q)!;
    assert.equal(pick("interest").value, "tag-fitness");
    assert.equal(pick("budget").value, "under_15");
    assert.equal(pick("budget").reason, "2 of your last 2 events were under $15 per person");
    assert.equal(pick("timing").value, "after_work");
    assert.ok(out.every(s => s.probability > 0 && s.probability <= 1));
  });

  test("timing buckets use Eastern time", () => {
    assert.equal(timingOf(new Date("2029-12-18T17:00:00Z")), "weekday_lunch"); // Tue 12:00 ET
    assert.equal(timingOf(new Date("2029-12-18T22:00:00Z")), "after_work"); // Tue 17:00 ET
    assert.equal(timingOf(new Date("2029-12-22T17:00:00Z")), "weekend"); // Sat
    assert.equal(timingOf(new Date("2029-12-18T14:00:00Z")), null); // Tue 09:00 ET
  });
});

describe("getEventIdeaSuggestionsV1", () => {
  for (const [name, uid, reason] of [["a member", "m1", "INSUFFICIENT_ROLE"], ["an organizer", "org1", "INSUFFICIENT_ROLE"], ["an admin of another company", "bo", "COMPANY_MISMATCH"]] as const) {
    test(`${name} is denied before any decision call or write`, async () => {
      const r = rig();
      await fails(getEventIdeaSuggestions(r.deps, caller(uid), req()), reason);
      assert.equal(r.jev.calls.length + r.openai.calls.length, 0);
      assert.deepEqual(r.store.children("companies/alpha/aiSuggestions"), []);
    });
  }

  test("no caller and a bad request are refused", async () => {
    const r = rig();
    await fails(getEventIdeaSuggestions(r.deps, null, req()), "UNAUTHENTICATED");
    await assert.rejects(getEventIdeaSuggestions(r.deps, caller("admin1"), req({ sessionId: "nope" })), (e: unknown) => e instanceof AdminError && e.code === "invalid-argument");
    await assert.rejects(getEventIdeaSuggestions(r.deps, caller("admin1"), req({ extra: 1 })), (e: unknown) => e instanceof AdminError && e.code === "invalid-argument");
  });

  test("AI turned off for the company: AI_DISABLED, no calls", async () => {
    const r = rig();
    r.store.seed("companies/alpha/aiSettings/current", { enabled: false });
    await fails(getEventIdeaSuggestions(r.deps, caller("admin1"), req()), "AI_DISABLED");
    assert.equal(r.jev.calls.length, 0);
  });

  test("Jev answers first in one call; spend is metered; the session is cached for the same admin only", async () => {
    const r = rig();
    const first = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(first.provider, "jev");
    assert.equal(first.cached, false);
    assert.equal(first.suggestions.length, 6);
    assert.equal(r.jev.calls.length, 1, "one decision call for every step");
    assert.equal(r.openai.calls.length, 0);
    assert.doesNotMatch(r.jev.calls[0]!.state, /Ada|alpha\.test|Boat Ride/);
    assert.ok((r.store.get(MONTH)!.inputTokens as number) === JEV_USAGE.inputTokens);
    assert.equal(r.store.get(MONTH)!.generations, 0, "suggestions never count as generations");
    const again = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(again.cached, true);
    assert.deepEqual(again.suggestions, first.suggestions);
    assert.equal(r.jev.calls.length, 1);
    // Another admin with the same session id gets their own answer, never the first admin's cache.
    await getEventIdeaSuggestions(r.deps, caller("admin2"), req());
    assert.equal(r.jev.calls.length, 2);
    assert.ok(r.store.get(suggestionPath("alpha", "admin2", SESSION)));
    assert.equal(r.logs[0]!.fields.provider, "jev");
  });

  test("Jev unavailable: the OpenAI mini fallback answers", async () => {
    const r = rig({ jev: [new LlmUnavailableError(503)] });
    const out = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(out.provider, "openai");
    assert.equal(r.openai.calls.length, 1);
  });

  test("no Jev key: OpenAI is the first provider", async () => {
    const r = rig({ withJev: false });
    assert.equal((await getEventIdeaSuggestions(r.deps, caller("admin1"), req())).provider, "openai");
    assert.equal(r.jev.calls.length, 0);
  });

  test("every provider fails: the heuristic answers and nothing is billed", async () => {
    const r = rig({ jev: [new Error("down")], openai: [new LlmUnavailableError(null)] });
    const out = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(out.provider, "heuristic");
    assert.ok(out.suggestions.length > 0);
    assert.equal(r.store.get(MONTH), undefined);
  });

  test("budget too low for the worst case: heuristic, no provider call", async () => {
    const r = rig({ settings: { dailyBudgetMicros: suggestionWorstMicros(r0Providers()) - 1 } });
    const out = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(out.provider, "heuristic");
    assert.equal(r.jev.calls.length + r.openai.calls.length, 0);
  });

  test("no interest data and no past events: a clean no-suggestion answer", async () => {
    const r = rig({ data: false });
    const out = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.deepEqual({ provider: out.provider, suggestions: out.suggestions }, { provider: "none", suggestions: [] });
    assert.equal(r.jev.calls.length, 0);
  });
});

function r0Providers(): SuggestionProvider[] {
  const noop = new ScriptedDecisions();
  return [{ port: noop, model: "jev-latest" }, { port: noop, model: "gpt-6-luna" }];
}
