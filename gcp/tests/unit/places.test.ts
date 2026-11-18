import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { AUDIT_ACTIONS } from "../../functions/src/modules/admin/domain/auditActions";
import { can, PERMISSION_MATRIX } from "../../functions/src/modules/admin/domain/permissions";
import { LlmUnavailableError, type DecisionResult } from "../../functions/src/modules/ai/application/ports";
import { CREDIT_COSTS, creditsSummary, ledgerBase, ledgerFromDoc } from "../../functions/src/modules/ai/domain/credits";
import { ScriptedDecisions, type DecisionStepScript } from "../../functions/src/modules/ai/infrastructure/fakes";
import { HeuristicDecisions } from "../../functions/src/modules/ai/infrastructure/heuristicDecisions";
import { findVenues, relaxFindVenuesRequest, type FindVenuesDeps } from "../../functions/src/modules/places/application/findVenues";
import { autocompletePlaces, resolvePlace, type PlaceLookupDeps } from "../../functions/src/modules/places/application/placeLookups";
import { PlacesUnavailableError, type PlaceDetails } from "../../functions/src/modules/places/application/ports";
import { refreshPlaceLocations } from "../../functions/src/modules/places/application/refreshPlaceLocations";
import { setCompanyOffice } from "../../functions/src/modules/places/application/setCompanyOffice";
import { deriveTypes, kindOf, MAX_TYPES, settingOf } from "../../functions/src/modules/places/domain/categories";
import { rankVenues } from "../../functions/src/modules/places/domain/ranking";
import { applyVenueAnswer, venueQuestion } from "../../functions/src/modules/places/domain/venueQuestion";
import { FAKE_PLACES, FakePlaces } from "../../functions/src/modules/places/infrastructure/fakePlaces";
import { FIELD_MASKS, GooglePlaces, localityOf, streetLine } from "../../functions/src/modules/places/infrastructure/googlePlaces";
import { CredentialTokenSource } from "../../functions/src/modules/places/infrastructure/googleToken";
import { placesWiring } from "../../functions/src/modules/places/transport/placesCallables";
import { parseCreateEventRequest } from "../../functions/src/modules/organizer/domain/eventDraft";
import { venueLocationStamp } from "../../functions/src/modules/organizer/application/organizerCommands";
import { FakeAdminStore, caller, seedCompany } from "./helpers/adminFakes";
import { choiceAnswer, decision, uuid } from "./helpers/aiFakes";
import { keepAliveUntilAbort } from "./helpers/keepAlive";

const TOKEN = "ya29.SECRET-TOKEN";
const CENTER = { latitude: 40.4406, longitude: -79.9959 };
const NOW = new Date("2030-01-02T10:00:00Z");
const DAY = 86_400_000;

interface Seen { url: string; init: RequestInit & { headers: Record<string, string> } }
function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  const fn = (async (url: string, init: Seen["init"]) => { const seen = { url: String(url), init }; calls.push(seen); return respond(seen); }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tokens = { getToken: async () => TOKEN };
const bodyOf = (seen: Seen) => JSON.parse(String(seen.init.body)) as Record<string, unknown>;

const rawPlace = (extra: Record<string, unknown> = {}) => ({
  id: "ChIJabc_123-x", displayName: { text: "Corner Bean" }, formattedAddress: "12 Main St, Pittsburgh, PA 15222, USA", shortFormattedAddress: "12 Main St, Pittsburgh",
  addressComponents: [
    { longText: "12", shortText: "12", types: ["street_number"] }, { longText: "Main Street", shortText: "Main St", types: ["route"] },
    { longText: "Pittsburgh", shortText: "Pittsburgh", types: ["locality", "political"] },
  ],
  location: { latitude: 40.44, longitude: -79.99 }, types: ["coffee_shop", "cafe", "establishment"], primaryType: "coffee_shop", businessStatus: "OPERATIONAL", ...extra,
});

describe("GooglePlaces adapter", () => {
  const make = (fn: typeof fetch, timeoutMs = 50) => new GooglePlaces({ tokens, projectId: "team05-dip", fetch: fn, timeoutMs });

  test("autocomplete: POST with bearer token, billing project, session token and office bias; parses suggestions", async () => {
    const f = fakeFetch(() => json({ suggestions: [
      { placePrediction: { placeId: "p1", text: { text: "Corner Bean, Main St" }, structuredFormat: { mainText: { text: "Corner Bean" }, secondaryText: { text: "Main St, Pittsburgh" } }, types: ["cafe", "establishment"] } },
      { placePrediction: { placeId: "p2", structuredFormat: { mainText: { text: "12 Main St" }, secondaryText: { text: "Pittsburgh, PA" } }, types: ["street_address"] } },
      { queryPrediction: { text: { text: "ignored" } } }, "junk",
    ] }));
    const result = await make(f.fn).autocomplete({ input: "12 mai", sessionToken: "s-1", bias: { ...CENTER, radiusMeters: 99_999 } });
    const call = f.calls[0]!;
    assert.equal(call.url, "https://places.googleapis.com/v1/places:autocomplete");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.init.headers["X-Goog-User-Project"], "team05-dip");
    assert.deepEqual(bodyOf(call), {
      input: "12 mai", sessionToken: "s-1", languageCode: "en",
      locationBias: { circle: { center: CENTER, radius: 50_000 } },
    });
    assert.deepEqual(result, [
      { placeId: "p1", primary: "Corner Bean", secondary: "Main St, Pittsburgh", isPlace: true },
      { placeId: "p2", primary: "12 Main St", secondary: "Pittsburgh, PA", isPlace: false },
    ]);
    await make(f.fn).autocomplete({ input: "abc", sessionToken: "s-2", bias: null });
    assert.ok(!("locationBias" in bodyOf(f.calls[1]!)));
  });

  test("details: field mask per tier, session token, street line and locality from address components", async () => {
    const f = fakeFetch(() => json(rawPlace()));
    const adapter = make(f.fn);
    const pro = await adapter.details("ChIJabc_123-x", { tier: "pro", sessionToken: "s-1" });
    assert.equal(f.calls[0]!.init.method, "GET");
    assert.equal(f.calls[0]!.url, "https://places.googleapis.com/v1/places/ChIJabc_123-x?languageCode=en&sessionToken=s-1");
    assert.equal(f.calls[0]!.init.headers["X-Goog-FieldMask"], FIELD_MASKS.pro);
    assert.deepEqual(pro, {
      placeId: "ChIJabc_123-x", name: "Corner Bean", address: "12 Main St", locality: "Pittsburgh", latitude: 40.44, longitude: -79.99,
      types: ["coffee_shop", "cafe", "establishment"], primaryType: "coffee_shop",
    });
    await adapter.details("ChIJabc_123-x", { tier: "essentials" });
    assert.equal(f.calls[1]!.init.headers["X-Goog-FieldMask"], "id,formattedAddress,addressComponents,location,types");
    assert.ok(!f.calls[1]!.url.includes("sessionToken"));
    await adapter.details("ChIJabc_123-x", { tier: "location" });
    assert.equal(f.calls[2]!.init.headers["X-Goog-FieldMask"], "id,location");
    for (const [tier, mask] of Object.entries({ pro: FIELD_MASKS.pro, essentials: FIELD_MASKS.essentials })) {
      assert.ok(!mask.split(",").some(field => ["rating", "userRatingCount", "regularOpeningHours", "websiteUri", "priceLevel"].includes(field)), `${tier} has no Enterprise fields`);
    }
    assert.ok(!FIELD_MASKS.essentials.split(",").includes("displayName"), "essentials has no Pro fields");
  });

  test("details: 404 and permanently closed are null; mapping fallbacks", async () => {
    assert.equal(await make(fakeFetch(() => new Response("", { status: 404 })).fn).details("x", { tier: "pro" }), null);
    assert.equal(await make(fakeFetch(() => json(rawPlace({ businessStatus: "CLOSED_PERMANENTLY" }))).fn).details("x", { tier: "pro" }), null);
    assert.equal(streetLine({ addressComponents: [], shortFormattedAddress: "5 Elm St, Pittsburgh", formattedAddress: "5 Elm St, Pittsburgh, PA" }, true), "5 Elm St");
    assert.equal(streetLine({ addressComponents: [], formattedAddress: "Pittsburgh, PA, USA" }, false), "Pittsburgh");
    assert.equal(localityOf([{ longText: "Cheswick", types: ["postal_town"] }]), "Cheswick");
    assert.equal(localityOf([{ longText: "Allegheny County", types: ["administrative_area_level_2"] }, { longText: "Oakland", types: ["sublocality"] }]), "Oakland");
  });

  test("searchText: ids only with the IDs-only field mask", async () => {
    const f = fakeFetch(() => json({ places: [{ id: "a1" }, { id: "a2" }, {}] }));
    const ids = await make(f.fn).searchTextIds("500 Grant St Pittsburgh", { ...CENTER, radiusMeters: 30_000 });
    assert.deepEqual(ids, ["a1", "a2"]);
    assert.equal(f.calls[0]!.url, "https://places.googleapis.com/v1/places:searchText");
    assert.equal(f.calls[0]!.init.headers["X-Goog-FieldMask"], "places.id");
    assert.deepEqual(Object.keys(bodyOf(f.calls[0]!)).sort(), ["languageCode", "locationBias", "pageSize", "textQuery"]);
    assert.deepEqual(await make(fakeFetch(() => json({})).fn).searchTextIds("zzz", null), []);
  });

  test("searchNearby: Table A types, circle capped at 50 km, popularity rank, mask; drops closed and malformed places", async () => {
    const f = fakeFetch(() => json({ places: [rawPlace(), rawPlace({ id: "closed", businessStatus: "CLOSED_PERMANENTLY" }), { id: "noloc" }, "junk", rawPlace({ id: "p2", displayName: { text: "Park" }, types: ["park"], primaryType: "park" })] }));
    const result = await make(f.fn).searchNearby({ ...CENTER, radiusMeters: 80_000, includedTypes: ["cafe", "park"], maxResults: 99 });
    assert.deepEqual(result.map(p => p.placeId), ["ChIJabc_123-x", "p2"]);
    const call = f.calls[0]!;
    assert.equal(call.url, "https://places.googleapis.com/v1/places:searchNearby");
    assert.equal(call.init.headers["X-Goog-FieldMask"], FIELD_MASKS.nearby);
    assert.deepEqual(bodyOf(call), {
      includedTypes: ["cafe", "park"], maxResultCount: 20, rankPreference: "POPULARITY", languageCode: "en",
      locationRestriction: { circle: { center: CENTER, radius: 50_000 } },
    });
  });

  test("errors are typed and never leak the token, URL or body", async () => {
    const cases: Array<[string, () => Response | Promise<Response>, string]> = [
      ["401", () => new Response(TOKEN, { status: 401 }), "auth"], ["403", () => new Response("", { status: 403 }), "auth"],
      ["429", () => new Response("", { status: 429 }), "rate_limited"], ["500", () => new Response("", { status: 500 }), "upstream"],
      ["400", () => new Response("", { status: 400 }), "upstream"],
      ["network", () => { throw new Error(`connect failed https://places.googleapis.com Bearer ${TOKEN}`); }, "upstream"],
      ["not json", () => new Response("<html>", { status: 200 }), "malformed"],
      ["bad shape", () => json({ id: 5 }), "malformed"],
    ];
    for (const [label, respond, code] of cases) {
      await assert.rejects(make(fakeFetch(respond).fn).details("p", { tier: "pro" }), (error: unknown) => {
        assert.ok(error instanceof PlacesUnavailableError, label);
        assert.equal(error.code, code, label);
        assert.ok(!error.message.includes(TOKEN) && !error.message.includes("http") && !JSON.stringify(error).includes(TOKEN), label);
        return true;
      });
    }
    const hang = ((_url: string, init: RequestInit) => new Promise((_, reject) => { keepAliveUntilAbort(init.signal); init.signal!.addEventListener("abort", () => reject(new Error(`aborted ${TOKEN}`))); })) as unknown as typeof fetch;
    await assert.rejects(make(hang).searchTextIds("x", null), (e: unknown) => e instanceof PlacesUnavailableError && e.code === "timeout" && !e.message.includes(TOKEN));
    const noToken = new GooglePlaces({ tokens: { getToken: async () => { throw new PlacesUnavailableError("auth"); } }, projectId: "p", fetch: fakeFetch(() => json({})).fn });
    await assert.rejects(noToken.searchTextIds("x", null), (e: unknown) => e instanceof PlacesUnavailableError && e.code === "auth");
  });

  test("the token source caches until shortly before expiry and shares one refresh", async () => {
    let issued = 0;
    let clock = 1_000_000;
    const source = new CredentialTokenSource(() => ({ getAccessToken: async () => ({ access_token: `t${++issued}`, expires_in: 3600 }) }) as never, () => clock);
    assert.deepEqual(await Promise.all([source.getToken(), source.getToken()]), ["t1", "t1"]);
    clock += 3_000_000;
    assert.equal(await source.getToken(), "t1");
    clock += 600_000;
    assert.equal(await source.getToken(), "t2");
    const broken = new CredentialTokenSource(() => ({ getAccessToken: async () => { throw new Error(`oauth ${TOKEN}`); } }) as never);
    await assert.rejects(broken.getToken(), (e: unknown) => e instanceof PlacesUnavailableError && e.code === "auth" && !e.message.includes(TOKEN));
  });
});

describe("place types, kinds and ranking", () => {
  test("themes map to Table A types, padded with the broad defaults, at most 8", () => {
    const food = deriveTypes({ title: "Team lunch", tagIds: ["tag-social"] });
    assert.deepEqual(food.includedTypes.slice(0, 2), ["restaurant", "cafe"]);
    for (const base of ["park", "restaurant", "cafe", "museum", "bowling_alley"]) assert.ok(food.includedTypes.includes(base), base);
    const everything = deriveTypes({ title: "lunch drinks hike art games yoga volunteer zoo", isOutdoor: true });
    assert.ok(everything.includedTypes.length <= MAX_TYPES);
    assert.ok(deriveTypes({ title: "Pizza", isOutdoor: false }).includedTypes.every(type => type !== "park"));
    assert.ok(deriveTypes({ title: "Quiet hour" }).includedTypes.length >= 4);
    assert.deepEqual(deriveTypes({ title: "Lunch" }), deriveTypes({ title: "Lunch" }));
  });

  test("Google types map to kind and setting", () => {
    assert.equal(kindOf(["italian_restaurant", "food"]), "restaurant");
    assert.equal(kindOf(["tourist_attraction", "park"], "park"), "park");
    assert.equal(kindOf(["establishment"], "bowling_alley"), "bowling");
    assert.equal(kindOf(["hiking_area"]), "trail");
    assert.equal(kindOf(["store"]), "other");
    assert.deepEqual([settingOf("park"), settingOf("museum"), settingOf("other")], ["outdoor", "indoor", "unknown"]);
  });

  const place = (id: string, name: string | null, types: string[], latitude = 40.4406, longitude = -79.9959): PlaceDetails =>
    ({ placeId: id, name, address: "1 St", locality: "Pgh", latitude, longitude, types, primaryType: types[0] ?? null });

  test("dedupes, drops nameless, scores theme/setting/distance, uses the place id as option id, never invents data", () => {
    const derived = deriveTypes({ title: "Picnic in the park", isOutdoor: true });
    const ranked = rankVenues([
      place("b", "Bowl-O-Rama", ["bowling_alley"], 40.4406, -79.9900),
      place("p", "Riverside Park", ["park"], 40.4450, -79.9900),
      place("p2", "Riverside Park", ["park"], 40.4450, -79.9900),
      place("n", null, ["park"]), place("e", "  ", ["park"]),
    ], { themeKinds: derived.kinds, isOutdoor: true, capacity: 60 }, CENTER);
    assert.deepEqual(ranked.map(r => r.option.name), ["Riverside Park", "Bowl-O-Rama"]);
    const top = ranked[0]!.option;
    assert.deepEqual([top.id, top.placeId, top.website, top.reasons], ["p", "p", null, ["theme_match", "outdoor_fit", "close", "group_fit"]]);
    assert.ok(top.distanceMiles > 0 && top.distanceMiles < 1);
    assert.deepEqual(ranked[1]!.option.reasons, ["close"]);
  });

  const many = ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => place(`id${n}`, `Venue ${n}`, ["cafe"], 40.4406 + i / 1000, -79.9959));
  const ranked = rankVenues(many, { themeKinds: new Set(["cafe"]) }, CENTER);
  const ids = ranked.map(r => r.option.id);

  test("the Jev question: one line per option; probabilities order the result with a floor and a fill to three", () => {
    const question = venueQuestion(ranked);
    assert.equal(question.type, "choice");
    if (question.type === "choice") assert.match(question.criteria[ids[0]!]!, /^Venue A: cafe, indoor, 0\.0 mi$/);
    const answer = { type: "choice" as const, choice: ids[4]!, probabilities: { [ids[4]!]: 0.6, [ids[2]!]: 0.3, [ids[1]!]: 0.01 }, confidence: 0.6 };
    assert.deepEqual(applyVenueAnswer(ranked, answer).venues.map(v => v.option.id), [ids[4], ids[2], ids[0]]);
    assert.deepEqual(applyVenueAnswer(ranked, choiceAnswer(ids[3]!, 0.9)).venues.map(v => v.option.id), [ids[3], ids[0], ids[1]]);
    assert.equal(applyVenueAnswer(ranked, undefined).used, false);
    assert.equal(applyVenueAnswer(ranked, { type: "choice", choice: "x", probabilities: { x: 1 }, confidence: 1 }).used, false);
  });

  test("the heuristic decision provider answers the heuristic top", async () => {
    const result = await new HeuristicDecisions().decide({ step: "venuePick", state: "s", questions: { venue: venueQuestion(ranked) } });
    const answer = result.answers.venue;
    assert.ok(result.provider === "heuristic" && answer?.type === "choice" && answer.choice === ids[0]);
  });
});

describe("autocompletePlacesV1 and resolvePlaceV1", () => {
  const auto = (extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", sessionToken: uuid(1), input: "schenley", ...extra });
  function rig(extra: Partial<PlaceLookupDeps> = {}) {
    const store = new FakeAdminStore();
    seedCompany(store);
    store.seed("companies/alpha", { name: "Alpha", city: "Pittsburgh", officeLatitude: CENTER.latitude, officeLongitude: CENTER.longitude });
    const places = new FakePlaces();
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const consumed: string[] = [];
    const deps: PlaceLookupDeps = { store, places, enabled: true, now: () => NOW, limiter: { consume: async uid => { consumed.push(uid); } }, log: (event, fields) => logs.push({ event, fields }), ...extra };
    return { store, places, deps, logs, consumed };
  }
  async function fails(promise: Promise<unknown>, reason: string) {
    await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.reason, reason); return true; });
  }
  const usage = (store: FakeAdminStore) => Number(store.get("companies/alpha/placesUsage/20300102")?.count ?? 0);

  test("organizers and admins get suggestions biased to the office; the typed text is not logged", async () => {
    for (const uid of ["admin1", "org1"]) {
      const r = rig();
      const response = await autocompletePlaces(r.deps, caller(uid), auto());
      assert.deepEqual(response.suggestions.map(s => s.placeId), ["fake_park_schenley"]);
      assert.equal(response.suggestions[0]!.isPlace, true);
      assert.deepEqual((r.places.calls[0]!.args as { bias: unknown }).bias, { ...CENTER, radiusMeters: 30_000 });
      assert.equal(usage(r.store), 1);
      assert.ok(!JSON.stringify(r.logs).includes("schenley"));
    }
    const noOffice = rig();
    noOffice.store.seed("companies/alpha", { name: "Alpha" });
    await autocompletePlaces(noOffice.deps, caller("admin1"), auto());
    assert.equal((noOffice.places.calls[0]!.args as { bias: unknown }).bias, null);
  });

  test("auth denial, tenant isolation, validation, kill switch, limiter and daily cap", async () => {
    const r = rig();
    await fails(autocompletePlaces(r.deps, null, auto()), "UNAUTHENTICATED");
    await fails(autocompletePlaces(r.deps, caller("m1"), auto()), "INSUFFICIENT_ROLE");
    await fails(autocompletePlaces(r.deps, caller("bo"), auto()), "COMPANY_MISMATCH");
    await fails(autocompletePlaces(r.deps, caller("deact"), auto()), "ACCOUNT_DEACTIVATED");
    await fails(autocompletePlaces(r.deps, caller("nobody"), auto()), "MEMBERSHIP_CONFLICT");
    assert.deepEqual([r.consumed, r.places.calls.length, usage(r.store)], [[], 0, 0], "refused before the limiter and Google");
    for (const extra of [{ input: "ab" }, { input: "x".repeat(201) }, { sessionToken: "" }, { surprise: 1 }]) await fails(autocompletePlaces(r.deps, caller("admin1"), auto(extra)), "VALIDATION_FAILED");
    await fails(autocompletePlaces(rig({ enabled: false }).deps, caller("admin1"), auto()), "PLACES_DISABLED");
    await fails(autocompletePlaces(rig({ places: null }).deps, caller("admin1"), auto()), "PLACES_DISABLED");
    const limited = rig({ limiter: { consume: async () => { throw new AdminError("resource-exhausted", "RATE_LIMITED", "Too many requests."); } } });
    await fails(autocompletePlaces(limited.deps, caller("admin1"), auto()), "RATE_LIMITED");
    assert.equal(limited.places.calls.length, 0);
    const capped = rig({ dailyLimit: 2 });
    await autocompletePlaces(capped.deps, caller("admin1"), auto());
    await autocompletePlaces(capped.deps, caller("admin1"), auto());
    await fails(autocompletePlaces(capped.deps, caller("admin1"), auto()), "PLACES_LIMIT");
    assert.equal(capped.places.calls.length, 2);
  });

  test("a Google outage is a clean unavailable error", async () => {
    const r = rig();
    r.places.failWith = new PlacesUnavailableError("rate_limited");
    await assert.rejects(autocompletePlaces(r.deps, caller("admin1"), auto()), (e: unknown) => e instanceof AdminError && e.code === "unavailable" && e.reason === "PLACES_UNAVAILABLE");
    assert.ok(JSON.stringify(r.logs).includes("places_rate_limited"));
  });

  test("resolve by placeId: Details Pro with the session token; the place carries name, kind and setting", async () => {
    const r = rig();
    const response = await resolvePlace(r.deps, caller("org1"), { contractVersion: 1, companyId: "alpha", placeId: "fake_park_schenley", sessionToken: uuid(3) });
    assert.deepEqual(response.place, {
      placeId: "fake_park_schenley", name: "Schenley Park", address: "4100 Forbes Ave", locality: "Pittsburgh", latitude: 40.4343, longitude: -79.942, kind: "park", setting: "outdoor",
    });
    assert.deepEqual(r.places.calls[0], { method: "details", args: { placeId: "fake_park_schenley", tier: "pro", sessionToken: uuid(3) } });
    assert.equal(usage(r.store), 1);
  });

  test("resolve by query: text search for ids only, then Details Essentials with no name; nothing found has no place", async () => {
    const r = rig();
    const response = await resolvePlace(r.deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", query: "500 Grant St Pittsburgh" });
    assert.deepEqual(r.places.calls.map(c => c.method), ["searchTextIds", "details"]);
    assert.equal((r.places.calls[1]!.args as { tier: string }).tier, "essentials");
    assert.deepEqual([response.place?.placeId, response.place?.name, response.place?.address, response.place?.kind], ["fake_addr_grant", null, "500 Grant St", "other"]);
    assert.equal(usage(r.store), 2);
    const none = await resolvePlace(r.deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", query: "zzzz nowhere" });
    assert.deepEqual(none, { contractVersion: 1 });
    const gone = rig();
    gone.places.gone.add("fake_park_schenley");
    assert.deepEqual(await resolvePlace(gone.deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", placeId: "fake_park_schenley" }), { contractVersion: 1 });
  });

  test("resolve validation and auth", async () => {
    const r = rig();
    for (const bad of [{}, { placeId: "a b" }, { query: "ab" }, { placeId: "fake_park_schenley", query: "500 Grant" }, { placeId: "x", extra: 1 }]) {
      await fails(resolvePlace(r.deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", ...bad }), "VALIDATION_FAILED");
    }
    await fails(resolvePlace(r.deps, caller("m1"), { contractVersion: 1, companyId: "alpha", placeId: "x" }), "INSUFFICIENT_ROLE");
    await fails(resolvePlace(r.deps, caller("bo"), { contractVersion: 1, companyId: "alpha", placeId: "x" }), "COMPANY_MISMATCH");
    await fails(resolvePlace(rig({ enabled: false }).deps, caller("admin1"), { contractVersion: 1, companyId: "alpha", placeId: "x" }), "PLACES_DISABLED");
    assert.equal(r.places.calls.length, 0);
  });
});

describe("findVenuesV1", () => {
  const body = (n: number, extra: Record<string, unknown> = {}) => ({
    contractVersion: 1, companyId: "alpha", requestId: uuid(n), title: "Team lunch", description: "Secret plan details xyzzy", tagIds: ["tag-food"], isOutdoor: false, capacity: 20, ...extra,
  });
  const jevSecond = (): DecisionStepScript => request => decision(request, { venue: choiceAnswer(Object.keys((request.questions.venue as { criteria: object }).criteria)[1]!, 0.9) });
  const heuristic = (): DecisionStepScript => request => ({ ...decision(request), provider: "heuristic" }) as DecisionResult;

  function rig(script: DecisionStepScript[] = [jevSecond()], extra: Partial<FindVenuesDeps> = {}) {
    const store = new FakeAdminStore();
    seedCompany(store);
    store.seed("companies/alpha", { name: "Alpha", emailDomain: "alpha.test", city: "Pittsburgh", officeAddress: "500 Grant St", officeLatitude: CENTER.latitude, officeLongitude: CENTER.longitude });
    const places = new FakePlaces();
    const decisions = new ScriptedDecisions(script);
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const consumed: string[] = [];
    const deps: FindVenuesDeps = {
      store, decisions, places, enabled: true, now: () => NOW, limiter: { consume: async uid => { consumed.push(uid); } }, log: (event, fields) => logs.push({ event, fields }), ...extra,
    };
    return { store, decisions, places, deps, logs, consumed };
  }
  async function fails(promise: Promise<unknown>, reason: string) {
    await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.reason, reason); return true; });
  }
  const CREDITS = "companies/alpha/aiCredits/203001";
  const used = (store: FakeAdminStore) => Number(store.get(CREDITS)?.used ?? 0);
  const searches = (r: ReturnType<typeof rig>) => r.places.calls.filter(c => c.method === "searchNearby");

  test("a Jev-ranked search is charged; the Places request carries only types, coordinates and radius; the cache holds ids and ranks only", async () => {
    const r = rig();
    const response = await findVenues(r.deps, caller("admin1"), body(1));
    assert.deepEqual([response.provider, response.cached, response.charged, response.radiusMiles], ["jev", false, true, 5]);
    assert.ok(response.venues.length >= 3 && response.venues.length <= 5);
    assert.ok(response.venues.every(v => v.id === v.placeId && v.website === null));
    assert.equal(response.office.address, "500 Grant St");
    assert.equal(used(r.store), 1);
    assert.equal(searches(r).length, 1);
    const sent = JSON.stringify(searches(r)[0]!.args);
    for (const text of ["lunch", "Secret", "xyzzy", "tag-food", "Team"]) assert.ok(!sent.includes(text), `no event text reaches Google: ${text}`);
    assert.deepEqual(Object.keys(searches(r)[0]!.args as object).sort(), ["includedTypes", "latitude", "longitude", "maxResults", "radiusMeters"]);
    assert.ok(JSON.stringify(r.decisions.calls[0]!.state).includes("Team lunch"), "event text reaches the decision provider only");
    const cacheDocs = [...r.store.docs.keys()].filter(p => p.startsWith("companies/alpha/aiVenueSearches/"));
    assert.equal(cacheDocs.length, 1);
    const cached = JSON.stringify(r.store.get(cacheDocs[0]!));
    for (const forbidden of ["Primanti", "Commonplace", "Warhol", "Arsenal", "Forbes", "Liberty", "40.4", "-79.9", "xyzzy", "Pittsburgh"]) assert.ok(!cached.includes(forbidden), `cache must not store ${forbidden}`);
    assert.ok(cached.includes("fake_") && cached.includes("kind"));
    const log = JSON.stringify(r.logs);
    assert.ok(!log.includes("xyzzy") && !log.includes("lunch") && !log.includes(String(CENTER.latitude)) && !log.includes("Primanti"));
  });

  test("a cache hit re-fetches the ids (Details Pro), recomputes distance, charges nothing, searches nothing and counts toward the places cap", async () => {
    const r = rig();
    const first = await findVenues(r.deps, caller("admin1"), body(1));
    r.places.calls.length = 0;
    const second = await findVenues(r.deps, caller("admin1"), body(2));
    assert.deepEqual([second.cached, second.charged, second.provider], [true, false, "jev"]);
    assert.deepEqual(second.venues.map(v => v.placeId), first.venues.map(v => v.placeId));
    assert.equal(searches(r).length, 0);
    assert.deepEqual([...new Set(r.places.calls.map(c => c.method))], ["details"]);
    assert.ok(r.places.calls.every(c => (c.args as { tier: string }).tier === "pro"));
    assert.equal(r.decisions.calls.length, 1);
    assert.equal(used(r.store), 1);
    assert.equal(Number(r.store.get("companies/alpha/placesUsage/20300102")?.count), first.venues.length);
    // A moved place changes the recomputed distance.
    r.places.moved.set(second.venues[0]!.placeId, { latitude: 40.5, longitude: -80.1 });
    const third = await findVenues(r.deps, caller("admin1"), body(3));
    assert.ok(third.venues[0]!.distanceMiles > second.venues[0]!.distanceMiles);
  });

  test("a cache hit whose re-fetch fails or finds a vanished place is a miss (fresh, charged search)", async () => {
    const r = rig([jevSecond(), jevSecond()]);
    const first = await findVenues(r.deps, caller("admin1"), body(1));
    r.places.gone.add(first.venues[0]!.placeId);
    const again = await findVenues(r.deps, caller("admin1"), body(2));
    assert.deepEqual([again.cached, again.charged], [false, true]);
    assert.equal(searches(r).length, 2);
    const expired = rig(); await findVenues(expired.deps, caller("admin1"), body(1));
    await findVenues({ ...expired.deps, now: () => new Date("2030-01-03T11:00:00Z") }, caller("admin1"), body(3));
    assert.equal(searches(expired).length, 2, "after 24 h the cache is stale");
  });

  test("the heuristic provider is refunded and not cached; a decision outage still answers", async () => {
    const r = rig([heuristic()]);
    const response = await findVenues(r.deps, caller("admin1"), body(1));
    assert.deepEqual([response.provider, response.charged, used(r.store)], ["heuristic", false, 0]);
    assert.equal([...r.store.docs.keys()].filter(p => p.includes("aiVenueSearches")).length, 0);
    const outage = rig([new LlmUnavailableError(null)]);
    const down = await findVenues(outage.deps, caller("admin1"), body(2));
    assert.deepEqual([down.provider, down.charged, used(outage.store)], [null, false, 0]);
    assert.ok(down.venues.length > 0);
  });

  test("duplicate requestId is charged once; out of credits and the daily cap fail before Google", async () => {
    const r = rig([jevSecond(), jevSecond()]);
    await findVenues(r.deps, caller("admin1"), body(1, { title: "Lunch one" }));
    await findVenues(r.deps, caller("admin1"), body(1, { title: "Lunch two" }));
    assert.equal(used(r.store), 1);
    const broke = rig();
    broke.store.seed("companies/alpha/aiSettings/current", { monthlyCredits: 0 });
    await fails(findVenues(broke.deps, caller("admin1"), body(1)), "AI_CREDITS_EXHAUSTED");
    assert.equal(searches(broke).length, 0);
    assert.equal(broke.store.get("companies/alpha/aiVenueUsage/20300102"), undefined);
    const capped = rig([jevSecond(), jevSecond(), jevSecond()], { dailyLimit: 2 });
    await findVenues(capped.deps, caller("admin1"), body(1, { title: "Lunch A" }));
    await findVenues(capped.deps, caller("admin1"), body(2, { title: "Lunch B" }));
    await fails(findVenues(capped.deps, caller("admin1"), body(3, { title: "Lunch C" })), "VENUE_SEARCH_LIMIT");
    assert.equal(searches(capped).length, 2);
    assert.equal((await findVenues(capped.deps, caller("admin1"), body(4, { title: "Lunch A" }))).cached, true);
  });

  test("a Google outage refunds the credit", async () => {
    const r = rig();
    r.places.failWith = new PlacesUnavailableError("upstream");
    await assert.rejects(findVenues(r.deps, caller("admin1"), body(1)), (e: unknown) => e instanceof AdminError && e.code === "unavailable" && e.reason === "VENUES_UNAVAILABLE");
    assert.deepEqual([used(r.store), r.decisions.calls.length], [0, 0]);
  });

  test("kill switch, missing provider and missing office", async () => {
    await fails(findVenues(rig(undefined, { enabled: false }).deps, caller("admin1"), body(1)), "AI_VENUES_DISABLED");
    await fails(findVenues(rig(undefined, { places: null }).deps, caller("admin1"), body(1)), "AI_VENUES_DISABLED");
    for (const office of [{}, { officeLatitude: 0, officeLongitude: 0 }, { officeLatitude: "x", officeLongitude: 1 }]) {
      const r = rig();
      r.store.seed("companies/alpha", { name: "Alpha", ...office });
      await fails(findVenues(r.deps, caller("admin1"), body(1)), "OFFICE_NOT_SET");
      assert.deepEqual([r.places.calls.length, used(r.store)], [0, 0]);
    }
  });

  test("placesWiring: off by default, on with PLACES_ENABLED and a project, canned data in the emulator", () => {
    assert.equal(placesWiring({}).enabled, false);
    assert.equal(placesWiring({ PLACES_ENABLED: "true" }).enabled, false, "no project id");
    assert.equal(placesWiring({ PLACES_ENABLED: "true", GCLOUD_PROJECT: "team05-dip" }).enabled, true);
    assert.equal(placesWiring({ PLACES_ENABLED: "false", GCLOUD_PROJECT: "team05-dip" }).enabled, false);
    const demo = placesWiring({ AI_PROVIDER: "demo", FUNCTIONS_EMULATOR: "true" });
    assert.ok(demo.enabled && demo.places instanceof FakePlaces);
  });

  test("auth: only admins; refused before the limiter, credits or Google", async () => {
    const r = rig();
    await fails(findVenues(r.deps, null, body(1)), "UNAUTHENTICATED");
    await fails(findVenues(r.deps, caller("m1"), body(1)), "INSUFFICIENT_ROLE");
    await fails(findVenues(r.deps, caller("org1"), body(1)), "INSUFFICIENT_ROLE");
    await fails(findVenues(r.deps, caller("bo"), body(1)), "COMPANY_MISMATCH");
    await fails(findVenues(r.deps, caller("deact"), body(1)), "ACCOUNT_DEACTIVATED");
    assert.deepEqual([r.consumed, r.places.calls.length, used(r.store)], [[], 0, 0]);
  });

  test("validation: strict fields, relaxed optional hints; creditsSummary carries the price", async () => {
    const r = rig();
    for (const extra of [{ requestId: "nope" }, { title: "" }, { surprise: 1 }, { contractVersion: 2 }]) await fails(findVenues(r.deps, caller("admin1"), body(1, extra)), "VALIDATION_FAILED");
    const relaxed = relaxFindVenuesRequest({ ...body(1), description: null, tagIds: ["a", "a", "bad id!"], capacity: -3, radiusMiles: 99, isOutdoor: "yes", costCents: 1.5 }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(relaxed).sort(), ["companyId", "contractVersion", "requestId", "tagIds", "title"]);
    assert.equal((await findVenues(r.deps, caller("admin1"), body(7, { radiusMiles: 99, capacity: 0 }))).radiusMiles, 5);
    assert.equal(creditsSummary(ledgerFromDoc(ledgerBase(null, null, NOW), null)).creditCost.venueSearch, CREDIT_COSTS.venueSearch);
  });
});

describe("setCompanyOfficeV1", () => {
  const request = (extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", placeId: "fake_addr_grant", sessionToken: uuid(5), ...extra });
  function rig(extra: Record<string, unknown> = {}) {
    const store = new FakeAdminStore();
    seedCompany(store);
    const places = new FakePlaces();
    let n = 0;
    return { store, places, deps: { store, places, enabled: true, now: () => NOW, newId: () => `id${++n}`, ...extra } };
  }
  async function fails(promise: Promise<unknown>, reason: string) {
    await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.reason, reason); return true; });
  }

  test("permission: admin only; the audit action exists", () => {
    assert.deepEqual(PERMISSION_MATRIX["company.manage"], ["admin"]);
    assert.deepEqual([can("admin", "company.manage"), can("organizer", "company.manage"), can("member", "company.manage")], [true, false, false]);
    assert.ok(AUDIT_ACTIONS.includes("company.office.update"));
  });

  test("the server resolves the place (Details Essentials); the client never supplies coordinates; one audit entry without the address", async () => {
    const r = rig();
    const response = await setCompanyOffice(r.deps as never, caller("admin1"), request());
    assert.deepEqual(response.office, { address: "500 Grant St", locality: "Pittsburgh", latitude: 40.4406, longitude: -79.9959 });
    assert.deepEqual(r.places.calls[0], { method: "details", args: { placeId: "fake_addr_grant", tier: "essentials", sessionToken: uuid(5) } });
    const company = r.store.get("companies/alpha")!;
    assert.deepEqual(
      [company.officeAddress, company.city, company.officeLatitude, company.officeLongitude, company.officePlaceId, company.officeLocationAt],
      ["500 Grant St", "Pittsburgh", 40.4406, -79.9959, "fake_addr_grant", NOW],
    );
    const audits = r.store.children("companies/alpha/auditLog");
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.data.action, "company.office.update");
    assert.ok(!JSON.stringify(audits[0]!.data).includes("Grant") && !JSON.stringify(audits[0]!.data).includes("40.44"));
    assert.equal(Number(r.store.get("companies/alpha/placesUsage/20300102")?.count), 1);
  });

  test("validation, 0/0, not found, switch off, Google outage", async () => {
    const r = rig();
    for (const bad of [{ placeId: "" }, { placeId: "a b" }, { office: { latitude: 1 } }, { latitude: 1 }, { extra: 1 }]) await fails(setCompanyOffice(r.deps as never, caller("admin1"), request(bad)), "VALIDATION_FAILED");
    await fails(setCompanyOffice(r.deps as never, caller("admin1"), request({ placeId: "unknown_place" })), "PLACE_NOT_FOUND");
    r.places.moved.set("fake_addr_grant", { latitude: 0, longitude: 0 });
    await fails(setCompanyOffice(r.deps as never, caller("admin1"), request()), "VALIDATION_FAILED");
    assert.equal(r.store.get("companies/alpha")!.officeLatitude, undefined);
    await fails(setCompanyOffice(rig({ enabled: false }).deps as never, caller("admin1"), request()), "PLACES_DISABLED");
    const down = rig();
    down.places.failWith = new PlacesUnavailableError("auth");
    await assert.rejects(setCompanyOffice(down.deps as never, caller("admin1"), request()), (e: unknown) => e instanceof AdminError && e.reason === "PLACES_UNAVAILABLE");
  });

  test("auth and tenant isolation", async () => {
    const r = rig();
    await fails(setCompanyOffice(r.deps as never, null, request()), "UNAUTHENTICATED");
    await fails(setCompanyOffice(r.deps as never, caller("m1"), request()), "INSUFFICIENT_ROLE");
    await fails(setCompanyOffice(r.deps as never, caller("org1"), request()), "INSUFFICIENT_ROLE");
    await fails(setCompanyOffice(r.deps as never, caller("bo"), request()), "COMPANY_MISMATCH");
    await fails(setCompanyOffice(r.deps as never, caller("admin1"), request({ companyId: "beta" })), "COMPANY_MISMATCH");
    assert.equal(r.places.calls.length, 0);
    assert.equal(r.store.get("companies/beta")!.officePlaceId, undefined);
    assert.equal(r.store.children("companies/alpha/auditLog").length, 0);
  });
});

describe("event venue location stamp", () => {
  const venue = (extra: Record<string, unknown> = {}) => ({ name: "Park", address: "1 St", locality: "Pgh", latitude: 40.1, longitude: -79.9, ...extra });
  const parsed = (v: Record<string, unknown>) => parseCreateEventRequest({
    contractVersion: 1, companyId: "alpha", requestId: uuid(9),
    event: { title: "Trivia", description: "Teams of four.", tagIds: ["tag-games"], coverImageURL: "catalog://default/games", startTime: "2030-02-01T10:00:00Z", endTime: "2030-02-01T11:30:00Z", venue: v, costCents: 500, costNote: "", capacity: 10, isOutdoor: false },
  }).event.venue;
  const at = new Date("2030-01-01T00:00:00Z");

  test("place id is validated and accepted on the venue", () => {
    assert.equal(parsed(venue({ placeId: "ChIJ_abc-1" })).placeId, "ChIJ_abc-1");
    assert.equal(parsed(venue({ placeId: null })).placeId, undefined);
    assert.throws(() => parsed(venue({ placeId: "bad id" })));
    assert.throws(() => parsed(venue({ placeId: "x".repeat(513) })));
    assert.throws(() => parsed(venue({ venueLocationAt: "2030-01-01T00:00:00Z" })), "clients cannot set the stamp");
  });

  test("set on create and on new place or coordinates, kept when unchanged, cleared without a place id", () => {
    const withPlace = parsed(venue({ placeId: "p1" }));
    assert.deepEqual(venueLocationStamp(withPlace, null, NOW), { kind: "set", at: NOW });
    const current = { venue: { latitude: 40.1, longitude: -79.9, placeId: "p1" }, venueLocationAt: at };
    assert.deepEqual(venueLocationStamp(withPlace, current, NOW), { kind: "keep" });
    assert.deepEqual(venueLocationStamp(parsed(venue({ placeId: "p2" })), current, NOW), { kind: "set", at: NOW });
    assert.deepEqual(venueLocationStamp(parsed(venue({ placeId: "p1", latitude: 40.2 })), current, NOW), { kind: "set", at: NOW });
    assert.deepEqual(venueLocationStamp(withPlace, { venue: current.venue }, NOW), { kind: "set", at: NOW }, "no stamp yet");
    assert.deepEqual(venueLocationStamp(parsed(venue()), current, NOW), { kind: "clear" });
    assert.deepEqual(venueLocationStamp(parsed(venue({ latitude: 0, longitude: 0 })), null, NOW), { kind: "clear" }, "legacy 0/0 events are untouched");
  });
});

describe("refreshPlaceLocations", () => {
  const old = new Date(NOW.getTime() - 26 * DAY);
  const fresh = new Date(NOW.getTime() - 10 * DAY);
  const event = (extra: Record<string, unknown>) => ({
    companyId: "alpha", title: "E", status: "scheduled", startTime: new Date(NOW.getTime() + DAY), endTime: new Date(NOW.getTime() + 2 * DAY),
    venue: { name: "Park", address: "1 St", locality: "Pgh", latitude: 1, longitude: 2, placeId: "fake_park_schenley" }, venueLocationAt: old, ...extra,
  });
  function rig() {
    const store = new FakeAdminStore();
    store.seed("companies/alpha/events/upcoming", event({}));
    store.seed("companies/alpha/events/ongoing", event({ startTime: new Date(NOW.getTime() - DAY), endTime: new Date(NOW.getTime() + DAY), venue: { name: "P", address: "a", locality: "l", latitude: 1, longitude: 2, placeId: "fake_park_point" } }));
    store.seed("companies/alpha/events/ended", event({ startTime: new Date(NOW.getTime() - 3 * DAY), endTime: new Date(NOW.getTime() - 2 * DAY) }));
    store.seed("companies/alpha/events/cancelled", event({ status: "cancelled" }));
    store.seed("companies/alpha/events/vanished", event({ venue: { name: "Gone", address: "a", locality: "l", latitude: 1, longitude: 2, placeId: "fake_gone" } }));
    store.seed("companies/alpha/events/recent", event({ venueLocationAt: fresh }));
    store.seed("companies/alpha/events/legacy", { companyId: "alpha", title: "L", status: "scheduled", endTime: new Date(NOW.getTime() + DAY), venue: { name: "x", address: "a", locality: "l", latitude: 0, longitude: 0 } });
    store.seed("companies/alpha", { name: "Alpha", officeLatitude: 1, officeLongitude: 1, officePlaceId: "fake_addr_grant", officeLocationAt: old });
    store.seed("companies/beta", { name: "Beta", officeLatitude: 1, officeLongitude: 1, officePlaceId: "fake_gone", officeLocationAt: old });
    store.seed("companies/gamma", { name: "Gamma", officeLatitude: 3, officeLongitude: 3, officePlaceId: "fake_addr_grant", officeLocationAt: fresh });
    const places = new FakePlaces();
    places.gone.add("fake_gone");
    places.moved.set("fake_park_schenley", { latitude: 40.5, longitude: -79.5 });
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    return { store, places, logs, deps: { store, places, enabled: true, now: () => NOW, log: (event: string, fields: Record<string, unknown>) => logs.push({ event, fields }) } as never };
  }
  const venueOf = (store: FakeAdminStore, id: string) => store.get(`companies/alpha/events/${id}`)!.venue as Record<string, unknown>;

  test("upcoming and ongoing events are refreshed, ended, cancelled and vanished ones are retired (place id kept), fresh and legacy ones are untouched", async () => {
    const r = rig();
    const summary = await refreshPlaceLocations(r.deps);
    assert.deepEqual(summary, { eventsRefreshed: 2, eventsRetired: 3, eventsSkipped: 0, officesRefreshed: 1, officesRetired: 1, officesSkipped: 0 });
    assert.deepEqual([venueOf(r.store, "upcoming").latitude, venueOf(r.store, "upcoming").longitude], [40.5, -79.5]);
    assert.deepEqual(r.store.get("companies/alpha/events/upcoming")!.venueLocationAt, NOW);
    assert.equal(r.places.calls.filter(c => (c.args as { placeId?: string }).placeId === "fake_park_schenley").every(c => (c.args as { tier: string }).tier === "location"), true);
    for (const id of ["ended", "cancelled", "vanished"]) {
      assert.deepEqual([venueOf(r.store, id).latitude, venueOf(r.store, id).longitude], [0, 0], id);
      assert.equal("venueLocationAt" in r.store.get(`companies/alpha/events/${id}`)!, false, id);
    }
    assert.equal(venueOf(r.store, "ended").placeId, "fake_park_schenley", "the place id stays");
    assert.deepEqual([venueOf(r.store, "recent").latitude, r.store.get("companies/alpha/events/recent")!.venueLocationAt], [1, fresh]);
    assert.equal(venueOf(r.store, "legacy").latitude, 0);
    assert.deepEqual([r.store.get("companies/alpha")!.officeLatitude, r.store.get("companies/alpha")!.officeLocationAt], [40.4406, NOW]);
    assert.deepEqual([r.store.get("companies/beta")!.officeLatitude, "officeLocationAt" in r.store.get("companies/beta")!], [0, false]);
    assert.deepEqual(r.store.get("companies/gamma")!.officeLocationAt, fresh);
    assert.ok(r.logs.some(l => l.event === "places.refresh"));
  });

  test("with Places off, ended events are still retired and nothing is refreshed; a Google failure skips until the next run", async () => {
    const off = rig();
    const summary = await refreshPlaceLocations({ ...(off.deps as object), enabled: false } as never);
    assert.deepEqual([summary.eventsRetired, summary.eventsRefreshed, summary.officesRefreshed], [2, 0, 0]);
    assert.equal(venueOf(off.store, "upcoming").latitude, 1);
    const down = rig();
    down.places.failWith = new PlacesUnavailableError("upstream");
    const failed = await refreshPlaceLocations(down.deps);
    assert.deepEqual([failed.eventsRefreshed, failed.eventsRetired, failed.officesRefreshed], [0, 2, 0]);
    assert.equal(venueOf(down.store, "upcoming").latitude, 1);
    assert.deepEqual(down.store.get("companies/alpha/events/upcoming")!.venueLocationAt, old, "still due tomorrow");
    const bounded = rig();
    const small = await refreshPlaceLocations({ ...(bounded.deps as object), batch: 1 } as never);
    assert.equal(small.eventsRefreshed + small.eventsRetired + small.eventsSkipped, 1);
  });
});
