import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { toHttpsError } from "../../functions/src/modules/admin/transport/adminCallables";
import {
  CREDIT_COSTS, DEFAULT_MONTHLY_CREDITS, allowanceOf, chargeCredits, creditPeriod, creditResetAt, creditsExhausted, creditsSummary, ledgerBase, ledgerFromDoc,
  refundCredits,
} from "../../functions/src/modules/ai/domain/credits";
import { getEventIdeaSuggestions, type SuggestionDeps } from "../../functions/src/modules/ai/application/suggestions";
import type { DecisionRequest, DecisionResult } from "../../functions/src/modules/ai/application/ports";
import { ScriptedDecisions, benignDecision } from "../../functions/src/modules/ai/infrastructure/fakes";
import { firestoreBudget } from "../../functions/src/modules/suggestions/application/budget";
import { NOW, caller, seedCompany, FakeAdminStore } from "./helpers/adminFakes";
import { JEV_USAGE, SETTINGS, MemoryCatalog, MemoryInterests, MemoryThemes } from "./helpers/aiFakes";

describe("credit price table", () => {
  test("fixed per-tool prices and the default allowance", () => {
    assert.deepEqual({ ...CREDIT_COSTS }, { suggestPanel: 1, generateDrafts: 10, regenerateDrafts: 10, weeklyEmail: 3, coverPick: 1, venueSearch: 1 });
    assert.equal(DEFAULT_MONTHLY_CREDITS, 500);
    assert.equal(DEFAULT_MONTHLY_CREDITS / CREDIT_COSTS.generateDrafts, 50);
  });

  test("allowance: default, or a whole-number company override (zero allowed); junk is ignored", () => {
    assert.equal(allowanceOf(null), 500);
    assert.equal(allowanceOf({ monthlyCredits: 120 }), 120);
    assert.equal(allowanceOf({ monthlyCredits: 0 }), 0);
    for (const bad of [-1, 1.5, "100", null, Number.NaN]) assert.equal(allowanceOf({ monthlyCredits: bad }), 500);
  });

  test("the client summary has credits and prices only: no money, tokens or models", () => {
    const summary = creditsSummary(ledgerFromDoc(ledgerBase(null, null, NOW), null));
    assert.deepEqual(Object.keys(summary).sort(), ["creditCost", "creditsAllowance", "creditsRemaining", "creditsUsed", "resetsAt"]);
    assert.ok(!/usd|dollar|cents|micros|token|model|\$/i.test(JSON.stringify(summary)));
  });
});

describe("credit periods", () => {
  test("UTC when no time zone, and an invalid zone falls back to UTC", () => {
    assert.equal(creditPeriod(new Date("2030-01-31T23:30:00Z"), null), "203001");
    assert.equal(creditResetAt(new Date("2030-01-31T23:30:00Z"), null).toISOString(), "2030-02-01T00:00:00.000Z");
    assert.equal(ledgerBase(null, { timeZone: "Not/AZone" }, NOW).resetsAt.toISOString(), "2030-02-01T00:00:00.000Z");
  });

  test("the month rolls over at local midnight of the company's zone, DST included", () => {
    const la = "America/Los_Angeles";
    // 2030-02-01T07:59Z is still January 31 in Los Angeles (UTC-8); 08:00Z is February 1.
    assert.equal(creditPeriod(new Date("2030-02-01T07:59:00Z"), la), "203001");
    assert.equal(creditPeriod(new Date("2030-02-01T08:00:00Z"), la), "203002");
    assert.equal(creditResetAt(new Date("2030-01-15T12:00:00Z"), la).toISOString(), "2030-02-01T08:00:00.000Z");
    // April 1 is after the US spring change (UTC-7).
    assert.equal(creditResetAt(new Date("2030-03-15T12:00:00Z"), la).toISOString(), "2030-04-01T07:00:00.000Z");
    // December rolls into the next year; Amsterdam is ahead of UTC.
    assert.equal(creditResetAt(new Date("2030-12-20T12:00:00Z"), "Europe/Amsterdam").toISOString(), "2030-12-31T23:00:00.000Z");
    assert.equal(creditPeriod(new Date("2030-12-31T23:30:00Z"), "Europe/Amsterdam"), "203101");
  });
});

describe("credit charges", () => {
  const fresh = () => ledgerFromDoc(ledgerBase({ monthlyCredits: 25 }, null, NOW), null);

  test("charge, duplicate and insufficient", () => {
    const ledger = fresh();
    assert.equal(chargeCredits(ledger, "a", 10), "charged");
    assert.equal(chargeCredits(ledger, "a", 10), "duplicate");
    assert.equal(ledger.used, 10);
    assert.equal(chargeCredits(ledger, "b", 10), "charged");
    assert.equal(chargeCredits(ledger, "c", 10), "insufficient");
    assert.equal(ledger.used, 20);
  });

  test("a refund is exactly once and only for a known key", () => {
    const ledger = fresh();
    chargeCredits(ledger, "a", 10);
    assert.equal(refundCredits(ledger, "a"), true);
    assert.equal(refundCredits(ledger, "a"), false);
    assert.equal(refundCredits(ledger, "never"), false);
    assert.equal(ledger.used, 0);
  });

  test("the exhausted error carries the balance and reset date and no money", () => {
    const ledger = fresh();
    chargeCredits(ledger, "a", 20);
    const error = creditsExhausted(ledger);
    assert.equal(error.reason, "AI_CREDITS_EXHAUSTED");
    assert.deepEqual(error.details, { creditsRemaining: 5, resetsAt: "2030-02-01T00:00:00.000Z" });
    const wire = toHttpsError(error);
    assert.equal(wire.code, "resource-exhausted");
    assert.deepEqual(wire.details, { reason: "AI_CREDITS_EXHAUSTED", creditsRemaining: 5, resetsAt: "2030-02-01T00:00:00.000Z" });
    assert.ok(!/\$|usd|dollar/i.test(JSON.stringify(wire.details) + wire.message));
  });

  test("a malformed stored ledger is an invariant failure", () => {
    const base = ledgerBase(null, null, NOW);
    for (const doc of [{ used: -1 }, { used: 1.5 }, { used: 1, charges: [] }, { used: 1, charges: { a: "x" } }]) {
      assert.throws(() => ledgerFromDoc(base, doc), (e: unknown) => e instanceof AdminError && e.reason === "INVALID_STORED_DATA");
    }
  });
});

const SESSION = "00000000-0000-4000-8000-0000000000bb";
const CREDITS = "companies/alpha/aiCredits/203001";

function suggestRig(settings: Record<string, unknown> = {}) {
  const store = new FakeAdminStore();
  seedCompany(store);
  store.seed("companies/alpha/aiSettings/current", { enabled: true, ...settings });
  const answer = (request: DecisionRequest): DecisionResult => {
    const base = benignDecision(request);
    for (const [id, q] of Object.entries(request.questions)) {
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria);
        base.answers[id] = { type: "choice", choice: keys[0]!, confidence: 0.9, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.9 : 0.1 / (keys.length - 1)])) };
      }
    }
    return { ...base, usage: JEV_USAGE, model: "jev-latest", provider: "jev" };
  };
  const jev = new ScriptedDecisions([answer, answer]);
  const deps: SuggestionDeps = {
    store, llm: { generate: async () => { throw new Error("no llm"); }, moderate: async () => [] }, decisions: jev,
    interests: new MemoryInterests([{ tagId: "tag-fitness", memberCount: 25 }]), catalog: new MemoryCatalog(),
    themes: new MemoryThemes({ title: "Fall Fitness Week", tagIds: ["tag-fitness"] }), pastEvents: { recent: async () => [] },
    providers: [{ port: jev, model: "jev-latest" }], settings: SETTINGS, now: () => NOW,
  };
  return { store, jev, deps };
}
const ask = (deps: SuggestionDeps, session = SESSION) => getEventIdeaSuggestions(deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", sessionId: session });

describe("Dipbot Suggest credits", () => {
  test("the first visit costs 1 credit; every later visit, from any admin and session, is free; a refresh costs 1", async () => {
    const r = suggestRig();
    const first = await ask(r.deps);
    assert.equal(first.provider, "jev");
    assert.equal(first.cacheStatus, "computed");
    assert.equal(first.creditsCharged, 1);
    assert.equal(first.credits.creditsUsed, 1);
    assert.equal(r.store.get(CREDITS)!.used, 1);
    const again = await ask(r.deps);
    assert.equal(again.cached, true);
    assert.equal(again.cacheStatus, "fresh");
    assert.equal(again.creditsCharged, 0);
    assert.equal(again.credits.creditsUsed, 1);
    // A new visit (another session) is free too: the saved answer belongs to the company.
    assert.equal((await ask(r.deps, "00000000-0000-4000-8000-0000000000bc")).credits.creditsUsed, 1);
    assert.equal(r.jev.calls.length, 1);
    const refreshed = await getEventIdeaSuggestions(r.deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", requestId: "00000000-0000-4000-8000-0000000000bd", refresh: true });
    assert.equal(refreshed.creditsCharged, 1);
    assert.equal(refreshed.credits.creditsUsed, 2);
  });

  test("out of credits: free heuristic answer, no model call, no charge, balance reported as zero", async () => {
    const r = suggestRig({ monthlyCredits: 0 });
    const response = await ask(r.deps);
    assert.notEqual(response.provider, "jev");
    assert.equal(r.jev.calls.length, 0);
    assert.equal(response.credits.creditsRemaining, 0);
    assert.equal(r.store.get(CREDITS), undefined);
  });
});

describe("weekly email credits", () => {
  test("charged once per company run when a model answered (re-run and a failed engine are free); refused when under 3 credits", async () => {
    const store = new FakeAdminStore();
    seedCompany(store);
    store.seed("companies/alpha/aiSettings/current", { enabled: true, monthlyCredits: 5 });
    const budget = firestoreBudget(store, SETTINGS);
    assert.equal(await budget.reserve("alpha", "suggest_2030-W01", 1000, NOW), true);
    await budget.settle("alpha", "suggest_2030-W01", 10, 100, 0, NOW, false);
    assert.equal(store.get(CREDITS)?.used ?? 0, 0);
    assert.equal(await budget.reserve("alpha", "suggest_2030-W01", 1000, NOW), true);
    await budget.settle("alpha", "suggest_2030-W01", 10, 100, 0, NOW, true);
    await budget.settle("alpha", "suggest_2030-W01", 0, 0, 0, NOW, true);
    assert.equal(store.get(CREDITS)!.used, CREDIT_COSTS.weeklyEmail);
    // The same week can run again free; a different week has only 2 credits left.
    assert.equal(await budget.reserve("alpha", "suggest_2030-W01", 1000, NOW), true);
    assert.equal(await budget.reserve("alpha", "suggest_2030-W02", 1000, NOW), false);
  });
});
