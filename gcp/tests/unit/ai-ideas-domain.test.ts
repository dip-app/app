import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { DecisionAnswer } from "../../functions/src/modules/ai/application/ports";
import { GeneratedEventDraftSchema, cleanText } from "../../functions/src/modules/ai/domain/drafts";
import {
  IDEA_ALGORITHM_VERSION, capToolOutput, ideaFingerprint, ideaSnapshot, ideaToolDefinitions, runIdeaTool,
} from "../../functions/src/modules/ai/domain/ideaTools";
import { IDEA_LIMITS, type IdeaSnapshot, type ModelIdea, type ToolTrace } from "../../functions/src/modules/ai/domain/ideaTypes";
import {
  applyRanking, buildIdeas, fallbackIdeas, fitWhy, groundedNumbers, interestClaimsHold, isGrounded, parseModelIdeas, rankingRequest, zonedInstant,
} from "../../functions/src/modules/ai/domain/ideaValidate";
import { localParts, type CompanySignals, type PastEvent } from "../../functions/src/modules/suggestions/domain/signals";

const DAY = 86_400_000;
const NOW = new Date("2026-11-17T15:00:00Z"); // Tuesday
const TZ = "America/New_York";
const CATALOG_TAGS = [
  ["tag-fitness", "Fitness"], ["tag-energetic", "Energetic"], ["tag-hype", "Hype"], ["tag-outdoors", "Outdoors"], ["tag-social", "Social"],
  ["tag-cooking", "Cooking"], ["tag-games", "Games"], ["tag-chill", "Chill"], ["tag-food", "Food & Drink"], ["tag-arts", "Arts & Crafts"],
  ["tag-music", "Music"], ["tag-learning", "Learning"], ["tag-volunteering", "Volunteering"], ["tag-wellness", "Wellness"],
].map(([id, name]) => ({ id: id!, name: name! }));

function past(title: string, tagIds: string[], daysAgo: number, capacity: number, attendeeCount: number, extra: Partial<PastEvent> = {}): PastEvent {
  const start = new Date(NOW.getTime() - daysAgo * DAY);
  return { title, tagIds, start, end: new Date(start.getTime() + 3_600_000), capacity, attendeeCount, status: "published", isOutdoor: false, costCents: 0, ...extra };
}

function signals(extra: Partial<CompanySignals> = {}): CompanySignals {
  return {
    now: NOW, timeZone: TZ, memberCount: 40, pastEvents: [], upcomingEvents: [], interests: null, interestsMonthAgo: null,
    weeklyThemes: [], recentlySuggested: [], tagNames: Object.fromEntries(CATALOG_TAGS.map(t => [t.id, t.name])), ...extra,
  };
}

/** A company with history: an email in a title, a 3-member interest (under the floor) and a 12-member one. */
function richSignals(music = 12): CompanySignals {
  return signals({
    pastEvents: [
      past("Pizza with bob@example.com", ["tag-food"], 20, 20, 18),
      past("Trivia night", ["tag-games"], 10, 30, 12),
      past("Lunch walk", ["tag-fitness", "tag-outdoors"], 60, 20, 6),
      past("Craft evening", ["tag-arts"], 90, 12, 10),
    ],
    interests: [{ tagId: "tag-games", memberCount: 3 }, { tagId: "tag-music", memberCount: music }, { tagId: "tag-food", memberCount: 25 }],
    interestsMonthAgo: [{ tagId: "tag-music", memberCount: 8 }, { tagId: "tag-food", memberCount: 22 }],
  });
}

const rich = () => ideaSnapshot(richSignals(), CATALOG_TAGS);
const empty = () => ideaSnapshot(signals(), CATALOG_TAGS);

function modelIdea(extra: Partial<ModelIdea> = {}): ModelIdea {
  return {
    title: "Pasta making workshop", description: "Roll and cut fresh pasta together, then share a long lunch table.", theme: "food",
    tagIds: ["tag-food", "tag-cooking"], goal: "team_bonding", weekday: 3, daypart: "weekday_lunch", durationMinutes: 90, costBucket: "under_15",
    groupSize: "team", isOutdoor: false, venueType: "activity_venue", venueSearchHint: "cooking school", why: "A cozy way to meet new teammates.",
    considerationIds: ["vegetarian"], catalogIdeaId: null, ...extra,
  };
}

function trace(snapshot: IdeaSnapshot, name: string, args: unknown = {}): ToolTrace {
  const r = runIdeaTool(snapshot, name, args);
  assert.ok(r.name !== null && r.ok, name);
  return r as ToolTrace;
}

const NOW_PLUS = (days: number) => new Date(NOW.getTime() + days * DAY);
const localDate = (iso: string) => { const p = localParts(new Date(iso), TZ); return `${p.year}-${p.month}-${p.day}`; };

describe("idea tools", () => {
  test("six tools with strict-friendly argument schemas", () => {
    const defs = ideaToolDefinitions();
    assert.deepEqual(defs.map(d => d.name), ["getPastEvents", "getTagUsage", "getUpcomingCalendar", "getAttendanceTrends", "getIdeaCatalog", "getAvailableCoverLabels"]);
    for (const d of defs) assert.ok(d.description.length > 10 && d.description.length < 250);
    assert.deepEqual(Object.keys(defs[0]!.args.shape).sort(), ["limit", "sinceDays", "theme"]);
  });

  test("no descriptions, emails, people or small exact counts in any tool output", () => {
    const snapshot = rich();
    const all = ideaToolDefinitions().map(d => runIdeaTool(snapshot, d.name, {}));
    assert.ok(all.every(r => r.ok));
    const json = JSON.stringify(all.map(r => r.output));
    assert.doesNotMatch(json, /bob@|example\.com/);
    assert.doesNotMatch(json, /description/);
    assert.doesNotMatch(json, /memberCount|"members"/);
    const usage = runIdeaTool(snapshot, "getTagUsage", {}).output as { interests: Array<{ tagId: string; bucket: string; monthlyGrowth: number | null }> };
    assert.deepEqual(usage.interests.map(i => i.tagId), ["tag-food", "tag-music"]);
    assert.equal(usage.interests.find(i => i.tagId === "tag-music")!.bucket, "10-19");
    assert.equal(usage.interests.find(i => i.tagId === "tag-music")!.monthlyGrowth, 4);
  });

  test("growth only when both counts are at the floor, as an integer", () => {
    const usage = runIdeaTool(rich(), "getTagUsage", {}).output as { interests: Array<{ tagId: string; monthlyGrowth: number | null }> };
    assert.equal(usage.interests.find(i => i.tagId === "tag-food")!.monthlyGrowth, 3);
    const low = ideaSnapshot(signals({ interests: [{ tagId: "tag-music", memberCount: 7 }], interestsMonthAgo: [{ tagId: "tag-music", memberCount: 2 }] }), CATALOG_TAGS);
    const out = runIdeaTool(low, "getTagUsage", {}).output as { interests: Array<{ monthlyGrowth: number | null }> };
    assert.equal(out.interests[0]!.monthlyGrowth, null);
  });

  test("past events: cleaned title, derived fields only", () => {
    const out = runIdeaTool(rich(), "getPastEvents", { sinceDays: 30 }).output as { events: Array<Record<string, unknown>> };
    assert.equal(out.events.length, 2);
    const pizza = out.events.find(e => String(e.title).startsWith("Pizza"))!;
    assert.equal(pizza.title, "Pizza with");
    assert.deepEqual(Object.keys(pizza).sort(), ["attendeeCount", "capacity", "costBucket", "daypart", "fillPercent", "tagIds", "theme", "title", "weekday"]);
    assert.equal(pizza.fillPercent, 90);
    assert.equal(pizza.costBucket, "free");
  });

  test("unknown keys such as companyId are stripped, never read", () => {
    const snapshot = rich();
    const plain = runIdeaTool(snapshot, "getPastEvents", { sinceDays: 90, theme: null, limit: 12 });
    const sneaky = runIdeaTool(snapshot, "getPastEvents", { sinceDays: 90, theme: null, limit: 12, companyId: "other" });
    assert.ok(plain.ok && sneaky.ok);
    assert.deepEqual(sneaky.output, plain.output);
    assert.deepEqual(runIdeaTool(snapshot, "getTagUsage", JSON.stringify({ companyId: "other" })).output, runIdeaTool(snapshot, "getTagUsage", {}).output);
  });

  test("invalid arguments and unknown tools return error objects without throwing", () => {
    const snapshot = rich();
    assert.deepEqual(runIdeaTool(snapshot, "getPastEvents", { sinceDays: "soon" }), { name: "getPastEvents", ok: false, output: { error: "invalid arguments" } });
    assert.deepEqual(runIdeaTool(snapshot, "getPastEvents", { theme: "sailing" }).output, { error: "invalid arguments" });
    assert.deepEqual(runIdeaTool(snapshot, "getPastEvents", "{not json").output, { error: "invalid arguments" });
    assert.deepEqual(runIdeaTool(snapshot, "getPastEvents", [1, 2]).output, { error: "invalid arguments" });
    assert.deepEqual(runIdeaTool(snapshot, "dropTables", {}), { name: null, ok: false, output: { error: "unknown tool" } });
  });

  test("numeric arguments are clamped, missing ones default", () => {
    const snapshot = rich();
    const wide = runIdeaTool(snapshot, "getPastEvents", { sinceDays: 9999, limit: 500 });
    const edge = runIdeaTool(snapshot, "getPastEvents", { sinceDays: 180, limit: 20 });
    assert.ok(wide.ok);
    assert.deepEqual(wide.output, edge.output);
    assert.equal((runIdeaTool(snapshot, "getPastEvents", {}).output as { sinceDays: number }).sinceDays, 90);
    assert.equal((runIdeaTool(snapshot, "getPastEvents", { sinceDays: 1 }).output as { sinceDays: number }).sinceDays, 7);
  });

  test("calendar: counts only days with events, 4 weeks, quietest week, active weekly themes", () => {
    const snapshot = ideaSnapshot(signals({
      upcomingEvents: [{ start: new Date("2026-11-19T22:00:00Z"), tagIds: [] }, { start: new Date("2026-11-19T23:00:00Z"), tagIds: [] }, { start: new Date("2026-12-01T18:00:00Z"), tagIds: [] }],
      weeklyThemes: [
        { title: "Fall Fitness Week", tagIds: ["tag-fitness"], startDate: new Date("2026-11-16T00:00:00Z"), endDate: new Date("2026-11-22T00:00:00Z") },
        { title: "Old theme", tagIds: ["tag-arts"], startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-07T00:00:00Z") },
      ],
    }), CATALOG_TAGS);
    const out = runIdeaTool(snapshot, "getUpcomingCalendar", {}).output as {
      days: Array<{ date: string; events: number }>; weeks: Array<{ weekStart: string; events: number }>; quietestWeekStart: string;
      weeklyThemes: Array<{ title: string }>;
    };
    assert.deepEqual(out.days, [{ date: "2026-11-19", events: 2 }, { date: "2026-12-01", events: 1 }]);
    assert.equal(out.weeks.length, 4);
    assert.equal(out.weeks[0]!.weekStart, "2026-11-23");
    assert.deepEqual(out.weeks.map(w => w.events), [0, 1, 0, 0]);
    assert.equal(out.quietestWeekStart, "2026-11-23");
    assert.deepEqual(out.weeklyThemes.map(t => t.title), ["Fall Fitness Week"]);
  });

  test("trends omit cells under 2 events", () => {
    const snapshot = ideaSnapshot(signals({
      pastEvents: [past("A", ["tag-games"], 8, 10, 10), past("B", ["tag-games"], 15, 10, 5), past("C", ["tag-food"], 22, 10, 9)],
    }), CATALOG_TAGS);
    const out = runIdeaTool(snapshot, "getAttendanceTrends", {}).output as { byTheme: Array<{ theme: string; events: number; fillPercent: number }> };
    assert.deepEqual(out.byTheme, [{ theme: "games", events: 2, fillPercent: 75 }]);
  });

  test("catalog and cover tools: season, theme filter and limits", () => {
    const catalog = runIdeaTool(rich(), "getIdeaCatalog", {}).output as { ideas: Array<{ theme: string; costBucket: string }> };
    assert.ok(catalog.ideas.length > 0 && catalog.ideas.length <= 12);
    assert.ok(new Set(catalog.ideas.map(i => i.theme)).size > 3);
    const fitness = runIdeaTool(rich(), "getIdeaCatalog", { theme: "fitness" }).output as { ideas: Array<{ theme: string }> };
    assert.ok(fitness.ideas.every(i => i.theme === "fitness"));
    const labels = runIdeaTool(rich(), "getAvailableCoverLabels", { theme: "food" }).output as { labels: string[] };
    assert.ok(labels.labels.length > 0 && labels.labels.length <= 20);
    assert.equal(new Set(labels.labels.map(l => l.toLowerCase())).size, labels.labels.length);
  });

  test("capToolOutput keeps valid JSON under the cap and flags truncation", () => {
    const big = { rows: Array.from({ length: 200 }, (_, i) => ({ title: `Event number ${i}`, fillPercent: i })), small: [1, 2, 3], note: "kept" };
    const capped = capToolOutput(big, 900);
    const text = JSON.stringify(capped);
    assert.ok(text.length <= 900);
    assert.deepEqual(JSON.parse(text), capped);
    assert.equal(capped.truncated, true);
    assert.equal(capped.note, "kept");
    assert.ok((capped.rows as unknown[]).length > 0 && (capped.rows as unknown[]).length < 200);
    const small = { rows: [1] };
    assert.equal(capToolOutput(small), small);
    assert.ok(JSON.stringify(capToolOutput({ x: "y".repeat(5000) })).length <= IDEA_LIMITS.maxToolResultChars);
  });
});

describe("number grounding", () => {
  test("accepts numbers from tool outputs and rejects invented ones", () => {
    const snapshot = rich();
    const traces = [trace(snapshot, "getPastEvents", { sinceDays: 30 })];
    const numbers = groundedNumbers(traces);
    assert.equal(isGrounded("Your last food event filled 18 of 20 spots", numbers), true);
    assert.equal(isGrounded("About 90% of seats were taken", numbers), true);
    assert.equal(isGrounded("42 people asked for this", numbers), false);
    assert.equal(isGrounded("A cozy way to meet new teammates", numbers), true);
    assert.equal(isGrounded("Started in 2026", numbers), false);
  });

  test("fill ratios add their percent; thousands separators normalize", () => {
    const numbers = groundedNumbers([{ name: "getAttendanceTrends", ok: true, output: { fillRatio: 0.7, total: 1200 } }]);
    assert.equal(isGrounded("70% full", numbers), true);
    assert.equal(isGrounded("1,200 seats", numbers), true);
    assert.equal(isGrounded("71% full", numbers), false);
  });
});

describe("parseModelIdeas", () => {
  test("accepts a valid answer, rejects malformed or empty ones", () => {
    const snapshot = rich();
    const valid = { ideas: [{ ...modelIdea() }] };
    assert.equal(parseModelIdeas(valid, snapshot)?.length, 1);
    assert.equal(parseModelIdeas({ ideas: [] }, snapshot), null);
    assert.equal(parseModelIdeas({ ideas: [{ title: "x" }] }, snapshot), null);
    assert.equal(parseModelIdeas({ ideas: [modelIdea({ tagIds: ["tag-nope"] })] }, snapshot), null);
    assert.equal(parseModelIdeas("nope", snapshot), null);
  });
});

describe("buildIdeas", () => {
  const goodSet = (): ModelIdea[] => [
    modelIdea(),
    modelIdea({ title: "Sunrise yoga in the park", theme: "wellness", tagIds: ["tag-wellness"], goal: "wellness", weekday: 4, daypart: "weekday_morning", isOutdoor: true, venueType: "park_or_outdoors", costBucket: "free", why: "Gentle start to the day." }),
    modelIdea({ title: "Board game tournament", theme: "games", tagIds: ["tag-games"], weekday: 2, daypart: "after_work", why: "Easy to join." }),
    modelIdea({ title: "Clay pottery night", theme: "arts", tagIds: ["tag-arts"], weekday: 4, daypart: "after_work", costBucket: "from_15_to_50", why: "Hands-on and relaxed." }),
  ];

  test("interest claims must match the company's visible interests", () => {
    const snap = rich();
    assert.equal(interestClaimsHold("Food & Drink is your top interest (20+ members)", snap), true);
    assert.equal(interestClaimsHold("Music is your top interest (20+ members)", snap), false, "wrong bucket and not the largest");
    assert.equal(interestClaimsHold("Games has 20+ members", snap), false, "under the privacy floor, so never a claim");
    assert.equal(interestClaimsHold("Music is growing (10-19 members)", snap), true);
    assert.equal(interestClaimsHold("Music is one of your top interests (10-19 members)", snap), true, "top three is enough for 'one of'");
    assert.equal(interestClaimsHold("Wellness is growing fast", snap), false);
    assert.equal(interestClaimsHold("A cozy way to meet new teammates", snap), true, "no interest named");
    const built = buildIdeas(snap, [modelIdea({ why: "Cooking is your top interest (20+ members)" }), ...goodSet().slice(1)], [trace(snap, "getTagUsage")], NOW);
    assert.notEqual(built.ideas.find(i => i.title === "Pasta making workshop")!.why, "Cooking is your top interest (20+ members)");
  });

  test("a too-long why line keeps its first clause instead of a dangling cut, else falls back", () => {
    assert.equal(fitWhy("Food events averaged 94% fill.", 96), "Food events averaged 94% fill.");
    assert.equal(fitWhy("Arts & Crafts interests 5-9 members; Tuesday events averaged 87% fill across four lunches in a row", 60), "Arts & Crafts interests 5-9 members");
    assert.equal(fitWhy("x".repeat(120), 96), "");
    assert.equal(cleanText("Fresh pasta \u2014 rolled by hand", 80), "Fresh pasta, rolled by hand", "no em dashes in house style");
    assert.equal(cleanText("5\u20139 members", 80), "5\u20139 members", "an unspaced en dash in a range stays");
  });

  test("in Spanish an ungrounded why line falls back to the idea's own first sentence, never English server text", () => {
    const spanish = modelIdea({ title: "Taller de pasta fresca", description: "Amasen y corten pasta juntos. Luego compartan la comida.", why: "42 personas lo pidieron" });
    const built = buildIdeas(rich(), [spanish, ...goodSet().slice(1)], [], NOW, "es");
    const idea = built.ideas.find(i => i.title === "Taller de pasta fresca")!;
    assert.equal(idea.why, "Amasen y corten pasta juntos.");
    assert.equal(idea.reasonBasis, "generic");
    const english = buildIdeas(rich(), [{ ...spanish, title: "Fresh pasta workshop" }, ...goodSet().slice(1)], [], NOW);
    assert.notEqual(english.ideas.find(i => i.title === "Fresh pasta workshop")!.why, "42 personas lo pidieron");
  });

  test("repairs tags, puts the theme tag first, caps at 4 and uses catalog ids only", () => {
    const built = buildIdeas(rich(), [modelIdea({ tagIds: ["Cooking", "tag-fitness", "tag-social", "tag-games", "nonsense"] }), ...goodSet().slice(1)], [], NOW);
    const first = built.ideas[0]!;
    assert.deepEqual(first.tagIds, ["tag-food", "tag-cooking", "tag-fitness", "tag-social"]);
    assert.deepEqual(first.choices.focusTagIds, ["tag-food", "tag-cooking", "tag-fitness"]);
    assert.equal(first.draft.tagIds.length, 4);
  });

  test("weekend dayparts land on Saturday or Sunday and weekday ones on weekdays", () => {
    const built = buildIdeas(rich(), [
      modelIdea({ weekday: 3, daypart: "weekend_daytime", title: "Saturday farm market trip" }),
      modelIdea({ weekday: 7, daypart: "after_work", title: "Karaoke evening", theme: "music", tagIds: ["tag-music"] }),
    ], [], NOW);
    const weekend = built.ideas.find(i => i.title === "Saturday farm market trip")!;
    assert.equal(weekend.weekday, 6);
    assert.equal(localParts(new Date(weekend.startsAt), TZ).isoWeekday, 6);
    assert.equal(localParts(new Date(weekend.startsAt), TZ).hour, 10);
    const evening = built.ideas.find(i => i.title === "Karaoke evening")!;
    assert.ok(evening.weekday <= 5);
    assert.equal(localParts(new Date(evening.startsAt), TZ).isoWeekday, evening.weekday);
    assert.equal(localParts(new Date(evening.startsAt), TZ).hour, 17);
  });

  test("duration is clamped to 15 minute steps", () => {
    const built = buildIdeas(rich(), [modelIdea({ durationMinutes: 52 }), modelIdea({ title: "Marathon watch party", durationMinutes: 2000, theme: "music", tagIds: ["tag-music"], daypart: "after_work" }), modelIdea({ title: "Quick stretch", durationMinutes: 3, theme: "wellness", tagIds: ["tag-wellness"] })], [], NOW);
    assert.equal(built.ideas[0]!.durationMinutes, 45);
    assert.equal(built.ideas[1]!.durationMinutes, 480);
    assert.equal(built.ideas[2]!.durationMinutes, 15);
  });

  test("a weekday idea called a lunch runs at lunch and fits a lunch hour", () => {
    const built = buildIdeas(rich(), [modelIdea({ title: "Dumpling folding lunch", daypart: "weekday_afternoon", durationMinutes: 120 }), ...goodSet().slice(1)], [], NOW);
    const idea = built.ideas.find(i => i.title === "Dumpling folding lunch")!;
    assert.equal(idea.daypart, "weekday_lunch");
    assert.equal(idea.durationMinutes, 75);
  });

  test("scheduling: no stacking on one day when a neighboring day is free, never on a year-end holiday", () => {
    const sameDay = ["Pasta lab", "Clay hour", "Book swap", "Chess club", "Tea tasting"].map((title, i) =>
      modelIdea({ title, weekday: 2, daypart: "after_work", theme: (["food", "arts", "learning", "games", "wellness"] as const)[i], tagIds: [["tag-food"], ["tag-arts"], ["tag-learning"], ["tag-games"], ["tag-wellness"]][i]! }));
    const december = ideaSnapshot({ ...richSignals(), now: new Date("2026-12-10T15:00:00Z") }, CATALOG_TAGS);
    const built = buildIdeas(december, sameDay, [], new Date("2026-12-10T15:00:00Z"));
    const days = built.ideas.map(i => localDate(i.startsAt));
    assert.equal(new Set(days).size, days.length, `distinct days ${days.join(" ")}`);
    for (const idea of built.ideas) {
      const p = localParts(new Date(idea.startsAt), TZ);
      assert.equal(p.isoWeekday, idea.weekday, "the weekday field matches the scheduled day");
      assert.ok(!(p.month === 12 && [24, 25, 31].includes(p.day)), `${idea.title} on a holiday`);
    }
  });

  test("drops an idea that repeats a recent event and one with links or emails", () => {
    const built = buildIdeas(rich(), [
      modelIdea({ title: "Office trivia showdown", theme: "games", tagIds: ["tag-games"] }),
      modelIdea({ title: "Join at www.spam.test", theme: "arts", tagIds: ["tag-arts"] }),
      modelIdea({ title: "Mail me club", theme: "arts", tagIds: ["tag-arts"], description: "Write to someone@corp.example today." }),
      modelIdea({ title: "Clay pottery night", theme: "arts", tagIds: ["tag-arts"] }),
    ], [], NOW);
    assert.equal(built.agentCount, 1);
    assert.equal(built.ideas.find(i => i.source === "agent")!.title, "Clay pottery night");
    assert.ok(!built.ideas.some(i => /trivia/i.test(i.title)));
  });

  test("at most 2 per theme and no duplicate titles", () => {
    const built = buildIdeas(rich(), [
      modelIdea({ title: "Pasta workshop" }), modelIdea({ title: "pasta workshop" }), modelIdea({ title: "Sushi rolling class" }), modelIdea({ title: "Cheese tasting flight" }),
    ], [], NOW);
    assert.equal(built.agentCount, 2);
    assert.deepEqual(built.ideas.filter(i => i.source === "agent").map(i => i.title), ["Pasta workshop", "Sushi rolling class"]);
    const themes = built.ideas.map(i => i.theme);
    for (const t of new Set(themes)) assert.ok(themes.filter(x => x === t).length <= IDEA_LIMITS.maxPerTheme);
  });

  test("tops up to 4 from the catalog when too few survive, and with null model output", () => {
    const one = buildIdeas(rich(), [modelIdea()], [], NOW);
    assert.equal(one.agentCount, 1);
    assert.equal(one.ideas.length, IDEA_LIMITS.minIdeas);
    assert.deepEqual(one.ideas.map(i => i.source), ["agent", "catalog", "catalog", "catalog"]);
    assert.equal(new Set(one.ideas.map(i => i.title.toLowerCase())).size, 4);
    const none = buildIdeas(rich(), null, [], NOW);
    assert.equal(none.agentCount, 0);
    assert.equal(none.ideas.length, 4);
  });

  test("schedule: 2 to 28 days ahead, avoids a busy day and spreads ideas", () => {
    const busy = ideaSnapshot({ ...richSignals(), upcomingEvents: [{ start: new Date("2026-11-19T22:00:00Z"), tagIds: [] }] }, CATALOG_TAGS);
    const built = buildIdeas(busy, [
      modelIdea({ title: "Pasta workshop", weekday: 4, daypart: "after_work" }),
      modelIdea({ title: "Pottery night", theme: "arts", tagIds: ["tag-arts"], weekday: 4, daypart: "after_work" }),
    ], [], NOW);
    const [a, b] = built.ideas;
    assert.equal(localDate(a!.startsAt), "2026-11-26"); // Thursday Nov 19 has an event
    assert.equal(localDate(b!.startsAt), "2026-12-3"); // spreads over a different Thursday
    for (const idea of built.ideas) {
      const days = (new Date(idea.startsAt).getTime() - NOW.getTime()) / DAY;
      assert.ok(days >= IDEA_LIMITS.leadDays - 1 && days <= IDEA_LIMITS.horizonDays + 1, `${idea.title} ${days}`);
    }
  });

  test("every idea carries a contract-valid draft, distinct covers, ids and consistent choices", () => {
    const built = buildIdeas(rich(), goodSet(), [], NOW);
    assert.ok(built.ideas.length >= 4 && built.ideas.length <= 6);
    for (const idea of built.ideas) {
      assert.ok(GeneratedEventDraftSchema.safeParse(idea.draft).success, idea.title);
      assert.match(idea.id, /^[A-Za-z0-9_-]{1,64}$/);
      assert.equal(idea.draft.title, idea.title);
      assert.equal(idea.draft.rationale, idea.why);
      assert.equal(idea.draft.coverImageURL, idea.coverImageURL);
      assert.equal(idea.draft.suggestedDaypart, idea.daypart);
      assert.equal(idea.choices.budget, idea.costBucket);
      assert.ok(idea.why.length > 0 && idea.why.length <= IDEA_LIMITS.whyMax);
      assert.ok(idea.considerationIds.length <= 3);
      assert.equal(idea.tagIds[0], idea.draft.tagIds[0]);
      assert.equal(Number.isNaN(Date.parse(idea.startsAt)), false);
    }
    assert.equal(new Set(built.ideas.map(i => i.id)).size, built.ideas.length);
    assert.equal(new Set(built.ideas.map(i => i.coverImageURL)).size, built.ideas.length);
    assert.equal(built.ideas[0]!.choices.setting, "offsite");
    assert.equal(built.ideas[1]!.choices.setting, "outdoors");
    assert.equal(built.ideas[1]!.choices.timing, "after_work");
    assert.equal(built.ideas[0]!.choices.timing, "weekday_lunch");
    assert.equal(built.ideas[0]!.considerationIds[0], "vegetarian");
  });

  test("why lines: grounded model line kept as company data, ungrounded replaced", () => {
    const snapshot = rich();
    const traces = [trace(snapshot, "getPastEvents", { sinceDays: 30 })];
    const built = buildIdeas(snapshot, [
      modelIdea({ title: "Pasta workshop", why: "Your last food event filled 18 of 20 spots" }),
      modelIdea({ title: "Pottery night", theme: "arts", tagIds: ["tag-arts"], why: "Loved by 42 people on your team" }),
      modelIdea({ title: "Karaoke evening", theme: "music", tagIds: ["tag-music"], why: "A fun way to unwind together." }),
    ], traces, NOW);
    const [pasta, pottery, karaoke] = built.ideas;
    assert.equal(pasta!.why, "Your last food event filled 18 of 20 spots");
    assert.equal(pasta!.reasonBasis, "company_data");
    assert.doesNotMatch(pottery!.why, /42/);
    assert.ok(pottery!.why.length > 0);
    assert.equal(karaoke!.why, "A fun way to unwind together.");
    assert.equal(karaoke!.reasonBasis, "generic");
  });

  test("without company data every idea is generic with no 'your team' claims", () => {
    const built = buildIdeas(empty(), [
      modelIdea({ why: "Your team will love this, 12 people asked" }),
      modelIdea({ title: "Sunrise yoga", theme: "wellness", tagIds: ["tag-wellness"], why: "Gentle start to the day." }),
    ], [], NOW);
    assert.ok(built.ideas.length >= 4);
    for (const idea of built.ideas) {
      assert.equal(idea.reasonBasis, "generic", idea.title);
      assert.doesNotMatch(idea.why, /\byour\b|12/i);
    }
  });
});

describe("fallbackIdeas", () => {
  test("deterministic, 4 without data, 5 with data, valid drafts and distinct themes first", () => {
    const a = fallbackIdeas(empty(), NOW);
    const b = fallbackIdeas(empty(), NOW);
    assert.deepEqual(a, b);
    assert.equal(a.length, 4);
    assert.ok(a.every(i => i.source === "catalog" && i.reasonBasis === "generic" && i.fitLabel === undefined));
    assert.equal(new Set(a.map(i => i.theme)).size, 4);
    const withData = fallbackIdeas(rich(), NOW);
    assert.equal(withData.length, 5);
    for (const idea of [...a, ...withData]) assert.ok(GeneratedEventDraftSchema.safeParse(idea.draft).success, idea.id);
    assert.ok(withData.some(i => i.reasonBasis === "company_data"));
  });

  test("honors count and exclusions", () => {
    const base = fallbackIdeas(empty(), NOW, { count: 3 });
    assert.equal(base.length, 3);
    const next = fallbackIdeas(empty(), NOW, { count: 3, excludeTitles: base.map(i => i.title.toUpperCase()), excludeCovers: base.map(i => i.coverImageURL) });
    assert.ok(next.every(i => !base.some(b => b.title === i.title || b.coverImageURL === i.coverImageURL)));
  });
});

describe("ranking", () => {
  const perfectAnswers = (questions: Record<string, { type: string }>, skip: (id: string) => boolean = () => false) =>
    Object.fromEntries(Object.entries(questions).map(([id, q]): [string, DecisionAnswer] => {
      const high = !skip(id);
      return [id, q.type === "noul" ? { type: "noul", noul: high ? 1 : 0 } : { type: "score", score: high ? 3 : 0, probabilities: {}, confidence: 1 }];
    }));

  test("request is bounded to 6 ideas and 24 questions", () => {
    const eight = [...buildIdeas(rich(), goodSetForRank(), [], NOW).ideas, ...fallbackIdeas(rich(), NOW, { count: 5 })];
    const request = rankingRequest(eight, rich());
    assert.ok(Object.keys(request.questions).length <= 24);
    assert.ok(Object.keys(request.questions).every(id => /^c[1-6]_/.test(id)));
    assert.doesNotMatch(request.state, /bob@|example\.com/);
  });

  test("labels only with company data, never with data level none", () => {
    const withData = rich();
    const ideas = buildIdeas(withData, goodSetForRank(), [], NOW).ideas;
    const answers = perfectAnswers(rankingRequest(ideas, withData).questions);
    const ranked = applyRanking(ideas, withData, answers);
    assert.ok(ranked.every(i => i.fitLabel === "perfect"));
    assert.equal(ranked.length, ideas.length);

    const none = empty();
    const bare = fallbackIdeas(none, NOW);
    const labeled = applyRanking(bare, none, perfectAnswers(rankingRequest(bare, none).questions));
    assert.ok(labeled.every(i => !("fitLabel" in i)));
    assert.ok(applyRanking(bare, none, null).every(i => !("fitLabel" in i)));
  });

  test("stale labels are removed and answers reorder the ideas", () => {
    const snapshot = rich();
    const ideas = buildIdeas(snapshot, goodSetForRank(), [], NOW).ideas.map(i => ({ ...i, fitLabel: "perfect" as const }));
    const favorLast = perfectAnswers(rankingRequest(ideas, snapshot).questions, id => !id.startsWith(`c${ideas.length}_`));
    const ranked = applyRanking(ideas, snapshot, favorLast);
    assert.equal(ranked[0]!.id, ideas[ideas.length - 1]!.id);
    assert.ok(ranked.slice(1).every(i => i.fitLabel !== "perfect"));
    assert.deepEqual(applyRanking(ideas, snapshot, null).map(i => i.id).sort(), ideas.map(i => i.id).sort());
  });

  test("prior only is deterministic and stable, agent ideas lead ties", () => {
    const snapshot = rich();
    const ideas = buildIdeas(snapshot, goodSetForRank(), [], NOW).ideas;
    assert.deepEqual(applyRanking(ideas, snapshot, null), applyRanking(ideas, snapshot, null));
  });
});

function goodSetForRank(): ModelIdea[] {
  return [
    modelIdea(),
    modelIdea({ title: "Sunrise yoga in the park", theme: "wellness", tagIds: ["tag-wellness"], goal: "wellness", weekday: 4, daypart: "weekday_morning" }),
    modelIdea({ title: "Karaoke evening", theme: "music", tagIds: ["tag-music"], weekday: 2, daypart: "after_work" }),
    modelIdea({ title: "Clay pottery night", theme: "arts", tagIds: ["tag-arts"], weekday: 4, daypart: "after_work" }),
  ];
}

describe("fingerprint", () => {
  test("stable for equal input; changes with an interest bucket, not within one", () => {
    assert.equal(ideaFingerprint(rich()), ideaFingerprint(ideaSnapshot(richSignals(), CATALOG_TAGS)));
    assert.match(ideaFingerprint(rich()), /^[0-9a-f]{32}$/);
    assert.equal(ideaFingerprint(rich()), ideaFingerprint(ideaSnapshot(richSignals(13), CATALOG_TAGS)));
    assert.notEqual(ideaFingerprint(rich()), ideaFingerprint(ideaSnapshot(richSignals(25), CATALOG_TAGS)));
    assert.notEqual(ideaFingerprint(rich()), ideaFingerprint(empty()));
    assert.equal(IDEA_ALGORITHM_VERSION, 2);
    assert.equal(ideaFingerprint(rich(), "en"), ideaFingerprint(rich()), "English keeps the existing fingerprint");
    assert.notEqual(ideaFingerprint(rich(), "es"), ideaFingerprint(rich()), "another language runs again");
  });

  test("changes with the month and the upcoming calendar bucket, ignores under-floor counts", () => {
    const base = ideaFingerprint(rich());
    const later = ideaSnapshot({ ...richSignals(), now: NOW_PLUS(30) }, CATALOG_TAGS);
    assert.notEqual(ideaFingerprint(later), base);
    const busy = ideaSnapshot({ ...richSignals(), upcomingEvents: Array.from({ length: 4 }, () => ({ start: new Date("2026-11-25T18:00:00Z"), tagIds: [] })) }, CATALOG_TAGS);
    assert.notEqual(ideaFingerprint(busy), base);
    const tiny = richSignals();
    tiny.interests = tiny.interests!.map(i => (i.tagId === "tag-games" ? { ...i, memberCount: 4 } : i));
    assert.equal(ideaFingerprint(ideaSnapshot(tiny, CATALOG_TAGS)), base);
  });
});

describe("zonedInstant", () => {
  test("New York across DST", () => {
    assert.equal(zonedInstant("America/New_York", 2026, 3, 7, 12, 0).toISOString(), "2026-03-07T17:00:00.000Z"); // EST
    assert.equal(zonedInstant("America/New_York", 2026, 3, 8, 12, 0).toISOString(), "2026-03-08T16:00:00.000Z"); // EDT begins that day
    assert.equal(zonedInstant("America/New_York", 2026, 11, 1, 17, 30).toISOString(), "2026-11-01T22:30:00.000Z"); // EST again
    assert.equal(zonedInstant("America/New_York", 2026, 11, 26, 17, 30).toISOString(), "2026-11-26T22:30:00.000Z");
  });

  test("Amsterdam across DST", () => {
    assert.equal(zonedInstant("Europe/Amsterdam", 2026, 3, 28, 9, 30).toISOString(), "2026-03-28T08:30:00.000Z"); // CET
    assert.equal(zonedInstant("Europe/Amsterdam", 2026, 3, 29, 9, 30).toISOString(), "2026-03-29T07:30:00.000Z"); // CEST begins that day
    assert.equal(zonedInstant("Europe/Amsterdam", 2026, 10, 25, 18, 0).toISOString(), "2026-10-25T17:00:00.000Z"); // CET again
    const p = localParts(zonedInstant("Europe/Amsterdam", 2026, 7, 10, 12, 0), "Europe/Amsterdam");
    assert.deepEqual([p.year, p.month, p.day, p.hour], [2026, 7, 10, 12]);
  });
});
