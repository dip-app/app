import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { LlmUnavailableError, type DecisionRequest, type DecisionResult } from "../../functions/src/modules/ai/application/ports";
import { CREDIT_COSTS } from "../../functions/src/modules/ai/domain/credits";
import { ScriptedDecisions, type DecisionStepScript } from "../../functions/src/modules/ai/infrastructure/fakes";
import { pickCover, pickEventCover, type PickCoverDeps } from "../../functions/src/modules/covers/application/pickCover";
import { COVER_INDEX, type CoverIndexEntry } from "../../functions/src/modules/covers/domain/catalog.generated";
import {
  coverByKey, coverJpegURL, coverKeyFromURL, DEFAULT_COVER_URL, indexKeySource, isApprovedCoverURL, isApprovedCoverURLFrom, LEGACY_COVER_URLS, parseCoverKey, themesFromTagIds,
} from "../../functions/src/modules/covers/domain/coverCatalog";
import { chosenCoverKey, coverQuestion } from "../../functions/src/modules/covers/domain/coverQuestion";
import { DEFAULT_MAX_CANDIDATES, isEligible, lexicalRank, lexicalTop, optionsForSingleCall, rankCovers, shortlist, stem, themeGroups, tokenize } from "../../functions/src/modules/covers/domain/shortlist";
import { parseEventDraft } from "../../functions/src/modules/organizer/domain/eventDraft";
import { OrganizerError } from "../../functions/src/modules/organizer/domain/errors";
import { buildPreview, renderSharePage, resolveImage, SHARE_ORIGIN } from "../../functions/src/modules/share/domain/sharePage";
import { FakeAdminStore, caller, seedCompany } from "./helpers/adminFakes";
import { choiceAnswer, decision, uuid } from "./helpers/aiFakes";

const entry = (key: string, themes: string[], tags: string[], label: string, extra: Partial<CoverIndexEntry> = {}): CoverIndexEntry => ({
  key, url: `catalog://cover/${key}`, kind: "photo", themes, tags, mood: [], label, alt: label, hasJpeg: true, ...extra,
});
const illustration = (key: string, theme: string): CoverIndexEntry =>
  entry(key, [theme], [theme], `${theme} illustration`, { kind: "illustration" });

/** Small fixture index: one or more covers per theme, plus the theme defaults the real index names. */
const FIXTURE: readonly CoverIndexEntry[] = [
  entry("default-outdoors", ["outdoors"], ["outdoors", "park", "picnic"], "Outdoors in the park", { url: "catalog://default/outdoors" }),
  entry("default-fitness", ["fitness"], ["fitness", "workout", "exercise"], "Group workout", { url: "catalog://default/fitness" }),
  entry("default-cooking", ["food"], ["cooking", "baking", "potluck"], "Cooking together", { url: "catalog://default/cooking" }),
  entry("default-games", ["games"], ["board games", "trivia", "puzzle"], "Game night", { url: "catalog://default/games" }),
  entry("kayak-lake", ["outdoors"], ["kayaking", "paddling", "lake", "canoe"], "Kayaking on a lake"),
  entry("hike-ridge", ["outdoors", "wellness"], ["hiking", "trail", "mountain"], "Hiking a mountain trail"),
  entry("yoga-studio", ["fitness", "wellness"], ["yoga", "stretching", "meditation"], "Yoga class in a studio"),
  entry("coffee-cafe", ["food"], ["coffee", "cafe", "brunch"], "Coffee at a cafe"),
  entry("pottery-wheel", ["arts"], ["pottery", "ceramics", "painting", "craft"], "Pottery on the wheel"),
  entry("bowling-lane", ["games"], ["bowling", "league"], "Bowling lane"),
  entry("karaoke-stage", ["music"], ["karaoke", "concert", "band", "choir"], "Karaoke on stage"),
  entry("lunch-and-learn", ["learning"], ["workshop", "lunch and learn", "training", "class"], "Workshop in a classroom"),
  entry("beach-cleanup", ["volunteering"], ["cleanup", "charity", "volunteer"], "Volunteers cleaning a beach"),
  illustration("theme-arts", "arts"),
  illustration("theme-music", "music"),
  illustration("theme-learning", "learning"),
  illustration("theme-volunteering", "volunteering"),
  illustration("theme-wellness", "wellness"),
];

const top = (title: string, extra: Record<string, unknown> = {}) => lexicalTop({ title, ...extra }, FIXTURE)?.entry.key ?? null;

describe("cover URL allow-list", () => {
  test("accepts the legacy defaults and library covers whose key is in the index", () => {
    for (const url of LEGACY_COVER_URLS) assert.equal(isApprovedCoverURL(url), true, url);
    assert.equal(isApprovedCoverURL("catalog://cover/theme-arts"), true, "a seed key");
    assert.equal(isApprovedCoverURL("catalog://cover/kayak-lake", FIXTURE), true);
    assert.equal(isApprovedCoverURL("catalog://cover/kayak-lake"), false, "not in the real index");
  });

  test("rejects unknown keys and malformed or foreign URLs", () => {
    for (const url of [
      "catalog://cover/does-not-exist", "catalog://cover/", "catalog://cover/Theme-Arts", "catalog://cover/theme_arts", "catalog://cover/-theme-arts",
      "catalog://cover/theme--arts", "catalog://cover/theme-arts/", "catalog://cover/../theme-arts", `catalog://cover/${"a".repeat(65)}`,
      "catalog://default/unknown", "catalog://default/", "catalog://theme/fitness", "https://letsdip.work/img/covers/theme-arts.webp", "", null, undefined, 7,
    ]) assert.equal(isApprovedCoverURL(url), false, String(url));
  });

  test("keys come from library and legacy URLs; unknown ones have no key", () => {
    assert.equal(parseCoverKey("catalog://cover/theme-arts"), "theme-arts");
    assert.equal(parseCoverKey("catalog://default/games"), null);
    assert.equal(coverKeyFromURL("catalog://default/games"), "default-games", "legacy URL resolves through the index");
    assert.equal(coverKeyFromURL("catalog://cover/theme-arts"), "theme-arts");
    assert.equal(coverKeyFromURL("catalog://cover/nope"), null);
    assert.equal(coverByKey("theme-arts")?.url, "catalog://cover/theme-arts");
  });

  test("tag ids map to themes in order, without duplicates", () => {
    assert.deepEqual(themesFromTagIds(["tag-cooking", "tag-food", "tag-hype", "tag-unknown", "tag-social", "tag-chill"]), ["food", "games", "wellness"]);
    assert.deepEqual(themesFromTagIds(undefined), []);
    assert.deepEqual(themesFromTagIds(["tag-outdoors", "tag-arts", "tag-music", "tag-learning", "tag-volunteering", "tag-fitness"]),
      ["outdoors", "arts", "music", "learning", "volunteering", "fitness"]);
  });

  test("createEventV1 and updateEventV1 validation (parseEventDraft) accepts a seed library cover and legacy covers, rejects unknown keys", () => {
    const draft = (coverImageURL: string) => ({
      title: "Pottery night", description: "Spin a bowl.", tagIds: ["tag-arts"], coverImageURL, startTime: "2026-11-10T22:00:00Z", endTime: "2026-11-10T23:30:00Z",
      venue: { name: "Studio", address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.44, longitude: -79.99 }, costCents: 0, costNote: "", capacity: 10, isOutdoor: false,
    });
    assert.equal(parseEventDraft(draft("catalog://cover/theme-arts")).coverImageURL, "catalog://cover/theme-arts");
    assert.equal(parseEventDraft(draft("catalog://default/games")).coverImageURL, "catalog://default/games");
    for (const url of ["catalog://cover/does-not-exist", "catalog://cover/Theme-Arts", "https://evil.example/x.jpg"]) {
      assert.throws(() => parseEventDraft(draft(url)), (e: unknown) => e instanceof OrganizerError && e.fields.includes("coverImageURL"), url);
    }
  });
});

describe("lexical shortlist", () => {
  test("stems lightly, drops stopwords and short tokens", () => {
    assert.equal(stem("kayaking"), "kayak");
    assert.equal(stem("games"), "game");
    assert.equal(stem("boxes"), "boxe", "es is dropped only when four letters remain; s then applies");
    assert.equal(stem("bus"), "bus");
    assert.equal(stem("hiking"), "hiking", "fewer than four letters would remain");
    assert.deepEqual(tokenize("Join the Sunset Kayaking trip!"), ["sunset", "kayak", "trip"]);
  });

  test("golden picks for each of the nine themes", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["Sunset kayak trip", { tagIds: ["tag-outdoors"] }, "kayak-lake"],
      ["Saturday trail hike", { tagIds: ["tag-outdoors"] }, "hike-ridge"],
      ["Morning yoga flow", { tagIds: ["tag-fitness"] }, "yoga-studio"],
      ["Potluck lunch", { tagIds: ["tag-food"] }, "default-cooking"],
      ["Coffee and brunch crawl", { tagIds: ["tag-food"] }, "coffee-cafe"],
      ["Pottery night", { tagIds: ["tag-arts"] }, "pottery-wheel"],
      ["Board games and trivia", { tagIds: ["tag-games"] }, "default-games"],
      ["Karaoke Friday", { tagIds: ["tag-music"] }, "karaoke-stage"],
      ["Lunch and learn: spreadsheet workshop", { tagIds: ["tag-learning"] }, "lunch-and-learn"],
      ["Beach cleanup day", { tagIds: ["tag-volunteering"] }, "beach-cleanup"],
      ["Wellness break", { theme: "wellness" }, "theme-wellness"],
    ];
    for (const [title, query, expected] of cases) assert.equal(top(title, query), expected, title);
    assert.equal(top("Pottery night"), "pottery-wheel", "tags alone are enough without a theme");
  });

  test("title words count double, description words count once", () => {
    assert.equal(top("Pottery", { description: "Bowling after" }), "pottery-wheel");
    assert.equal(top("Bowling", { description: "Pottery" }), "bowling-lane");
    assert.equal(top("Team outing", { description: "x ".repeat(400) + "pottery" }), null, "only the first 600 characters of the description count");
  });

  test("the result is deterministic: score descending, ties by key ascending", () => {
    const ranked = rankCovers({ title: "Quiet reset", theme: "wellness" }, FIXTURE);
    assert.deepEqual(ranked.map(item => item.entry.key), rankCovers({ title: "Quiet reset", theme: "wellness" }, [...FIXTURE].reverse()).map(item => item.entry.key));
    for (let i = 1; i < ranked.length; i++) {
      const [a, b] = [ranked[i - 1]!, ranked[i]!];
      assert.ok(a.score > b.score || (a.score === b.score && a.entry.key < b.entry.key));
    }
  });

  test("an illustration scores one lower than an equal photo", () => {
    const pair: CoverIndexEntry[] = [entry("a-photo", ["arts"], ["origami"], "Origami"), entry("b-art", ["arts"], ["origami"], "Origami", { kind: "illustration" })];
    const [first, second] = rankCovers({ title: "Origami" }, pair);
    assert.equal(first!.entry.key, "a-photo");
    assert.equal(first!.score - second!.score, 1);
  });

  test("excluded covers are scored down by four, which steers equal matches but not a much stronger one", () => {
    const twins: CoverIndexEntry[] = [
      entry("a-origami", ["arts"], ["origami"], "Origami", { url: "catalog://default/games" }),
      entry("b-origami", ["arts"], ["origami"], "Origami"),
    ];
    const pick = (exclude: string[]) => lexicalTop({ title: "Origami", exclude }, twins)?.entry.key;
    assert.equal(pick([]), "a-origami");
    assert.equal(pick(["catalog://cover/a-origami"]), "b-origami");
    assert.equal(pick(["a-origami"]), "b-origami", "keys work as well as URLs");
    assert.equal(pick(["catalog://default/games"]), "b-origami", "a legacy URL excludes its index entry");
    assert.equal(pick(["catalog://cover/not-in-index", "junk"]), "a-origami", "unknown exclusions are ignored");
    const query = { title: "Sunset kayak trip", tagIds: ["tag-outdoors"] };
    const plain = rankCovers(query, FIXTURE).find(item => item.entry.key === "kayak-lake")!.score;
    const excluded = rankCovers({ ...query, exclude: ["kayak-lake"] }, FIXTURE).find(item => item.entry.key === "kayak-lake")!.score;
    assert.equal(plain - excluded, 4);
  });

  test("nothing matching the words means no pick, even when a theme matches", () => {
    assert.equal(top("Zzzz qqqq"), null);
    assert.equal(top("Zzzz qqqq", { theme: "music" }), null, "a theme alone is not a text match");
    assert.ok(rankCovers({ title: "Zzzz qqqq", theme: "music" }, FIXTURE)[0]!.score > 0, "it still ranks the theme's covers first");
  });

  test("the shortlist has the requested size and always includes the theme default", () => {
    const query = { title: "Karaoke Friday", theme: "outdoors" as const };
    const list = shortlist(query, FIXTURE, 5);
    assert.equal(list.length, 5);
    assert.equal(list[0]!.entry.key, "karaoke-stage");
    assert.ok(list.some(item => item.entry.key === "default-outdoors"), "the theme default is forced in");
    assert.equal(shortlist(query, FIXTURE).length, FIXTURE.length, "a bigger size returns everything once");
    assert.equal(shortlist({ title: "Pottery night" }).length, Math.min(COVER_INDEX.filter(isEligible).length, DEFAULT_MAX_CANDIDATES), "the real index: everything up to the candidate limit");
    assert.ok(shortlist({ title: "x" }, FIXTURE, 20).length <= 20);
  });

  test("the cover question lists the shortlist keys with label, tags and themes", () => {
    const list = shortlist({ title: "Sunset kayak trip", tagIds: ["tag-outdoors"] }, FIXTURE, 4);
    const question = coverQuestion(list);
    assert.equal(question.type, "choice");
    assert.deepEqual(Object.keys(question.criteria), list.map(item => item.entry.key));
    assert.equal(question.criteria["kayak-lake"], "outdoors | kayaking, paddling, lake, canoe | Kayaking on a lake");
    const long = coverQuestion([{ entry: entry("long", ["arts", "learning"], ["a", "b", "c", "d", "e", "f", "g"], "L", { alt: "x".repeat(100) }), score: 0, matched: false }]);
    assert.equal(long.criteria.long, `arts/learning | a, b, c, d, e, f | ${"x".repeat(59)}…`, "six tags and an alt of about 60 characters");
  });
});

describe("chosenCoverKey", () => {
  const keys = ["a-one", "b-two", "c-three"];
  test("zod-typed: wrong type, off-list key and weak answers are ignored", () => {
    assert.equal(chosenCoverKey(choiceAnswer("b-two", 0.8), keys, 0.6, true), "b-two");
    assert.equal(chosenCoverKey(choiceAnswer("zzz", 0.99), keys, 0.6, false), null, "outside the shortlist");
    assert.equal(chosenCoverKey({ type: "noul", noul: 0.9 }, keys, 0.6, false), null);
    assert.equal(chosenCoverKey(undefined, keys, 0.6, false), null);
    assert.equal(chosenCoverKey(choiceAnswer("b-two", 0.8), [], 0.6, false), null);
    assert.equal(chosenCoverKey(choiceAnswer("b-two", 0.2), keys, 0.6, false), null, "too low");
  });
  test("a vague argmax answer is accepted only when the lexical match has no clear winner", () => {
    const vague = { type: "choice" as const, choice: "b-two", probabilities: { "a-one": 0.3, "b-two": 0.45, "c-three": 0.25 }, confidence: 0.45 };
    assert.equal(chosenCoverKey(vague, keys, 0.6, false), "b-two");
    assert.equal(chosenCoverKey(vague, keys, 0.6, true), null);
    assert.equal(chosenCoverKey({ ...vague, probabilities: { "a-one": 0.5, "b-two": 0.45 } }, keys, 0.6, false), null, "not the argmax");
  });
});

const jev = (answer: ReturnType<typeof choiceAnswer>): DecisionStepScript => (req: DecisionRequest) => decision(req, { cover: answer });
const asProvider = (provider: DecisionResult["provider"], answer: ReturnType<typeof choiceAnswer>): DecisionStepScript =>
  (req: DecisionRequest) => ({ ...decision(req, { cover: answer }), provider, model: `${provider}-model` });
const base = (decisions: ScriptedDecisions, extra: Partial<PickCoverDeps> = {}) => ({ decisions, aiEnabled: true, index: FIXTURE, ...extra });
const KAYAK = { title: "Sunset kayak trip", tagIds: ["tag-outdoors"] };

describe("pickCover", () => {
  test("a confident Jev choice on the shortlist is taken (source dipbot, provider jev)", async () => {
    const decisions = new ScriptedDecisions([jev(choiceAnswer("hike-ridge", 0.85))]);
    const result = await pickCover(base(decisions), KAYAK);
    assert.equal(result.coverImageURL, "catalog://cover/hike-ridge");
    assert.equal(result.source, "dipbot");
    assert.equal(result.provider, "jev");
    assert.equal(decisions.calls.length, 1);
    const call = decisions.calls[0]!;
    assert.equal(call.step, "coverPick");
    assert.deepEqual(Object.keys(call.questions), ["cover"]);
    assert.deepEqual(Object.keys((call.questions.cover as { criteria: object }).criteria), shortlist(KAYAK, FIXTURE).map(item => item.entry.key));
    assert.ok(call.state.includes("Sunset kayak trip") && call.state.includes("<event>"), "event data is passed as a data block");
    assert.ok(!result.alternatives.includes("catalog://cover/hike-ridge") && result.alternatives.length <= 4);
  });

  test("low confidence falls back to the lexical top, and the answering provider is still reported", async () => {
    const decisions = new ScriptedDecisions([jev(choiceAnswer("hike-ridge", 0.2))]);
    const result = await pickCover(base(decisions), KAYAK);
    assert.equal(result.coverImageURL, "catalog://cover/kayak-lake");
    assert.equal(result.source, "match");
    assert.equal(result.provider, "jev");
  });

  test("a Jev answer outside the shortlist is rejected", async () => {
    const result = await pickCover(base(new ScriptedDecisions([jev(choiceAnswer("theme-arts-not-listed", 0.99))])), KAYAK);
    assert.equal(result.coverImageURL, "catalog://cover/kayak-lake");
    assert.equal(result.source, "match");
  });

  test("an unavailable provider falls back to the lexical match with no provider", async () => {
    const result = await pickCover(base(new ScriptedDecisions([new LlmUnavailableError(503)])), KAYAK);
    assert.deepEqual([result.coverImageURL, result.source, result.provider], ["catalog://cover/kayak-lake", "match", null]);
  });

  test("the heuristic provider is reported as a match, never as Dipbot's choice", async () => {
    const result = await pickCover(base(new ScriptedDecisions([asProvider("heuristic", choiceAnswer("hike-ridge", 0.99))])), KAYAK);
    assert.deepEqual([result.coverImageURL, result.source, result.provider], ["catalog://cover/kayak-lake", "match", "heuristic"]);
  });

  test("the OpenAI fallback's choice counts as Dipbot's choice and is recorded", async () => {
    const result = await pickCover(base(new ScriptedDecisions([asProvider("openai", choiceAnswer("yoga-studio", 0.9))])), KAYAK);
    assert.deepEqual([result.coverImageURL, result.source, result.provider], ["catalog://cover/yoga-studio", "dipbot", "openai"]);
  });

  test("nothing matches and no model: the theme default, else the neutral default", async () => {
    const down = () => new ScriptedDecisions([new LlmUnavailableError(null)]);
    const themed = await pickCover(base(down()), { title: "Zzzz qqqq", theme: "music" });
    assert.deepEqual([themed.coverImageURL, themed.source, themed.provider], ["catalog://cover/theme-music", "default", null]);
    const neutral = await pickCover(base(down()), { title: "Zzzz qqqq" });
    assert.deepEqual([neutral.coverImageURL, neutral.source], [DEFAULT_COVER_URL, "default"]);
  });

  test("nothing matches but Jev is confident: the choice still wins", async () => {
    const result = await pickCover(base(new ScriptedDecisions([jev(choiceAnswer("bowling-lane", 0.9))])), { title: "Zzzz qqqq" });
    assert.deepEqual([result.coverImageURL, result.source], ["catalog://cover/bowling-lane", "dipbot"]);
  });

  test("the model is not called when AI is off", async () => {
    const decisions = new ScriptedDecisions();
    const result = await pickCover(base(decisions, { aiEnabled: false }), KAYAK);
    assert.deepEqual([result.coverImageURL, result.source, result.provider, decisions.calls.length], ["catalog://cover/kayak-lake", "match", null, 0]);
  });

  test("alternatives skip the chosen cover and covers already used", async () => {
    const result = await pickCover(base(new ScriptedDecisions([new Error("down")])), { ...KAYAK, exclude: ["catalog://cover/default-outdoors"] });
    assert.ok(result.alternatives.length >= 1 && result.alternatives.length <= 4);
    assert.ok(!result.alternatives.includes(result.coverImageURL) && !result.alternatives.includes("catalog://default/outdoors"));
  });

  test("excluded covers steer the pick away from earlier drafts' covers", async () => {
    const twins = [entry("a-origami", ["arts"], ["origami"], "Origami"), entry("b-origami", ["arts"], ["origami"], "Origami")];
    const deps = base(new ScriptedDecisions([new Error("down")]), { index: twins });
    assert.equal((await pickCover(deps, { title: "Origami", exclude: ["catalog://cover/a-origami"] })).coverImageURL, "catalog://cover/b-origami");
  });
});

const ART_QUERY = { title: "Paint and sip evening" };
/** Semantically right for painting, with zero word overlap; a decoy matches only "evening". Both sort after the fixture's keys. */
const CANVAS = entry("zz-canvas-easel", ["arts"], ["canvas", "easel"], "Studio corner", { alt: "Blank canvases on easels by a window" });
const DECOY = entry("zz-evening-run", ["fitness"], ["evening"], "Evening jog", { alt: "A runner at dusk" });
const BIG: readonly CoverIndexEntry[] = [...FIXTURE, CANVAS, DECOY];
const names = (call: DecisionRequest) => Object.keys((call.questions.cover as { criteria: object }).criteria);

describe("pickCover: no eager narrowing", () => {
  test("a semantically right cover with zero lexical overlap still reaches Jev and is taken", async () => {
    assert.ok(!tokenize("Paint and sip evening").some(word => tokenize("canvas easel studio corner blank canvases on easels by a window").includes(word)));
    assert.equal(lexicalTop(ART_QUERY, BIG)?.entry.key, "zz-evening-run", "the lexical decoy wins on text");
    const decisions = new ScriptedDecisions([jev(choiceAnswer("zz-canvas-easel", 0.9))]);
    const result = await pickCover(base(decisions, { index: BIG }), ART_QUERY);
    assert.deepEqual(names(decisions.calls[0]!).sort(), BIG.map(e => e.key).sort(), "every eligible cover is offered");
    assert.deepEqual([result.coverImageURL, result.source, result.provider], ["catalog://cover/zz-canvas-easel", "dipbot", "jev"]);
    assert.equal(result.shortlistSize, BIG.length);
    assert.ok(result.lexicalRank! > 5 && result.pickedOutsideTopLexical, `rank ${result.lexicalRank}`);
    assert.equal(decisions.calls.length, 1);
  });

  test("a pick within the top five lexical ranks is not flagged as outside", async () => {
    const query = { title: "Pottery night", tagIds: ["tag-arts"] };
    const result = await pickCover(base(new ScriptedDecisions([jev(choiceAnswer("pottery-wheel", 0.9))]), { index: BIG }), query);
    assert.deepEqual([result.source, result.lexicalRank, result.pickedOutsideTopLexical], ["dipbot", lexicalRank(query, "pottery-wheel", BIG), false]);
    assert.equal(result.lexicalRank, 1);
  });

  test("autoPick:false and non-landscape covers are never offered or picked", async () => {
    const hidden = entry("hidden-art", ["arts"], ["paint", "sip", "evening"], "Paint and sip evening", { autoPick: false });
    const tall = entry("tall-art", ["arts"], ["paint", "sip", "evening"], "Paint and sip evening", { orientation: "portrait" } as Partial<CoverIndexEntry>);
    const index = [...BIG, hidden, tall];
    assert.deepEqual([isEligible(hidden), isEligible(tall), isEligible(CANVAS)], [false, false, true]);
    const decisions = new ScriptedDecisions([new LlmUnavailableError(null), jev(choiceAnswer("hidden-art", 0.99))]);
    const down = await pickCover(base(decisions, { index }), ART_QUERY);
    assert.ok(!["hidden-art", "tall-art"].some(key => down.coverImageURL.endsWith(key)), "text match skips them");
    const asked = await pickCover(base(decisions, { index }), ART_QUERY);
    assert.ok(!names(decisions.calls[1]!).some(key => key === "hidden-art" || key === "tall-art"));
    assert.ok(!asked.coverImageURL.endsWith("hidden-art"), "an answer naming a hidden cover is rejected");
    assert.ok(![...shortlist(ART_QUERY, index), ...rankCovers(ART_QUERY, index)].some(item => item.entry.key === "hidden-art"));
  });

  test("more eligible covers than maxCandidates: head, diverse picks per theme and a tail, within the limit", () => {
    const list = shortlist(ART_QUERY, BIG, 12);
    assert.equal(list.length, 12);
    const ranked = rankCovers(ART_QUERY, BIG);
    const head = ranked.slice(0, 6);
    assert.deepEqual(list.slice(0, 6).map(i => i.entry.key), head.map(i => i.entry.key), "the top portion by rank");
    const themesOf = (items: readonly { entry: CoverIndexEntry }[]) => new Set(items.flatMap(i => i.entry.themes));
    assert.ok(themesOf(list).size > themesOf(head).size, "diverse picks add themes the top portion lacks");
    assert.equal(new Set(list.map(i => i.entry.key)).size, 12);
  });

  test("more options than maxOptionsPerCall use two Choice calls (theme group, then cover) and drop no candidate", async () => {
    const limits = { maxCandidates: 100, maxOptionsPerCall: 4 };
    const eligible = BIG.filter(isEligible).map(e => e.key).sort();
    const groups = themeGroups(shortlist(ART_QUERY, BIG, 100), 4);
    assert.deepEqual([...groups.values()].flat().map(i => i.entry.key).sort(), eligible, "the union of the groups is the eligible set");
    assert.ok([...groups.values()].every(items => items.length <= 4));

    const decisions = new ScriptedDecisions([
      (req: DecisionRequest) => decision(req, { cover: choiceAnswer("arts", 0.9) }),
      (req: DecisionRequest) => decision(req, { cover: choiceAnswer("zz-canvas-easel", 0.9) }),
    ]);
    const result = await pickCover(base(decisions, { index: BIG, limits }), ART_QUERY);
    assert.equal(decisions.calls.length, 2);
    assert.deepEqual(names(decisions.calls[0]!), [...groups.keys()]);
    assert.deepEqual(names(decisions.calls[1]!), groups.get("arts")!.map(i => i.entry.key));
    assert.deepEqual([result.coverImageURL, result.source, result.shortlistSize], ["catalog://cover/zz-canvas-easel", "dipbot", BIG.length]);
  });

  test("two-call path: a weak group answer falls back to the lexical top's group; heuristic answers stay lexical", async () => {
    const limits = { maxCandidates: 100, maxOptionsPerCall: 4 };
    const weak = new ScriptedDecisions([(req: DecisionRequest) => decision(req, { cover: choiceAnswer("music", 0.2) }), new LlmUnavailableError(null)]);
    const result = await pickCover(base(weak, { index: BIG, limits }), ART_QUERY);
    assert.equal(weak.calls.length, 2);
    assert.ok(names(weak.calls[1]!).includes("zz-evening-run"), "the lexical top's group was offered");
    assert.equal(result.source, "match");
    const heuristic = new ScriptedDecisions([asProvider("heuristic", choiceAnswer("music", 0.99))]);
    const h = await pickCover(base(heuristic, { index: BIG, limits }), ART_QUERY);
    assert.deepEqual([heuristic.calls.length, h.source, h.provider], [1, "match", "heuristic"]);
  });

  test("a single draftCheck call is narrowed to the draft's theme only beyond the per-call limit", () => {
    const all = shortlist(ART_QUERY, BIG, 100);
    assert.equal(optionsForSingleCall(all, ART_QUERY, 100).length, all.length, "within the limit: untouched");
    const narrowed = optionsForSingleCall(all, ART_QUERY, 3);
    assert.equal(narrowed.length, 3);
    const arts = { title: "Paint and sip evening", tagIds: ["tag-arts"] };
    const artsNarrowed = optionsForSingleCall(shortlist(arts, BIG, 100), arts, 3);
    assert.ok(artsNarrowed.every(item => item.entry.themes.includes("arts")), "the draft's own theme group first");
  });
});

describe("pickEventCoverV1", () => {
  const body = (n: number, extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", requestId: uuid(n), title: "Sunset kayak trip", tagIds: ["tag-outdoors"], ...extra });

  function rig(script: DecisionStepScript[] = [jev(choiceAnswer("hike-ridge", 0.9))], extra: Partial<PickCoverDeps> = {}) {
    const store = new FakeAdminStore();
    seedCompany(store);
    const decisions = new ScriptedDecisions(script);
    const consumed: string[] = [];
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const deps: PickCoverDeps = {
      store, decisions, aiEnabled: true, index: FIXTURE, now: () => new Date("2030-01-02T10:00:00Z"),
      limiter: { consume: async uid => { consumed.push(uid); } }, log: (event, fields) => logs.push({ event, fields }), ...extra,
    };
    return { store, decisions, deps, consumed, logs };
  }

  async function fails(promise: Promise<unknown>, reason: string) {
    await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.reason, reason); return true; });
  }

  test("an admin gets the pick, and the provider is stored on a content-free request document", async () => {
    const r = rig();
    const response = await pickEventCover(r.deps, caller("admin1"), body(1, { description: "Private details about the team" }));
    assert.equal(response.contractVersion, 1);
    assert.deepEqual([response.coverImageURL, response.source, response.provider], ["catalog://cover/hike-ridge", "dipbot", "jev"]);
    assert.ok(response.alternatives.length <= 4);
    const record = await r.store.getDoc(`companies/alpha/aiCoverPicks/admin1_${uuid(1)}`);
    assert.equal(record?.provider, "jev");
    assert.equal(record?.source, "dipbot");
    assert.equal(record?.coverKey, "hike-ridge");
    assert.equal(record?.uid, "admin1");
    assert.deepEqual([record?.shortlistSize, typeof record?.lexicalRank, record?.pickedOutsideTopLexical], [FIXTURE.length, "number", false]);
    assert.deepEqual([r.logs[0]?.fields.shortlistSize, r.logs[0]?.fields.pickedOutsideTopLexical], [FIXTURE.length, false]);
    assert.ok(record?.expireAt instanceof Date);
    assert.ok(!JSON.stringify(record).includes("kayak") && !JSON.stringify(record).includes("Private"), "no event text is stored");
    assert.deepEqual(r.consumed, ["admin1"]);
    assert.equal(r.logs[0]?.event, "ai.coverPick");
    assert.equal(r.logs[0]?.fields.provider, "jev");
    assert.ok(!JSON.stringify(r.logs).includes("kayak"));
  });

  test("a provider outage still answers and records a null provider", async () => {
    const r = rig([new LlmUnavailableError(null)]);
    const response = await pickEventCover(r.deps, caller("admin1"), body(2));
    assert.deepEqual([response.coverImageURL, response.source, response.provider], ["catalog://cover/kayak-lake", "match", null]);
    assert.equal((await r.store.getDoc(`companies/alpha/aiCoverPicks/admin1_${uuid(2)}`))?.provider, null);
  });

  test("auth: signed out, wrong sign-in, plain member, organizer, another company and deactivated callers are refused before the limiter, the credits or the model", async () => {
    const r = rig();
    await fails(pickEventCover(r.deps, null, body(1)), "UNAUTHENTICATED");
    await fails(pickEventCover(r.deps, caller("admin1", { emailVerified: false }), body(1)), "EMAIL_NOT_VERIFIED");
    await fails(pickEventCover(r.deps, caller("admin1", { signInProvider: "password" }), body(1)), "PROVIDER_NOT_ALLOWED");
    await fails(pickEventCover(r.deps, caller("m1"), body(1)), "INSUFFICIENT_ROLE");
    await fails(pickEventCover(r.deps, caller("org1"), body(1)), "INSUFFICIENT_ROLE");
    await fails(pickEventCover(r.deps, caller("bo"), body(1)), "COMPANY_MISMATCH");
    await fails(pickEventCover(r.deps, caller("nobody"), body(1)), "MEMBERSHIP_CONFLICT");
    assert.deepEqual([r.consumed, r.decisions.calls.length, r.store.children("companies/alpha/aiCoverPicks").length, usedCredits(r.store)], [[], 0, 0, 0]);
  });

  test("validation: strict fields and bounds", async () => {
    const r = rig();
    const bad: Array<Record<string, unknown>> = [
      { title: "" }, { title: "   " }, { title: "x".repeat(121) }, { description: "x".repeat(5001) }, { tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { tagIds: ["a", "a"] }, { theme: "sports" }, { excludeCoverImageURLs: Array(11).fill("catalog://default/games") }, { excludeCoverImageURLs: ["https://x.test/a.jpg"] },
      { extra: 1 }, { requestId: "nope" }, { companyId: "" }, { contractVersion: 2 },
    ];
    for (const extra of bad) await fails(pickEventCover(r.deps, caller("admin1"), body(1, extra)), "VALIDATION_FAILED");
    assert.equal(r.decisions.calls.length, 0);
    assert.deepEqual(r.consumed, []);
  });

  test("the burst limiter is consumed once after authorization, and a limiter refusal stops the pick", async () => {
    const r = rig(undefined, { limiter: { consume: async () => { throw new AdminError("resource-exhausted", "RATE_LIMITED", "Slow down."); } } });
    await fails(pickEventCover(r.deps, caller("admin1"), body(1)), "RATE_LIMITED");
    assert.equal(r.decisions.calls.length, 0);
  });

  const CREDITS = "companies/alpha/aiCredits/203001";
  const usedCredits = (store: FakeAdminStore) => Number(store.get(CREDITS)?.used ?? 0);

  test("credits: a Dipbot pick is charged 1 credit once, after the limiter; a repeated requestId is not charged twice", async () => {
    const order: string[] = [];
    const r = rig([jev(choiceAnswer("hike-ridge", 0.9)), jev(choiceAnswer("hike-ridge", 0.9))], { limiter: { consume: async () => { order.push("limiter"); } } });
    const response = await pickEventCover(r.deps, caller("admin1"), body(1));
    assert.deepEqual([response.source, response.provider, usedCredits(r.store), CREDIT_COSTS.coverPick], ["dipbot", "jev", 1, 1]);
    assert.deepEqual(order, ["limiter"]);
    await pickEventCover(r.deps, caller("admin1"), body(1));
    assert.equal(usedCredits(r.store), 1, "same requestId: not charged again");
    await pickEventCover(r.deps, caller("admin1"), body(2));
    assert.equal(usedCredits(r.store), 2, "a new requestId is a new charge");
  });

  test("credits: refunded when no model answered (outage, heuristic provider, AI off) so admins pay only for Dipbot's choice", async () => {
    const outage = rig([new LlmUnavailableError(null)]);
    assert.equal((await pickEventCover(outage.deps, caller("admin1"), body(1))).provider, null);
    assert.equal(usedCredits(outage.store), 0);
    assert.deepEqual(outage.store.get(CREDITS)?.charges, {});
    const heuristic = rig([asProvider("heuristic", choiceAnswer("hike-ridge", 0.99))]);
    assert.equal((await pickEventCover(heuristic.deps, caller("admin1"), body(1))).provider, "heuristic");
    assert.equal(usedCredits(heuristic.store), 0);
    const off = rig(undefined, { aiEnabled: false });
    assert.equal((await pickEventCover(off.deps, caller("admin1"), body(1))).provider, null);
    assert.deepEqual([usedCredits(off.store), off.decisions.calls.length], [0, 0]);
  });

  test("credits: a model answer that falls back to the text match still counts as Dipbot answering", async () => {
    const r = rig([jev(choiceAnswer("hike-ridge", 0.1))]);
    const response = await pickEventCover(r.deps, caller("admin1"), body(1));
    assert.equal(response.source, "match");
    assert.equal(response.provider, "jev");
    assert.equal(usedCredits(r.store), 1);
  });

  test("credits: out of credits fails with AI_CREDITS_EXHAUSTED before any model call and records nothing", async () => {
    const r = rig();
    r.store.seed("companies/alpha/aiSettings/current", { enabled: true, monthlyCredits: 0 });
    await fails(pickEventCover(r.deps, caller("admin1"), body(1)), "AI_CREDITS_EXHAUSTED");
    assert.deepEqual([r.decisions.calls.length, r.store.children("companies/alpha/aiCoverPicks").length, usedCredits(r.store)], [0, 0, 0]);
    // AI off never needs credits: the free text match still answers.
    const off = rig(undefined, { aiEnabled: false });
    off.store.seed("companies/alpha/aiSettings/current", { enabled: true, monthlyCredits: 0 });
    assert.equal((await pickEventCover(off.deps, caller("admin1"), body(1))).source, "match");
  });

  test("excludeCoverImageURLs steers the answer and a failed request-document write does not fail the pick", async () => {
    const twins = [entry("a-origami", ["arts"], ["origami"], "Origami"), entry("b-origami", ["arts"], ["origami"], "Origami")];
    const r = rig([new LlmUnavailableError(null)], { index: twins });
    r.store.setDoc = async () => { throw new Error("write failed"); };
    const response = await pickEventCover(r.deps, caller("admin1"), body(1, { title: "Origami", tagIds: [], excludeCoverImageURLs: ["catalog://cover/a-origami"] }));
    assert.equal(response.coverImageURL, "catalog://cover/b-origami");
    assert.ok(r.logs.some(log => log.event === "ai.cover_pick_record_failed"));
  });
});

describe("hosted JPEGs for the share page and emails", () => {
  test("share page: a library cover maps to its JPEG; unknown or malformed keys use the default", () => {
    assert.deepEqual(resolveImage("catalog://cover/theme-arts"), { url: `${SHARE_ORIGIN}/img/covers/jpg/theme-arts.jpg`, standard: false });
    for (const url of ["catalog://cover/does-not-exist", "catalog://cover/", "catalog://cover/../x", "catalog://cover/Theme-Arts"]) {
      assert.deepEqual(resolveImage(url), { url: `${SHARE_ORIGIN}/share/og/default.jpg`, standard: true }, url);
    }
    assert.equal(resolveImage("catalog://default/games").url, `${SHARE_ORIGIN}/share/og/games.jpg`, "legacy mapping unchanged");
  });

  test("share page: a library cover is not advertised with the fixed 1200x630 size", () => {
    const event = { title: "Pottery night", description: "Spin a bowl.", startTime: new Date("2026-11-20T18:00:00Z"), coverImageURL: "catalog://cover/theme-arts", status: "scheduled" as const };
    const html = renderSharePage(buildPreview("evt_1", event));
    assert.ok(html.includes(`${SHARE_ORIGIN}/img/covers/jpg/theme-arts.jpg`));
    assert.ok(!html.includes('og:image:width'));
  });

  test("email: coverJpegURL maps library covers to the JPEG and ignores legacy and unknown ones", () => {
    assert.equal(coverJpegURL(SHARE_ORIGIN, "catalog://cover/theme-arts"), `${SHARE_ORIGIN}/img/covers/jpg/theme-arts.jpg`);
    assert.equal(coverJpegURL(SHARE_ORIGIN, "catalog://cover/nope"), null);
    assert.equal(coverJpegURL(SHARE_ORIGIN, "catalog://default/games"), null, "legacy covers keep their own mapping");
    assert.equal(coverJpegURL(SHARE_ORIGIN, "catalog://cover/no-jpeg", [entry("no-jpeg", ["arts"], ["x"], "x", { hasJpeg: false })]), null);
  });
});

describe("the real library at 150 to 200 covers", () => {
  const eligible = COVER_INDEX.filter(isEligible);
  const themes = ["outdoors", "food", "arts", "games", "music", "learning", "volunteering", "wellness", "fitness"];

  test("every index key is approved, legacy URLs stay valid and a second key source can be added", async () => {
    assert.ok(COVER_INDEX.length >= 150 && COVER_INDEX.length <= 200, `${COVER_INDEX.length} covers`);
    assert.equal(new Set(COVER_INDEX.map(c => c.key)).size, COVER_INDEX.length);
    for (const c of COVER_INDEX) assert.equal(isApprovedCoverURL(`catalog://cover/${c.key}`), true, c.key);
    for (const url of LEGACY_COVER_URLS) assert.equal(isApprovedCoverURL(url), true, url);
    const sources = [indexKeySource(), { has: (key: string) => key === "dynamic-cover-1" }];
    assert.equal(await isApprovedCoverURLFrom("catalog://cover/dynamic-cover-1", sources), true);
    assert.equal(await isApprovedCoverURLFrom("catalog://cover/dynamic-cover-1", [indexKeySource()]), false);
    assert.equal(await isApprovedCoverURLFrom(`catalog://cover/${COVER_INDEX[0]!.key}`, sources), true);
    assert.equal(await isApprovedCoverURLFrom("catalog://default/games", []), true);
    assert.equal(await isApprovedCoverURLFrom("catalog://cover/Not_A_Key", sources), false);
  });

  test("the five original photos stay eligible for Dipbot", () => {
    for (const key of ["default-cooking", "default-fitness", "default-games", "default-hiking", "default-outdoors"]) {
      assert.equal(isEligible(coverByKey(key)!), true, key);
    }
  });

  test("each theme has at least 12 covers and a theme default that lists the theme", () => {
    for (const theme of themes) {
      assert.ok(COVER_INDEX.filter(c => c.themes.includes(theme)).length >= 12, theme);
      assert.ok(shortlist({ title: "Zzzz qqqq", theme: theme as never }).some(i => i.entry.themes.includes(theme)), theme);
    }
  });

  test("the default shortlist is capped at maxCandidates and one call carries at most maxOptionsPerCall real options", async () => {
    assert.ok(eligible.length > DEFAULT_MAX_CANDIDATES, "the library is larger than the candidate budget");
    const query = { title: "Sunrise yoga in the park", tagIds: ["tag-wellness"] };
    const list = shortlist(query);
    assert.equal(list.length, DEFAULT_MAX_CANDIDATES);
    assert.ok(list.some(i => i.entry.key.startsWith("yoga-")), "a yoga cover reaches the model");
    const decisions = new ScriptedDecisions([(req: DecisionRequest) => decision(req, { cover: choiceAnswer(names(req).find(k => k.startsWith("yoga-")) ?? names(req)[0]!, 0.9) })]);
    const result = await pickCover(base(decisions, { index: COVER_INDEX }), query);
    assert.equal(decisions.calls.length, 1);
    assert.equal(names(decisions.calls[0]!).length, DEFAULT_MAX_CANDIDATES);
    assert.deepEqual([result.source, result.provider], ["dipbot", "jev"]);
    assert.equal(isApprovedCoverURL(result.coverImageURL), true);
  });

  test("with the real index above maxOptionsPerCall the pick splits into a theme call, then a cover call", async () => {
    const limits = { maxCandidates: 120, maxOptionsPerCall: 40 };
    const query = { title: "Pottery and painting night", tagIds: ["tag-arts"] };
    const decisions = new ScriptedDecisions([
      (req: DecisionRequest) => decision(req, { cover: choiceAnswer(names(req).includes("arts") ? "arts" : names(req)[0]!, 0.9) }),
      (req: DecisionRequest) => decision(req, { cover: choiceAnswer(names(req)[0]!, 0.9) }),
    ]);
    const result = await pickCover(base(decisions, { index: COVER_INDEX, limits }), query);
    assert.equal(decisions.calls.length, 2);
    assert.ok(names(decisions.calls[0]!).every(n => themes.includes(n)), "the first call offers theme groups");
    assert.ok(names(decisions.calls[1]!).length <= 40);
    assert.ok(names(decisions.calls[1]!).every(k => coverByKey(k)?.themes.includes("arts") || coverByKey(k)), "the second call offers real cover keys");
    assert.equal(result.source, "dipbot");
    assert.equal(isApprovedCoverURL(result.coverImageURL), true);
    assert.ok(result.shortlistSize! >= 100);
  });

  test("lexical top for typical event titles lands on a matching real cover", () => {
    const cases: Array<[string, string]> = [
      ["Sunrise yoga session", "yoga"], ["Clay pottery workshop", "pottery"], ["Karaoke Friday", "karaoke"], ["Hands-on coding workshop", "cod"],
      ["Beach volleyball", "volleyball"], ["Pizza dough workshop", "pizza"],
    ];
    for (const [title, word] of cases) {
      const hit = lexicalTop({ title })!.entry;
      assert.ok(`${hit.key} ${hit.tags.join(" ")} ${hit.label}`.toLowerCase().includes(word), `${title} -> ${hit.key}`);
    }
  });
});
