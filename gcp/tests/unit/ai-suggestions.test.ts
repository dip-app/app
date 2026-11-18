import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { LlmUnavailableError, type AiSettings, type DecisionRequest, type DecisionResult } from "../../functions/src/modules/ai/application/ports";
import {
  getEventIdeaSuggestions, suggestionWorstMicros, type PastEventSource, type SuggestionDeps, type SuggestionProvider,
} from "../../functions/src/modules/ai/application/suggestions";
import {
  aggregatePastEvents, fromAnswers, heuristicSuggestions, suggestionQuestions, suggestionState, timingOf, topOption, type PastEventInput, type SuggestionFacts,
} from "../../functions/src/modules/ai/domain/suggestions";
import { DEFAULT_TAGS } from "../../functions/src/modules/ai/infrastructure/firestoreSources";
import { ScriptedDecisions, benignDecision, type DecisionStepScript } from "../../functions/src/modules/ai/infrastructure/fakes";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { PAST_EVENTS_FLOOR, reasonWithBasis } from "../../functions/src/modules/ai/domain/suggestionReasons";
import { CONSIDERATION_IDS } from "../../functions/src/modules/ai/domain/considerations";
import { activeLease } from "../../functions/src/modules/ai/domain/suggestionCache";
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

const CACHE = "companies/alpha/aiCache/suggestions";
const CREDITS = "companies/alpha/aiCredits/203001";
const DAY = 24 * 60 * 60_000;
const REFRESH = (n: number, extra: Record<string, unknown> = {}) => req({ requestId: `00000000-0000-4000-8000-00000000010${n}`, refresh: true, ...extra });

interface Rig { clock: { t: Date }; interests: MemoryInterests; themes: MemoryThemes; store: FakeAdminStore; jev: ScriptedDecisions; openai: ScriptedDecisions; deps: SuggestionDeps; logs: Array<{ event: string; fields: Record<string, unknown> }> }

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
  const clock = { t: NOW };
  const interests = new MemoryInterests(data ? [{ tagId: "tag-fitness", memberCount: 25 }, { tagId: "tag-games", memberCount: 12 }, { tagId: "tag-arts", memberCount: 2 }] : null);
  const past = new MemoryPast(data ? [
    { startTime: new Date("2029-12-18T22:00:00Z"), costCents: 1000, capacity: 20, isOutdoor: false, tagIds: ["tag-games"] },
    { startTime: new Date("2029-12-11T22:00:00Z"), costCents: 800, capacity: 25, isOutdoor: true, tagIds: ["tag-fitness"] },
  ] : []);
  const themes = new MemoryThemes({ title: "Fall Fitness Week", tagIds: ["tag-fitness"] });
  const logs: Rig["logs"] = [];
  const deps: SuggestionDeps = {
    store, llm: { generate: async () => { throw new Error("no llm"); }, moderate: async () => [] }, decisions: jev, interests, catalog: new MemoryCatalog(),
    themes, pastEvents: past, providers, leasePollMs: 2, leaseWaitMs: 4000,
    settings: { ...SETTINGS, ...opts.settings }, now: () => clock.t, log: (event, fields) => logs.push({ event, fields: fields as Record<string, unknown> }),
  };
  return { clock, interests, themes, store, jev, openai, deps, logs };
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
    assert.deepEqual(out[0], { question: "interest", value: "tag-fitness", probability: 0.88, reason: "Lines up with this week's Fall Fitness Week", reasonBasis: "company_data" });
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
    // Two events are under the privacy floor, so the budget line stays generic and does not claim anything about them.
    assert.equal(pick("budget").reasonBasis, "generic");
    assert.ok(!/your|recent/i.test(pick("budget").reason));
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
      assert.equal(r.store.get(CACHE), undefined);
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

  test("first visit: Jev answers in one call, spend is metered, 1 credit, the answer is saved for the company", async () => {
    const r = rig();
    const first = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(first.provider, "jev");
    assert.equal(first.cacheStatus, "computed");
    assert.equal(first.cached, false);
    assert.equal(first.creditsCharged, 1);
    assert.equal(first.suggestions.length, 6);
    assert.equal(first.considerations!.length, CONSIDERATION_IDS.length, "every consideration is ranked, none is dropped");
    assert.equal(r.jev.calls.length, 1, "one decision call for every step and every consideration");
    assert.equal(r.openai.calls.length, 0);
    assert.doesNotMatch(r.jev.calls[0]!.state, /Ada|alpha\.test|Boat Ride/);
    assert.ok((r.store.get(MONTH)!.inputTokens as number) === JEV_USAGE.inputTokens);
    assert.equal(r.store.get(MONTH)!.generations, 0, "suggestions never count as generations");
    assert.equal(r.store.get(CREDITS)!.used, 1);
    const saved = r.store.get(CACHE)!;
    assert.equal(saved.provider, "jev");
    assert.match(String(saved.fingerprint), /^[0-9a-f]{32}$/);
    assert.equal(r.logs[0]!.fields.provider, "jev");
  });

  test("a visit with a valid saved answer costs 0 credits and makes no model call, for every admin and session", async () => {
    const r = rig();
    const first = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    r.clock.t = new Date(NOW.getTime() + 6 * DAY);
    for (const [uid, session] of [["admin1", SESSION], ["admin2", SESSION], ["admin2", "00000000-0000-4000-8000-0000000000ab"]] as const) {
      const again = await getEventIdeaSuggestions(r.deps, caller(uid), req({ sessionId: session }));
      assert.equal(again.cacheStatus, "fresh");
      assert.equal(again.cached, true);
      assert.equal(again.creditsCharged, 0);
      assert.deepEqual(again.suggestions, first.suggestions);
      assert.deepEqual(again.considerations, first.considerations);
      assert.equal(again.computedAt, first.computedAt);
    }
    assert.equal(r.jev.calls.length, 1);
    assert.equal(r.store.get(CREDITS)!.used, 1);
  });

  test("changed company data: the saved answer is shown as stale (reason data), nothing is recomputed or charged", async () => {
    const r = rig();
    await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    r.interests.stats = [{ tagId: "tag-fitness", memberCount: 25 }, { tagId: "tag-games", memberCount: 12 }, { tagId: "tag-arts", memberCount: 7 }];
    const next = await getEventIdeaSuggestions(r.deps, caller("admin2"), req());
    assert.deepEqual({ status: next.cacheStatus, reason: next.staleReason, charged: next.creditsCharged }, { status: "stale", reason: "data", charged: 0 });
    assert.equal(next.suggestions.length, 6, "the saved suggestions are still shown");
    assert.equal(r.jev.calls.length, 1, "stale does not auto-run");
    assert.equal(r.store.get(CREDITS)!.used, 1);
  });

  test("older than the max age: stale (reason age), still no auto-run", async () => {
    const r = rig();
    await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    r.clock.t = new Date(NOW.getTime() + 7 * DAY + 1000);
    const old = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.deepEqual({ status: old.cacheStatus, reason: old.staleReason, charged: old.creditsCharged }, { status: "stale", reason: "age", charged: 0 });
    assert.equal(r.jev.calls.length, 1);
  });

  test("a configured max age applies", async () => {
    const r = rig();
    r.deps.cacheMaxAgeMs = 2 * DAY;
    await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    r.clock.t = new Date(NOW.getTime() + 3 * DAY);
    assert.equal((await getEventIdeaSuggestions(r.deps, caller("admin1"), req())).cacheStatus, "stale");
  });

  test("refresh recomputes and charges 1; the same requestId again is free and returns the same answer", async () => {
    const r = rig();
    await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    r.clock.t = new Date(NOW.getTime() + 8 * DAY);
    const refreshed = await getEventIdeaSuggestions(r.deps, caller("admin1"), REFRESH(1));
    assert.deepEqual({ status: refreshed.cacheStatus, charged: refreshed.creditsCharged, used: refreshed.credits.creditsUsed }, { status: "computed", charged: 1, used: 2 });
    assert.equal(r.jev.calls.length, 2);
    const replay = await getEventIdeaSuggestions(r.deps, caller("admin1"), REFRESH(1));
    assert.deepEqual({ charged: replay.creditsCharged, at: replay.computedAt }, { charged: 0, at: refreshed.computedAt });
    assert.equal(r.jev.calls.length, 2);
    assert.equal(r.store.get(CREDITS)!.used, 2);
  });

  test("refresh without a requestId is invalid", async () => {
    const r = rig();
    await assert.rejects(getEventIdeaSuggestions(r.deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", refresh: true }), (e: unknown) => e instanceof AdminError && e.code === "invalid-argument");
  });

  test("two admins refreshing at once share one run and one credit", async () => {
    const r = rig();
    await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow = new ScriptedDecisions([async (request: DecisionRequest) => { await gate; return jevAnswer(request); }]);
    r.deps.providers = [{ port: slow, model: "jev-latest" }];
    r.clock.t = new Date(NOW.getTime() + 8 * DAY);
    const a = getEventIdeaSuggestions(r.deps, caller("admin1"), REFRESH(1));
    const b = getEventIdeaSuggestions(r.deps, caller("admin2"), REFRESH(2));
    await new Promise(resolve => setTimeout(resolve, 30));
    release();
    const [one, two] = await Promise.all([a, b]);
    assert.equal(slow.calls.length, 1, "only one model call");
    assert.equal(one.creditsCharged + two.creditsCharged, 1, "charged once");
    assert.equal(one.computedAt, two.computedAt);
    assert.deepEqual(one.suggestions, two.suggestions);
    assert.equal(r.store.get(CREDITS)!.used, 2, "the first visit plus one shared refresh");
  });

  test("two admins on the very first visit also share one run", async () => {
    const r = rig();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow = new ScriptedDecisions([async (request: DecisionRequest) => { await gate; return jevAnswer(request); }]);
    r.deps.providers = [{ port: slow, model: "jev-latest" }];
    const a = getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    const b = getEventIdeaSuggestions(r.deps, caller("admin2"), req());
    await new Promise(resolve => setTimeout(resolve, 30));
    release();
    const [one, two] = await Promise.all([a, b]);
    assert.equal(slow.calls.length, 1);
    assert.equal(one.creditsCharged + two.creditsCharged, 1);
    assert.equal(r.store.get(CREDITS)!.used, 1);
  });

  test("a crashed run does not block: an expired lease is taken over", async () => {
    const r = rig();
    r.store.seed(CACHE, { leaseHolder: "ghost", leaseUntil: new Date(NOW.getTime() - 1000) });
    const out = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(out.cacheStatus, "computed");
  });

  test("a failed refresh keeps the saved answer, charges nothing and releases the lease", async () => {
    const r = rig();
    const first = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    r.deps.providers = [{ port: new ScriptedDecisions([new Error("down")]), model: "jev-latest" }];
    r.clock.t = new Date(NOW.getTime() + 1000);
    const out = await getEventIdeaSuggestions(r.deps, caller("admin1"), REFRESH(3));
    assert.equal(out.creditsCharged, 0);
    assert.equal(out.computedAt, first.computedAt, "the saved answer is unchanged");
    assert.equal(r.store.get(CREDITS)!.used, 1);
    assert.equal(activeLease(r.store.get(CACHE), r.clock.t), null);
  });

  test("out of credits: never auto-runs; first visit gets the free heuristic (nothing saved), a stale cache is shown, refresh is refused", async () => {
    const r = rig();
    r.store.seed("companies/alpha/aiSettings/current", { enabled: true, monthlyCredits: 0 });
    const free = await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.equal(free.provider, "heuristic");
    assert.equal(free.creditsCharged, 0);
    assert.equal(r.jev.calls.length + r.openai.calls.length, 0);
    assert.equal(r.store.get(CACHE), undefined);
    assert.equal(free.considerations!.length, CONSIDERATION_IDS.length);
    await fails(getEventIdeaSuggestions(r.deps, caller("admin1"), REFRESH(4)), "AI_CREDITS_EXHAUSTED");
    r.store.seed(CACHE, { provider: "jev", suggestions: [], considerations: [], fingerprint: "00000000", computedAt: new Date(NOW.getTime() - DAY) });
    const stale = await getEventIdeaSuggestions(r.deps, caller("admin2"), req());
    assert.equal(stale.cacheStatus, "stale");
    assert.equal(r.jev.calls.length, 0);
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

  test("platform ceiling: spend counts toward it, and a full ceiling falls back to the heuristic", async () => {
    const r = rig();
    await getEventIdeaSuggestions(r.deps, caller("admin1"), req());
    assert.ok((r.store.get("aiUsagePlatform/203001")!.spentMicros as number) > 0, "suggestion spend reaches the platform total");
    const full = rig({ settings: { platformMonthlyBudgetMicros: 0 } });
    const out = await getEventIdeaSuggestions(full.deps, caller("admin1"), req());
    assert.equal(out.provider, "heuristic");
    assert.equal(full.jev.calls.length + full.openai.calls.length, 0);
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


describe("suggestion reasons: basis, rotation, privacy floor", () => {
  const event = (day: number, costCents: number, capacity: number, isOutdoor: boolean): PastEventInput => ({
    startTime: new Date(`2029-12-${String(day).padStart(2, "0")}T22:00:00Z`), costCents, capacity, isOutdoor, tagIds: [],
  });
  const history = (n: number, over: Partial<PastEventInput> = {}) =>
    aggregatePastEvents(Array.from({ length: n }, (_, i) => ({ ...event(10 + i, 1000, 20, false), ...over })), new Set());
  const QUESTIONS = ["interest", "goal", "groupSize", "setting", "budget", "timing"] as const;
  const values = { interest: "tag-fitness", goal: "wellness", groupSize: "team", setting: "outdoors", budget: "under_15", timing: "after_work" } as const;
  const PERSONAL = /\b(your|you|team|members|recent|lately)\b/i;

  test("no data at all: every reason is generic and none sounds personalized", () => {
    const facts: SuggestionFacts = { interests: [], theme: null, past: null, catalog: DEFAULT_TAGS };
    for (const q of QUESTIONS) {
      const r = reasonWithBasis(q, values[q], facts);
      assert.equal(r.basis, "generic", q);
      assert.ok(!PERSONAL.test(r.reason), `${q}: ${r.reason}`);
    }
  });

  test("interest counts drive interest, goal and a theme line; an unknown interest stays generic", () => {
    assert.deepEqual(reasonWithBasis("interest", "tag-fitness", FACTS), { reason: "Lines up with this week's Fall Fitness Week", basis: "company_data" });
    const noTheme = { ...FACTS, theme: null };
    const r = reasonWithBasis("interest", "tag-games", noTheme);
    assert.equal(r.basis, "company_data");
    assert.equal(reasonWithBasis("goal", "competition", noTheme).basis, "company_data");
    const unknown = reasonWithBasis("interest", "tag-music", noTheme);
    assert.equal(unknown.basis, "generic");
    assert.ok(!PERSONAL.test(unknown.reason));
  });

  test("past events count only from the privacy floor on", () => {
    const base = { ...FACTS, interests: [], theme: null };
    const few = { ...base, past: history(PAST_EVENTS_FLOOR - 1) };
    assert.equal(reasonWithBasis("budget", "under_15", few).basis, "generic");
    const enough = { ...base, past: history(PAST_EVENTS_FLOOR) };
    const budget = reasonWithBasis("budget", "under_15", enough);
    assert.equal(budget.basis, "company_data");
    assert.match(budget.reason, /recent events/);
    // A range never used reads as variety, not as a habit.
    const variety = reasonWithBasis("budget", "over_50", enough);
    assert.equal(variety.basis, "company_data");
    assert.match(variety.reason, /variety|not used much/);
  });

  test("lines carry no numbers, names or titles, and stay short", () => {
    const facts: SuggestionFacts = { ...FACTS, past: history(8, { isOutdoor: true }) };
    for (const q of QUESTIONS) {
      for (const value of [values[q], "other"]) {
        const r = reasonWithBasis(q, value, facts);
        assert.ok(r.reason.length <= 60 || /week's/.test(r.reason), r.reason);
        assert.ok(!/\d/.test(r.reason), r.reason);
      }
    }
  });

  test("wording rotates deterministically by option, so neighbors differ", () => {
    const facts: SuggestionFacts = { ...FACTS, theme: null, past: history(8) };
    const again = reasonWithBasis("timing", "after_work", facts);
    assert.deepEqual(reasonWithBasis("timing", "after_work", facts), again);
    const lines = new Set(["tag-fitness", "tag-games", "tag-arts", "tag-food", "tag-music", "tag-cooking"].map(id => reasonWithBasis("interest", id, { ...facts, interests: [{ tagId: id, bucket: "10-19" }] }).reason));
    assert.ok(lines.size >= 2, "several phrasings in use");
  });
});
