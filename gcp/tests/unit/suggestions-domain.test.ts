import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { DecisionAnswer } from "../../functions/src/modules/ai/application/ports";
import { isApprovedCoverURL } from "../../functions/src/modules/covers/domain/coverCatalog";
import { GeneratedEventDraftSchema } from "../../functions/src/modules/ai/domain/drafts";
import { COVER_CATEGORIES, DAYPARTS, VENUE_TYPES } from "../../functions/src/modules/ai/domain/vocabulary";
import {
  IDEA_CATALOG, THEME_KEYS, THEME_MAIN_TAG, ideaById, themeForTags, type IdeaTemplate,
} from "../../functions/src/modules/suggestions/domain/catalog";
import {
  signSuggestionToken, suggestionLinkURL, verifySuggestionToken,
} from "../../functions/src/modules/suggestions/domain/deepLink";
import { ideaToDraft } from "../../functions/src/modules/suggestions/domain/draft";
import { FIT_LABEL_TEXT, fitLabel } from "../../functions/src/modules/suggestions/domain/labels";
import {
  APPEAL_LEVELS, INTEREST_LEVELS, SUGGEST_WEIGHTS, buildState, candidateQuestions, chunkQuestions, composite, interpret,
} from "../../functions/src/modules/suggestions/domain/questions";
import { finish, prepare } from "../../functions/src/modules/suggestions/domain/rank";
import { dataNote, factsLine, reasonsFor, whenHint } from "../../functions/src/modules/suggestions/domain/reasons";
import { finalPick, isRepeat, prefilter, pickCount, type Scored } from "../../functions/src/modules/suggestions/domain/rules";
import {
  season, summarize, localParts, weekKey, weekLabel, type CompanySignals, type PastEvent,
} from "../../functions/src/modules/suggestions/domain/signals";

const CATALOG_TAGS = new Set([
  "tag-fitness", "tag-energetic", "tag-hype", "tag-outdoors", "tag-social", "tag-cooking", "tag-games",
  "tag-chill", "tag-food", "tag-arts", "tag-music", "tag-learning", "tag-volunteering", "tag-wellness",
]);
const DAY = 86_400_000;
const NOW = new Date("2026-11-17T15:00:00Z"); // Tuesday
const TZ = "America/New_York";

function idea(id: string): IdeaTemplate {
  const found = ideaById(id);
  assert.ok(found, id);
  return found;
}

function event(title: string, tagIds: string[], daysAgo: number, capacity: number, attendeeCount: number, extra: Partial<PastEvent> = {}): PastEvent {
  const start = new Date(NOW.getTime() - daysAgo * DAY);
  return { title, tagIds, start, end: new Date(start.getTime() + 3_600_000), capacity, attendeeCount, status: "published", isOutdoor: false, costCents: 0, ...extra };
}

function signals(extra: Partial<CompanySignals> = {}): CompanySignals {
  return {
    now: NOW, timeZone: TZ, memberCount: 40, pastEvents: [], upcomingEvents: [], interests: null, interestsMonthAgo: null,
    weeklyThemes: [], recentlySuggested: [], tagNames: { "tag-music": "Music", "tag-games": "Games", "tag-food": "Food & Drink" }, ...extra,
  };
}

describe("catalog", () => {
  test("integrity", () => {
    assert.equal(IDEA_CATALOG.length, 50);
    assert.equal(new Set(IDEA_CATALOG.map(i => i.id)).size, 50);
    for (const theme of THEME_KEYS) {
      const n = IDEA_CATALOG.filter(i => i.theme === theme).length;
      assert.ok(n === 5 || n === 6, `${theme} has ${n}`);
    }
    for (const i of IDEA_CATALOG) {
      assert.match(i.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(i.title.length <= 60, i.id);
      assert.ok(i.tagIds.length >= 1 && i.tagIds.length <= 4, i.id);
      assert.ok(i.tagIds.every(t => CATALOG_TAGS.has(t)), i.id);
      assert.equal(i.tagIds[0], THEME_MAIN_TAG[i.theme], i.id);
      assert.ok((COVER_CATEGORIES as readonly string[]).includes(i.coverCategory), i.id);
      assert.ok(i.months.length > 0 && i.months.every(m => m >= 1 && m <= 12), i.id);
      assert.ok(i.weekdays.length > 0 && i.weekdays.every(d => d >= 1 && d <= 7), i.id);
      assert.ok(i.pitch.length <= 140 && i.pitch.length > 0, i.id);
      assert.ok(i.description.length <= 600 && i.description.length > 0, i.id);
      assert.ok(i.venueSearchHint.length <= 120, i.id);
      assert.ok(i.durationMinutes >= 15 && i.durationMinutes <= 720, i.id);
      assert.ok(i.costCents >= 0 && i.costCents <= 5000, i.id);
      assert.ok(i.groupMin >= 1 && i.groupMin <= i.groupMax, i.id);
      assert.ok(i.dayparts.length > 0 && i.dayparts.every(d => (DAYPARTS as readonly string[]).includes(d)), i.id);
      assert.ok((VENUE_TYPES as readonly string[]).includes(i.venueType), i.id);
      assert.ok(!JSON.stringify(i).includes("—"), `em dash in ${i.id}`);
      assert.ok(!/!{2,}/.test(i.pitch), i.id);
      if (i.isOutdoor && i.id !== "fall-foliage-walk") assert.ok(![12, 1, 2].some(m => i.months.includes(m)), `winter outdoor ${i.id}`);
    }
    assert.deepEqual(idea("kayak-outing").months, [5, 6, 7, 8, 9]);
  });

  test("themeForTags", () => {
    assert.equal(themeForTags(["tag-social", "tag-music"]), "music");
    assert.equal(themeForTags(["tag-cooking"]), "food");
    assert.equal(themeForTags(["tag-chill"]), "wellness");
    assert.equal(themeForTags(["tag-energetic", "tag-games"]), "games");
    assert.equal(themeForTags(["tag-social"]), null);
  });
});

describe("signals", () => {
  test("weekKey across zones and the ISO year boundary", () => {
    assert.equal(weekKey(new Date("2026-12-31T17:00:00Z"), "America/New_York"), "2026-W53");
    const edge = new Date("2027-01-03T20:00:00Z");
    assert.equal(weekKey(edge, "Pacific/Auckland"), "2027-W01");
    assert.equal(weekKey(edge, "America/Los_Angeles"), "2026-W53");
    assert.equal(weekKey(NOW, TZ), "2026-W47");
  });

  test("local parts, season and week label", () => {
    const p = localParts(new Date("2026-11-16T03:00:00Z"), "America/Los_Angeles");
    assert.deepEqual(p, { isoWeekday: 7, hour: 19, year: 2026, month: 11, day: 15 });
    assert.equal(season(12), "winter");
    assert.equal(season(4), "spring");
    assert.equal(season(7), "summer");
    assert.equal(season(10), "fall");
    assert.equal(weekLabel(new Date(Date.UTC(2026, 11, 1))), "Week of Dec 1");
  });

  test("fill, best example and eligibility", () => {
    const s = summarize(signals({
      pastEvents: [
        event("Sunset hike", ["tag-outdoors"], 20, 30, 24),
        event("Lake day", ["tag-outdoors"], 40, 20, 10),
        event("Canceled hike", ["tag-outdoors"], 5, 30, 30, { status: "canceled" }),
        event("Old hike", ["tag-outdoors"], 200, 30, 30),
        event("Future", ["tag-outdoors"], -3, 30, 30),
      ],
    }));
    assert.equal(s.eligible.length, 2);
    const o = s.themes.outdoors;
    assert.equal(o.events, 2);
    assert.ok(Math.abs(o.avgFill! - 0.65) < 1e-9);
    assert.equal(o.avgAttendance, 17);
    assert.equal(o.lastHeldDaysAgo, 19); // 20 days ago minus the 1 hour event
    assert.deepEqual(o.best, { title: "Sunset hike", attendeeCount: 24, capacity: 30 });
    assert.equal(s.themes.music.avgFill, null);
    assert.equal(s.themes.music.best, null);
  });

  test("weekday uses the company time zone", () => {
    const e: PastEvent = { ...event("Late", ["tag-games"], 3, 10, 5), start: new Date("2026-11-14T03:00:00Z"), end: new Date("2026-11-14T04:00:00Z") };
    const la = summarize(signals({ timeZone: "America/Los_Angeles", pastEvents: [e] }));
    assert.equal(la.weekdayFill[5], 0.5); // Friday evening in Los Angeles
    assert.equal(la.weekdayFill[6], null);
    const utc = summarize(signals({ timeZone: "UTC", pastEvents: [e] }));
    assert.equal(utc.weekdayFill[6], 0.5);
  });

  test("busy weeks and quietest week", () => {
    const up = (iso: string) => ({ start: new Date(iso), tagIds: [] as string[] });
    const s = summarize(signals({
      upcomingEvents: [up("2026-11-24T17:00:00Z"), up("2026-11-25T17:00:00Z"), up("2026-11-26T17:00:00Z"), up("2026-12-02T17:00:00Z")],
    }));
    assert.deepEqual(s.busyWeeks.map(w => w.events), [3, 1, 0, 0]);
    assert.equal(s.quietestWeekStart.toISOString(), "2026-12-07T00:00:00.000Z");
    assert.equal(s.upcomingTwoWeeks, 3);
    const empty = summarize(signals());
    assert.equal(empty.quietestWeekStart.toISOString(), "2026-11-23T00:00:00.000Z");
    assert.equal(empty.upcomingTwoWeeks, 0);
  });

  test("interest suppression and growth", () => {
    const s = summarize(signals({
      interests: [{ tagId: "tag-music", memberCount: 3 }, { tagId: "tag-games", memberCount: 7 }, { tagId: "tag-food", memberCount: 25 }],
      interestsMonthAgo: [{ tagId: "tag-music", memberCount: 1 }, { tagId: "tag-games", memberCount: 4 }, { tagId: "tag-food", memberCount: 20 }],
    }));
    const by = new Map(s.interests.map(i => [i.tagId, i]));
    assert.equal(by.get("tag-music")!.bucket, null);
    assert.equal(by.get("tag-games")!.bucket, "5-9");
    assert.equal(by.get("tag-food")!.bucket, "20+");
    assert.equal(by.get("tag-games")!.growth, 3);
    assert.equal(by.get("tag-food")!.growth, 5);
    const none = summarize(signals({ interests: [{ tagId: "tag-music", memberCount: 9 }] }));
    assert.equal(none.interests[0]!.growth, null);
  });

  test("data level", () => {
    assert.equal(summarize(signals()).dataLevel, "none");
    assert.equal(summarize(signals({ interests: [{ tagId: "tag-music", memberCount: 6 }] })).dataLevel, "some");
    const many = Array.from({ length: 8 }, (_, i) => event(`E${i}`, ["tag-games"], 10 + i, 10, 5));
    assert.equal(summarize(signals({ pastEvents: many })).dataLevel, "some");
    assert.equal(summarize(signals({ pastEvents: many, interests: [{ tagId: "tag-music", memberCount: 6 }] })).dataLevel, "rich");
    assert.equal(summarize(signals({ pastEvents: many.slice(0, 3) })).dataLevel, "some");
  });
});

describe("rules", () => {
  test("season, capacity and recently suggested", () => {
    const sig = signals();
    const ids = prefilter(IDEA_CATALOG, summarize(sig), sig).map(i => i.id);
    assert.ok(!ids.includes("kayak-outing"));
    assert.ok(ids.includes("fall-foliage-walk"));
    const small = signals({ memberCount: 5 });
    const smallIds = prefilter(IDEA_CATALOG, summarize(small), small).map(i => i.id);
    assert.ok(!smallIds.includes("bowling-night"));
    assert.ok(smallIds.includes("escape-room"));
    assert.ok(ids.includes("bowling-night"));
    const used = signals({ recentlySuggested: ["fall-foliage-walk"] });
    assert.ok(!prefilter(IDEA_CATALOG, summarize(used), used).some(i => i.id === "fall-foliage-walk"));
  });

  test("same activity within six weeks is a repeat", () => {
    assert.ok(isRepeat(idea("trivia-night"), ["Office Trivia Night!"]));
    assert.ok(!isRepeat(idea("trivia-night"), ["Pottery night"]));
    const recent = signals({ pastEvents: [event("Office Trivia Night", ["tag-games"], 10, 20, 10)] });
    assert.ok(!prefilter(IDEA_CATALOG, summarize(recent), recent).some(i => i.id === "trivia-night"));
    const old = signals({ pastEvents: [event("Office Trivia Night", ["tag-games"], 60, 20, 10)] });
    assert.ok(prefilter(IDEA_CATALOG, summarize(old), old).some(i => i.id === "trivia-night"));
  });

  test("finalPick counts, one per theme and goal diversity", () => {
    const up = (n: number) => Array.from({ length: n }, (_, i) => ({ start: new Date(NOW.getTime() + (i + 1) * DAY), tagIds: [] as string[] }));
    const ids = ["sunrise-hike", "dumpling-workshop", "pottery-night", "trivia-night", "karaoke-night", "lightning-talks", "food-bank-shift", "guided-meditation", "rock-climbing-intro"];
    const flat: Scored[] = ids.map((id, i) => ({ idea: idea(id), score: 0.9 - i * 0.05 }));
    assert.equal(finalPick(flat, summarize(signals({ upcomingEvents: up(0) }))).length, 5);
    assert.equal(finalPick(flat, summarize(signals({ upcomingEvents: up(3) }))).length, 4);
    assert.equal(finalPick(flat, summarize(signals({ upcomingEvents: up(6) }))).length, 3);
    assert.equal(pickCount(summarize(signals({ upcomingEvents: up(2) }))), 5);

    const scored: Scored[] = [
      { idea: idea("kayak-outing"), score: 0.95 },
      { idea: idea("sunrise-hike"), score: 0.94 },
      { idea: idea("pottery-night"), score: 0.9 },
      { idea: idea("dumpling-workshop"), score: 0.88 },
      { idea: idea("trivia-night"), score: 0.87 },
      ...["food-bank-shift", "guided-meditation", "karaoke-night"].map(id => ({ idea: idea(id), score: 0.5 })),
    ];
    const picked = finalPick(scored, summarize(signals({ upcomingEvents: up(3) })));
    const picks = picked.map(p => p.idea.id);
    assert.equal(new Set(picked.map(p => p.idea.theme)).size, picked.length);
    assert.equal(picks[0], "kayak-outing");
    // kayak takes team_bonding; pottery and dumpling repeat it while trivia (competition) is within 0.05 of them
    assert.ok(picks.includes("trivia-night"), picks.join());
    assert.ok(!picks.includes("pottery-night") && !picks.includes("dumpling-workshop"), picks.join());
    assert.equal(picks.length, 4);
  });
});

describe("questions", () => {
  const sig = signals({
    pastEvents: [
      event("Trivia with bob@example.com", ["tag-games"], 10, 20, 10),
      event("Sunset hike", ["tag-outdoors"], 20, 30, 24),
    ],
    interests: [{ tagId: "tag-music", memberCount: 22 }, { tagId: "tag-games", memberCount: 3 }],
    weeklyThemes: [{ title: "Move more", tagIds: ["tag-fitness"], startDate: new Date(NOW.getTime() - DAY), endDate: new Date(NOW.getTime() + 6 * DAY) }],
  });
  const prepared = prepare(sig);

  test("ids, four per candidate and chunking", () => {
    assert.equal(prepared.shortlist.length, 12);
    const q = candidateQuestions(prepared.shortlist.map(s => s.idea));
    assert.equal(Object.keys(q).length, 48);
    for (let n = 1; n <= 12; n++) {
      for (const k of ["interest", "fresh", "appeal", "theme"]) assert.ok(q[`c${n}_${k}`], `c${n}_${k}`);
    }
    assert.equal(q.c1_interest!.type, "score");
    assert.equal(q.c1_theme!.type, "noul");
    assert.ok(q.c1_interest!.instructions.includes(prepared.shortlist[0]!.idea.title));
    assert.ok(q.c1_interest!.instructions.includes(prepared.shortlist[0]!.idea.pitch));
    assert.equal(prepared.questionChunks.length, 2);
    for (const max of [24, 10, 4, 3]) {
      const chunks = chunkQuestions(q, max);
      assert.equal(chunks.flatMap(c => Object.keys(c)).length, 48);
      for (const chunk of chunks) {
        const counts = new Map<string, number>();
        for (const id of Object.keys(chunk)) counts.set(id.split("_")[0]!, (counts.get(id.split("_")[0]!) ?? 0) + 1);
        assert.ok([...counts.values()].every(c => c === 4), `max ${max}`);
        if (max >= 4) assert.ok(Object.keys(chunk).length <= max);
      }
    }
  });

  test("state holds only company aggregates", () => {
    const state = JSON.parse(prepared.state);
    assert.equal(state.company.size, "20 to 50 members");
    assert.deepEqual(state.company.interests, [{ interest: "Music", members: "20+" }, { interest: "Games", members: "under 5" }]);
    assert.equal(state.company.recentEvents.length, 2);
    assert.equal(state.company.pastTurnout["Outdoors"].typicalFill, "about 80% full");
    assert.deepEqual(state.company.weeklyThemes, ["Move more"]);
    assert.equal(state.company.season, "fall");
    assert.equal(state.company.month, "November");
    assert.ok(!prepared.state.includes("@"));
    assert.ok(!prepared.state.includes("bob"));
    assert.equal(buildState(summarize(signals({ memberCount: null })), signals()).includes('"size":"unknown"'), true);
  });

  test("interpret Jev-shaped, OpenAI-shaped and missing answers", () => {
    const list = prepared.shortlist.map(s => s.idea);
    const jev: Record<string, DecisionAnswer> = {
      c1_interest: { type: "score", score: 2, probabilities: { "0": 0, "1": 0.1, "2": 0.2, "3": 0.7 }, confidence: 0.9 },
      c1_theme: { type: "noul", noul: 0.8 },
      c2_interest: { type: "score", score: 3, probabilities: { [INTEREST_LEVELS[3]]: 1 }, confidence: 1 },
      c2_appeal: { type: "score", score: 1.5, probabilities: {}, confidence: 0.5 },
      c2_fresh: { type: "noul", noul: 1 } as DecisionAnswer,
    };
    const out = interpret(jev, list);
    assert.ok(Math.abs(out[0]!.interest! - 2.6 / 3) < 1e-9);
    assert.equal(out[0]!.theme, 0.8);
    assert.equal(out[0]!.fresh, null);
    assert.equal(out[1]!.interest, 1);
    assert.equal(out[1]!.appeal, 0.5);
    assert.equal(out[1]!.fresh, null);
    assert.deepEqual(out[2], { interest: null, fresh: null, appeal: null, theme: null });
    assert.equal(interpret(null, list).length, 12);
    assert.ok(APPEAL_LEVELS.length === 4);
  });

  test("composite weights and prior fallback", () => {
    const sum = Object.values(SUGGEST_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    const all = composite({ interest: 1, fresh: 1, appeal: 1, theme: 1 }, 0.5);
    assert.ok(Math.abs(all - (0.35 + 0.25 + 0.2 + 0.1 + 0.05)) < 1e-9);
    const mixed = composite({ interest: 1, fresh: 0, appeal: null, theme: 0 }, 0.4);
    assert.ok(Math.abs(mixed - (0.35 * 1 + 0.25 * 0.4 + 0.2 * 0 + 0.1 * 0 + 0.1 * 0.4)) < 1e-9);
    assert.ok(Math.abs(composite({ interest: null, fresh: null, appeal: null, theme: null }, 0.42) - 0.42) < 1e-9);
  });
});

describe("labels", () => {
  test("thresholds and no data", () => {
    assert.equal(fitLabel(0.78, "some"), "perfect");
    assert.equal(fitLabel(0.77, "some"), "great");
    assert.equal(fitLabel(0.66, "rich"), "great");
    assert.equal(fitLabel(0.55, "some"), "good");
    assert.equal(fitLabel(0.54, "some"), null);
    assert.equal(fitLabel(0.99, "none"), null);
    assert.equal(FIT_LABEL_TEXT.perfect, "Perfect fit");
  });
});

describe("reasons and facts", () => {
  test("growth then top interest", () => {
    const sig = signals({
      interests: [{ tagId: "tag-music", memberCount: 22 }], interestsMonthAgo: [{ tagId: "tag-music", memberCount: 17 }],
    });
    const r = reasonsFor(idea("karaoke-night"), summarize(sig), sig);
    assert.deepEqual(r, ["5 more teammates picked Music this month", "Music is one of your top interests (20+ members)"]);
  });

  test("past success, gap, weekly theme and calendar", () => {
    const hike = signals({ pastEvents: [event("Sunset hike", ["tag-outdoors"], 20, 30, 24)] });
    const r1 = reasonsFor(idea("fall-foliage-walk"), summarize(hike), hike);
    assert.equal(r1[0], 'Your last outdoor event, "Sunset hike", filled 24 of 30 spots');
    assert.equal(reasonsFor(idea("pottery-night"), summarize(hike), hike)[0], "No arts & crafts events yet");
    const old = signals({ pastEvents: [event("Pottery", ["tag-arts"], 60, 20, 5)] });
    assert.equal(reasonsFor(idea("improv-workshop"), summarize(old), old)[0], "No arts & crafts events in the last 8 weeks");

    const weekly = signals({ weeklyThemes: [{ title: "Move more", tagIds: ["tag-fitness"], startDate: new Date(NOW.getTime() - DAY), endDate: new Date(NOW.getTime() + 6 * DAY) }] });
    const r2 = reasonsFor(idea("lunchtime-run-club"), summarize(weekly), weekly);
    assert.deepEqual(r2, ['Fits the "Move more" weekly theme', "The week of Nov 23 is quiet on your calendar"]);

    const bare = signals();
    const r3 = reasonsFor(idea("book-club-kickoff"), summarize(bare), bare);
    assert.deepEqual(r3, ["The week of Nov 23 is quiet on your calendar"]);
  });

  test("never more than two, never long, never a small count", () => {
    const sig = signals({
      interests: [{ tagId: "tag-music", memberCount: 3 }], interestsMonthAgo: [{ tagId: "tag-music", memberCount: 0 }],
      pastEvents: Array.from({ length: 5 }, (_, i) => event(`${"Very long title ".repeat(8)}${i}`, ["tag-music"], 10 + i, 10, 9)),
    });
    const summary = summarize(sig);
    for (const i of IDEA_CATALOG) {
      const r = reasonsFor(i, summary, sig);
      assert.ok(r.length <= 2);
      assert.ok(r.every(x => x.length <= 120), i.id);
      assert.ok(!r.some(x => /3 more|\b3 members/.test(x)), i.id);
    }
  });

  test("data note, when hint and facts", () => {
    assert.ok(dataNote("none")!.startsWith("We don't have much activity"));
    assert.equal(dataNote("some"), null);
    const evs = [
      event("A", ["tag-games"], 5, 20, 20, { start: new Date("2026-11-12T23:00:00Z"), end: new Date("2026-11-13T00:00:00Z") }),
      event("B", ["tag-games"], 6, 20, 5, { start: new Date("2026-11-11T23:00:00Z"), end: new Date("2026-11-12T00:00:00Z") }),
    ];
    const sig = signals({ pastEvents: evs });
    assert.equal(whenHint(idea("trivia-night"), summarize(sig)), "Try a Thursday after work, week of Nov 23");
    assert.equal(whenHint(idea("sunrise-hike"), summarize(signals())), "Try a Saturday daytime, week of Nov 23");
    const sample: IdeaTemplate = { ...idea("trivia-night"), durationMinutes: 90, groupMin: 8, groupMax: 20, costCents: 1000 };
    assert.equal(factsLine(sample), "1 h 30 min · 8 to 20 people · Under $15 per person");
    assert.equal(factsLine({ ...sample, durationMinutes: 45, costCents: 0 }), "45 min · 8 to 20 people · Free");
    assert.ok(factsLine({ ...sample, durationMinutes: 60 }).startsWith("1 h · "));
  });
});

describe("deep links", () => {
  const key = "k".repeat(40);
  const claims = { companyId: "co_1", weekKey: "2026-W47", ideaId: "trivia-night" };

  test("sign and verify", () => {
    const token = signSuggestionToken(key, claims, 1000);
    assert.deepEqual(verifySuggestionToken(key, token, 2000), { ok: true, ...claims });
    assert.equal(suggestionLinkURL("https://letsdip.work", token), `https://letsdip.work/admin/ideas/suggested/?t=${token}`);
  });

  test("tamper, expiry, wrong key, malformed", () => {
    const token = signSuggestionToken(key, claims, 1000);
    const [payload, sig] = token.split(".") as [string, string];
    const other = Buffer.from(JSON.stringify({ v: 1, c: "co_2", w: "2026-W47", i: "trivia-night", e: 9_999_999_999 })).toString("base64url");
    assert.deepEqual(verifySuggestionToken(key, `${other}.${sig}`, 2000), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifySuggestionToken(key, `${payload}.${sig.slice(0, -2)}AA`, 2000), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifySuggestionToken(key, token, 1000 + 30 * 86400 + 1), { ok: false, reason: "expired" });
    assert.equal(verifySuggestionToken(key, token, 1000 + 30 * 86400).ok, true);
    assert.deepEqual(verifySuggestionToken("z".repeat(40), token, 2000), { ok: false, reason: "bad_signature" });
    for (const bad of [undefined, 42, "", "abc", "a.b.c", "a b.c", "x".repeat(600)]) {
      assert.deepEqual(verifySuggestionToken(key, bad, 2000), { ok: false, reason: "malformed" });
    }
    assert.throws(() => signSuggestionToken("short", claims, 1000));
    assert.throws(() => signSuggestionToken(key, { ...claims, weekKey: "bad" }, 1000));
    assert.throws(() => signSuggestionToken(key, { ...claims, companyId: "a/b" }, 1000));
  });
});

describe("ideaToDraft", () => {
  test("every idea yields a valid draft", () => {
    for (const i of IDEA_CATALOG) {
      const draft = ideaToDraft(i, "Fits the \"Move more\" weekly theme", 40);
      const parsed = GeneratedEventDraftSchema.safeParse(draft);
      assert.ok(parsed.success, i.id);
      assert.ok(isApprovedCoverURL(draft.coverImageURL), draft.coverImageURL);
      assert.ok(draft.title.length <= 120 && draft.description.length <= 2000);
      assert.ok(draft.rationale.length >= 1 && draft.rationale.length <= 160);
      assert.ok(draft.tagIds.length >= 1 && draft.tagIds.length <= 5);
    }
  });

  test("capacity, cost note and rationale", () => {
    const i = idea("dumpling-workshop");
    assert.equal(ideaToDraft(i, "x", null).capacity, i.groupMax);
    assert.equal(ideaToDraft(i, "x", 12).capacity, 12);
    assert.equal(ideaToDraft(i, "x", 0).capacity, 1);
    assert.equal(ideaToDraft(i, "x", 40).costNote, "About $25 per person");
    assert.equal(ideaToDraft(idea("book-club-kickoff"), "x", 40).costNote, "");
    const long = ideaToDraft(i, "word ".repeat(80), 40).rationale;
    assert.ok(long.length <= 160 && long.endsWith("…"));
    assert.equal(ideaToDraft(i, "  ", 40).rationale, i.pitch);
  });
});

describe("rank", () => {
  test("heuristic with no data has no labels and a note", () => {
    const prepared = prepare(signals());
    const result = finish(prepared, null, "heuristic");
    assert.equal(result.engine, "heuristic");
    assert.equal(result.dataLevel, "none");
    assert.ok(result.dataNote);
    assert.equal(result.ideas.length, 5);
    assert.ok(result.ideas.every(i => i.label === null && i.reasons.length <= 2));
    assert.equal(new Set(result.ideas.map(i => ideaById(i.ideaId)!.theme)).size, 5);
    assert.equal(result.weekKey, "2026-W47");
    assert.equal(result.weekLabel, "Week of Nov 16");
    assert.deepEqual(result, finish(prepare(signals()), null, "heuristic"));
  });

  test("model answers lift the favorite and fall back per candidate", () => {
    const sig = signals({ interests: [{ tagId: "tag-music", memberCount: 22 }], tagNames: { "tag-music": "Music" } });
    const prepared = prepare(sig);
    const answers: Record<string, DecisionAnswer> = {};
    const fav = prepared.shortlist.length - 1;
    const best: DecisionAnswer = { type: "score", score: 3, probabilities: { "3": 1 }, confidence: 1 };
    answers[`c${fav + 1}_interest`] = best;
    answers[`c${fav + 1}_appeal`] = best;
    answers[`c${fav + 1}_fresh`] = best;
    answers[`c${fav + 1}_theme`] = { type: "noul", noul: 1 };
    const result = finish(prepared, answers, "jev");
    assert.equal(result.engine, "jev");
    assert.equal(result.ideas[0]!.ideaId, prepared.shortlist[fav]!.idea.id);
    assert.ok(result.ideas[0]!.score > 0.9);
    assert.equal(result.ideas[0]!.label, "perfect");
    assert.deepEqual(result.tagCounts, { "tag-music": 22 });
  });
});
