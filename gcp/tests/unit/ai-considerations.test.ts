import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  CONSIDERATIONS, CONSIDERATION_GROUPS, CONSIDERATION_IDS, LEGACY_NOTE_CHIPS, considerationRelevance, isConsiderationId, rankConsiderationsByRules, reorderConsiderations,
} from "../../functions/src/modules/ai/domain/considerations";
import { considerationQuestions, considerationsFromAnswers, rankConsiderationsForFacts } from "../../functions/src/modules/ai/domain/considerationRanking";
import { countBucket, readCache, suggestionFingerprint } from "../../functions/src/modules/ai/domain/suggestionCache";
import { parseGenerateRequest } from "../../functions/src/modules/ai/domain/request";
import { buildGenerateUserContent } from "../../functions/src/modules/ai/domain/prompt";
import { aggregatePastEvents, type SuggestionFacts } from "../../functions/src/modules/ai/domain/suggestions";
import { DEFAULT_TAGS } from "../../functions/src/modules/ai/infrastructure/firestoreSources";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";

const FACTS: SuggestionFacts = {
  interests: [{ tagId: "tag-fitness", bucket: "20+" }, { tagId: "tag-games", bucket: "10-19" }],
  theme: { title: "Fall Fitness Week", tagIds: ["tag-fitness"] },
  past: null,
  catalog: DEFAULT_TAGS,
};
const past = (n: number, costCents = 1000) => aggregatePastEvents(
  Array.from({ length: n }, () => ({ startTime: new Date("2029-12-18T22:00:00Z"), costCents, capacity: 20, isOutdoor: false, tagIds: ["tag-games"] })),
  new Set(DEFAULT_TAGS.map(t => t.id)),
);

describe("consideration catalog", () => {
  test("a pool of 40 to 60 unique, well-formed entries across the six groups", () => {
    assert.ok(CONSIDERATIONS.length >= 40 && CONSIDERATIONS.length <= 60, `size ${CONSIDERATIONS.length}`);
    assert.equal(new Set(CONSIDERATION_IDS).size, CONSIDERATIONS.length);
    const groups = new Set(CONSIDERATION_GROUPS.map(g => g.id));
    for (const entry of CONSIDERATIONS) {
      assert.match(entry.id, /^[a-z][a-z0-9_]{2,40}$/);
      assert.ok(groups.has(entry.group), entry.id);
      assert.ok(entry.label.length > 3 && entry.label.length <= 48, `${entry.id} label`);
      assert.ok(entry.hint.length > 5 && entry.hint.length <= 80, `${entry.id} hint`);
      assert.doesNotMatch(`${entry.label} ${entry.hint}`, /[–—]/, `${entry.id} has a dash that reads as an em dash`);
    }
    for (const group of groups) assert.ok(CONSIDERATIONS.some(e => e.group === group), `group ${group} is empty`);
  });

  test("accessibility and dietary needs are in the catalog (always reachable, never only ranked)", () => {
    for (const id of ["wheelchair_accessible", "step_free", "sensory_friendly", "hearing_friendly", "vegetarian", "vegan", "gluten_free", "nut_free", "halal", "kosher", "alcohol_free"]) {
      assert.ok(isConsiderationId(id), id);
    }
    assert.ok(CONSIDERATIONS.filter(e => e.group === "accessibility").length >= 6);
    assert.ok(CONSIDERATIONS.filter(e => e.group === "dietary").length >= 6);
  });

  test("the old fixed note chips map to catalog ids", () => {
    assert.equal(Object.keys(LEGACY_NOTE_CHIPS).length, 4);
    for (const id of Object.values(LEGACY_NOTE_CHIPS)) assert.ok(isConsiderationId(id), id);
  });

  test("the server and portal copies of the catalog are identical", () => {
    const server = readFileSync(new URL("../../functions/src/modules/ai/domain/considerations.ts", import.meta.url), "utf8");
    const portal = readFileSync(new URL("../../../apps/admin/src/lib/considerations.ts", import.meta.url), "utf8");
    assert.equal(portal, server);
  });
});

describe("consideration ranking", () => {
  test("rules rank every consideration, deterministically, with catalog order breaking ties", () => {
    const one = rankConsiderationsByRules({ tagIds: ["tag-fitness"], goal: "wellness" });
    assert.equal(one.length, CONSIDERATIONS.length);
    assert.deepEqual(one, rankConsiderationsByRules({ tagIds: ["tag-fitness"], goal: "wellness" }));
    assert.deepEqual(new Set(one.map(r => r.id)), new Set(CONSIDERATION_IDS));
    assert.ok(one.every(r => r.probability >= 0 && r.probability <= 1));
    assert.ok(one[0]!.probability >= one[one.length - 1]!.probability);
    // Nothing is dropped: with no context at all the order is the catalog order.
    assert.deepEqual(rankConsiderationsByRules({}).map(r => r.id), CONSIDERATION_IDS);
  });

  test("context raises what it should: outdoors raises a rain plan, a free budget raises low cost", () => {
    const rain = CONSIDERATIONS.find(e => e.id === "rain_plan")!;
    assert.ok(considerationRelevance(rain, { setting: "outdoors" }) > considerationRelevance(rain, { setting: "indoors" }));
    const cheap = CONSIDERATIONS.find(e => e.id === "low_cost")!;
    assert.ok(considerationRelevance(cheap, { budget: "free" }) > considerationRelevance(cheap, { budget: "over_50" }));
  });

  test("local reorder follows the admin's choices without dropping or duplicating anything", () => {
    const base = rankConsiderationsByRules({});
    const next = reorderConsiderations(base, { setting: "outdoors", budget: "free", goal: "competition" });
    assert.equal(next.length, CONSIDERATIONS.length);
    assert.equal(new Set(next.map(r => r.id)).size, CONSIDERATIONS.length);
    const position = (id: string, list = next) => list.findIndex(r => r.id === id);
    assert.ok(position("rain_plan") < position("rain_plan", base));
    assert.ok(position("competitive") < position("competitive", base));
    // A partial or unknown base still yields the full catalog.
    assert.equal(reorderConsiderations([{ id: "vegan", probability: 0.9 }, { id: "bogus", probability: 1 }], {}).length, CONSIDERATIONS.length);
  });

  test("without a usable model answer the rule ranking is used; partial answers keep the model's where valid", () => {
    assert.equal(rankConsiderationsForFacts(FACTS).length, CONSIDERATIONS.length);
    const keyed = Object.keys(considerationQuestions());
    assert.equal(keyed.length, CONSIDERATIONS.length);
    const ranked = considerationsFromAnswers({ consider_vegan: { type: "noul", noul: 0.97 }, consider_halal: { type: "noul", noul: 7 } }, FACTS);
    assert.equal(ranked.length, CONSIDERATIONS.length);
    assert.equal(ranked[0]!.id, "vegan");
    assert.ok(ranked.find(r => r.id === "halal")!.probability <= 0.5, "an out-of-range answer falls back to a rule score");
    assert.ok(ranked.some(r => r.id === "wheelchair_accessible"), "accessibility stays in the list");
  });
});

describe("generate request: consideration ids", () => {
  const ids = new Set(DEFAULT_TAGS.map(t => t.id));
  const body = (extra: Record<string, unknown> = {}) => ({
    contractVersion: 1, companyId: "alpha", requestId: "00000000-0000-4000-8000-0000000000aa",
    choices: { focusTagIds: [], goal: "wellness", groupSize: "team", setting: "indoors", budget: "free", timing: "weekday_lunch" }, prompt: "", count: 1, ...extra,
  });

  test("known ids pass and default to none", () => {
    assert.deepEqual(parseGenerateRequest(body(), ids).considerations, []);
    assert.deepEqual(parseGenerateRequest(body({ considerations: ["vegan", "step_free"] }), ids).considerations, ["vegan", "step_free"]);
  });

  test("unknown, repeated and too many ids are rejected", () => {
    for (const bad of [["nope"], ["vegan", "vegan"], CONSIDERATION_IDS.slice(0, 13), [1]]) {
      assert.throws(() => parseGenerateRequest(body({ considerations: bad }), ids), (e: unknown) => e instanceof AdminError && e.code === "invalid-argument", JSON.stringify(bad));
    }
  });

  test("chosen considerations reach the prompt as labels and hints, and only then", () => {
    const base = { choices: parseGenerateRequest(body(), ids).choices, count: 1, note: "", catalog: DEFAULT_TAGS, topInterests: [], thinTagIds: [], theme: null, now: new Date("2030-01-02T12:00:00Z") };
    assert.doesNotMatch(buildGenerateUserContent(base), /considerations/);
    const text = buildGenerateUserContent({ ...base, considerations: ["vegan", "step_free"] });
    assert.match(text, /Vegan food options/);
    assert.match(text, /Step-free access/);
    assert.doesNotMatch(text, /"vegan"/, "ids stay out of the prompt");
  });
});

describe("suggestion fingerprint", () => {
  const fp = (facts: SuggestionFacts, max = 25) => suggestionFingerprint({ facts, maxInterestCount: max });

  test("stable for equal inputs and under cosmetic differences", () => {
    assert.equal(fp(FACTS), fp({ ...FACTS, theme: { ...FACTS.theme!, tagIds: [...FACTS.theme!.tagIds] } }));
    assert.equal(fp(FACTS, 21), fp(FACTS, 40), "the member count is bucketed (20-49)");
    assert.equal(fp({ ...FACTS, past: past(5) }), fp({ ...FACTS, past: past(8) }), "a few more events in the same bucket do not matter");
    assert.equal(fp({ ...FACTS, catalog: [...DEFAULT_TAGS].reverse() }), fp(FACTS));
  });

  test("changes on a material difference", () => {
    const base = fp(FACTS);
    assert.notEqual(fp({ ...FACTS, interests: [{ tagId: "tag-fitness", bucket: "10-19" }, FACTS.interests[1]!] }), base, "an interest bucket");
    assert.notEqual(fp({ ...FACTS, interests: [...FACTS.interests, { tagId: "tag-arts", bucket: "5-9" }] }), base, "a new interest");
    assert.notEqual(fp({ ...FACTS, theme: { title: "Game Week", tagIds: ["tag-games"] } }), base, "the weekly theme");
    assert.notEqual(fp({ ...FACTS, theme: null }), base);
    assert.notEqual(fp({ ...FACTS, past: past(5) }), base, "first recent events");
    assert.notEqual(fp({ ...FACTS, past: past(5) }), fp({ ...FACTS, past: past(12) }), "a bigger bucket");
    assert.notEqual(fp({ ...FACTS, past: past(5, 1000) }), fp({ ...FACTS, past: past(5, 0) }), "a different leading budget");
    assert.notEqual(fp(FACTS, 4), fp(FACTS, 25), "the member count bucket");
    assert.notEqual(fp({ ...FACTS, catalog: DEFAULT_TAGS.slice(1) }), base, "the option catalog");
  });

  test("buckets and cache reading", () => {
    assert.deepEqual([0, 3, 7, 15, 30, 70, 400].map(countBucket), ["0", "1-4", "5-9", "10-19", "20-49", "50-99", "100+"]);
    assert.equal(readCache(null), null);
    assert.equal(readCache({ provider: "jev" }), null, "an incomplete document is no cache");
    assert.equal(readCache({ leaseHolder: "x", leaseUntil: new Date() }), null, "a lease stub is no cache");
  });
});
