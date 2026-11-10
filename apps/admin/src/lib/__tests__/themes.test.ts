import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { type KeyValueStore, createMockApi, seedThemes } from "../api";
import {
  THEME_REASONS, type ThemeDraft, type WeeklyTheme, endWeekOptions, findOverlap, firstFreeMonday, formatGoal,
  normalizeThemeDraft, overlapMessage, sortThemes, startWeekOptions, themePhase, validateThemeDraft, windowLocked,
} from "../challenge";
import { ApiError } from "../contract";
import { apiErrorFrom, themeFromDoc } from "../firebaseAdapter";
import { FALLBACK_ACCENT, THEMES, resolveTheme } from "../themes";
import {
  addDays, civilDateIn, formatWindow, isWeekAligned, mondayOf, nextMonday, startOfDay, weekEndIso, weekStartIso,
} from "../weeks";

// Tuesday Nov 10 2026, 10:00 Eastern.
const NOW = new Date("2026-11-10T15:00:00Z");

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function week(monday: string, weeks = 1) {
  return { startDate: weekStartIso(monday), endDate: weekEndIso(addDays(monday, weeks * 7 - 1)) };
}

function draft(overrides: Partial<ThemeDraft> = {}): ThemeDraft {
  return {
    title: "Fitness", description: "Move together.", tagIds: ["tag-fitness"], type: "weekly", goal: 3, goalUnit: "workouts",
    coverImageURL: "catalog://theme/fitness", ...week("2026-11-16"), pointsReward: 50, ...overrides,
  };
}

function theme(id: string, monday: string, overrides: Partial<WeeklyTheme> = {}): WeeklyTheme {
  return {
    ...draft(week(monday)), id, companyId: "acme", participantCount: 0, completedCount: 0, createdBy: "u", createdAt: "", updatedAt: "",
    revision: 1, ...overrides,
  };
}

async function signedIn(persona: "admin" | "member" | "otherAdmin" = "admin", store = memoryStore()) {
  const api = createMockApi(store, () => NOW);
  await api.signIn(persona);
  return api;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try { await promise; } catch (e) { if (e instanceof ApiError) return e; throw e; }
  throw new Error("expected a failure");
}

describe("weeks (Eastern Time)", () => {
  it("windows run Monday 00:00 to Sunday 23:59:59 Eastern", () => {
    expect(week("2026-11-09")).toEqual({ startDate: "2026-11-09T05:00:00.000Z", endDate: "2026-11-16T04:59:59.000Z" });
  });

  it("handles the fall-back and spring-forward weeks", () => {
    // DST ends Sun Nov 1 2026: starts in EDT (-4), ends in EST (-5).
    expect(week("2026-10-26")).toEqual({ startDate: "2026-10-26T04:00:00.000Z", endDate: "2026-11-02T04:59:59.000Z" });
    // DST starts Sun Mar 14 2027.
    expect(week("2027-03-08")).toEqual({ startDate: "2027-03-08T05:00:00.000Z", endDate: "2027-03-15T03:59:59.000Z" });
    expect(startOfDay("2026-07-06").toISOString()).toBe("2026-07-06T04:00:00.000Z");
  });

  it("uses the Eastern calendar date, not the UTC one", () => {
    // 03:00 UTC Monday is still Sunday evening in New York.
    expect(civilDateIn(new Date("2026-11-16T03:00:00Z"))).toBe("2026-11-15");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(nextMonday(new Date("2026-11-16T03:00:00Z"))).toBe("2026-11-16");
    expect(nextMonday(NOW)).toBe("2026-11-16");
    expect(nextMonday(new Date("2026-11-16T05:00:00Z"))).toBe("2026-11-23");
  });

  it("formats windows and spots non-aligned ones", () => {
    expect(formatWindow(week("2026-11-09").startDate, week("2026-11-09").endDate)).toBe("Nov 9 – Nov 15, 2026");
    expect(formatWindow(week("2026-12-28").startDate, week("2026-12-28").endDate)).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(formatWindow("", "x")).toBe("");
    expect(isWeekAligned(week("2026-11-09", 2).startDate, week("2026-11-09", 2).endDate)).toBe(true);
    expect(isWeekAligned("2026-11-10T05:00:00.000Z", week("2026-11-09").endDate)).toBe(false);
  });
});

describe("theme catalog", () => {
  it("resolves Fitness and falls back to neutral gray for unknown keys", () => {
    expect(resolveTheme("catalog://theme/fitness")).toBe(THEMES[0]);
    const unknown = resolveTheme("catalog://theme/yoga", "Yoga week");
    expect(unknown).toMatchObject({ key: "yoga", displayName: "Yoga week", illustration: null, accent: FALLBACK_ACCENT });
  });
});

describe("validateThemeDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateThemeDraft(draft(), { knownTagIds: ["tag-fitness"] })).toEqual({});
    expect(validateThemeDraft(draft(week("2026-11-16", 2)))).toEqual({});
  });

  it("mirrors the server limits", () => {
    const errors = validateThemeDraft(draft({
      title: " ", description: "x".repeat(1001), goal: 0, goalUnit: "u".repeat(25), pointsReward: 1001,
      coverImageURL: "https://example.com/photo.jpg", tagIds: ["nope"],
    }), { knownTagIds: ["tag-fitness"] });
    expect(Object.keys(errors).sort()).toEqual(["coverImageURL", "description", "goal", "goalUnit", "pointsReward", "tagIds", "title"]);
    expect(validateThemeDraft(draft({ title: "x".repeat(61) })).title).toBeDefined();
    expect(validateThemeDraft(draft({ goal: 10001 })).goal).toBeDefined();
    expect(validateThemeDraft(draft({ goal: Number.NaN })).goal).toBeDefined();
    expect(validateThemeDraft(draft({ pointsReward: 2.5 })).pointsReward).toBeDefined();
    expect(validateThemeDraft(draft({ pointsReward: 0 })).pointsReward).toBeUndefined();
    expect(validateThemeDraft(draft({ tagIds: ["a", "a"] })).tagIds).toBeDefined();
    expect(validateThemeDraft(draft({ tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) })).tagIds).toMatch(/at most 10/);
  });

  it("checks the window: order, presence and the 14-day maximum", () => {
    expect(validateThemeDraft(draft({ startDate: "" })).startDate).toBeDefined();
    expect(validateThemeDraft(draft({ endDate: draft().startDate })).endDate).toBeDefined();
    expect(validateThemeDraft(draft({ endDate: weekEndIso("2026-12-06") })).endDate).toMatch(/14 days/);
  });

  it("projects only draft fields onto the wire", () => {
    const full = { ...theme("t1", "2026-11-16", { participantCount: 9 }), title: "  Fitness  ", goalUnit: " workouts " };
    const wire = normalizeThemeDraft(full);
    expect(Object.keys(wire).sort()).toEqual(
      ["coverImageURL", "description", "endDate", "goal", "goalUnit", "pointsReward", "startDate", "tagIds", "title", "type"],
    );
    expect(wire).toMatchObject({ title: "Fitness", goalUnit: "workouts", type: "weekly" });
  });
});

describe("overlap, phases and week pickers", () => {
  const themes = [theme("last", "2026-11-02"), theme("this", "2026-11-09"), theme("later", "2026-11-30")];

  it("treats touching weeks as free and shared days as overlapping", () => {
    expect(findOverlap(week("2026-11-16"), themes)).toBeUndefined();
    expect(findOverlap(week("2026-11-16", 2), themes)).toBeUndefined();
    expect(findOverlap(week("2026-11-23", 2), themes)?.id).toBe("later");
    expect(findOverlap(week("2026-11-09"), themes)?.id).toBe("this");
    expect(findOverlap(week("2026-11-09"), themes, "this")).toBeUndefined();
    expect(overlapMessage(themes[1])).toBe("Overlaps “Fitness” (Nov 9 – Nov 15, 2026). Pick a week without a theme.");
  });

  it("classifies and sorts by window", () => {
    expect(themes.map((t) => themePhase(t, NOW))).toEqual(["past", "current", "upcoming"]);
    expect(themePhase(theme("edge", "2026-11-09"), new Date("2026-11-16T04:59:59Z"))).toBe("current");
    expect(themePhase(theme("edge", "2026-11-09"), new Date("2026-11-16T05:00:00Z"))).toBe("past");
    const upcoming = [theme("b", "2026-12-07"), theme("a", "2026-11-23")];
    expect(sortThemes(upcoming, "upcoming").map((t) => t.id)).toEqual(["a", "b"]);
    expect(sortThemes(upcoming, "past").map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("offers Mondays from this week on and marks taken weeks", () => {
    const options = startWeekOptions(themes, NOW);
    expect(options[0]).toMatchObject({ value: "2026-11-09", label: "Week of Mon, Nov 9, 2026" });
    expect(options[0].takenBy?.id).toBe("this");
    expect(options[1].takenBy).toBeUndefined();
    expect(options.length).toBe(27);
    // Editing keeps the theme's own (older) week selectable and not taken by itself.
    const editing = startWeekOptions(themes, NOW, { excludeId: "last", currentStart: themes[0].startDate });
    expect(editing[0]).toMatchObject({ value: "2026-11-02" });
    expect(editing[0].takenBy).toBeUndefined();
  });

  it("offers one or two weeks as the end, marking overlaps", () => {
    const ends = endWeekOptions(themes, week("2026-11-23").startDate);
    expect(ends.map((o) => o.value)).toEqual(["2026-11-29", "2026-12-06"]);
    expect(ends[0].takenBy).toBeUndefined();
    expect(ends[1].takenBy?.id).toBe("later");
    expect(endWeekOptions(themes, "")).toEqual([]);
    expect(endWeekOptions([], week("2026-11-23").startDate, { currentEnd: "2026-12-02T05:00:00Z" }).map((o) => o.value)).toContain("2026-12-02");
  });

  it("defaults a new theme to the first free week", () => {
    expect(firstFreeMonday(themes, "2026-11-09")).toBe("2026-11-16");
    expect(firstFreeMonday([], "2026-11-16")).toBe("2026-11-16");
    expect(formatGoal(3, "workouts")).toBe("3 workouts");
  });
});

describe("mock API: weekly themes", () => {
  it("only organizers can read or write themes", async () => {
    const member = await signedIn("member");
    expect((await failure(member.listThemes())).code).toBe("permission-denied");
    expect((await failure(member.createTheme(crypto.randomUUID(), draft()))).code).toBe("permission-denied");
    const signedOut = createMockApi(memoryStore(), () => NOW);
    expect((await failure(signedOut.listThemes())).code).toBe("unauthenticated");
  });

  it("isolates companies", async () => {
    const store = memoryStore();
    const acme = await signedIn("admin", store);
    const acmeThemes = await acme.listThemes();
    expect(acmeThemes.map((t) => t.companyId)).toEqual(["acme", "acme"]);
    const globex = await signedIn("otherAdmin", store);
    expect((await globex.listThemes()).map((t) => t.companyId)).toEqual(["globex"]);
    const lastWeek = acmeThemes[1];
    expect((await failure(globex.getTheme(lastWeek.id))).reason).toBe(THEME_REASONS.notFound);
    expect((await failure(globex.updateTheme(lastWeek.id, 1, lastWeek))).code).toBe("not-found");
  });

  it("creates once per requestId and rejects a reused key with new content", async () => {
    const api = await signedIn();
    const requestId = crypto.randomUUID();
    const created = await api.createTheme(requestId, draft());
    expect(created).toMatchObject({ revision: 1, replayed: false });
    expect(await api.createTheme(requestId, draft())).toEqual({ ...created, replayed: true });
    expect((await api.listThemes()).length).toBe(3);
    const stored = await api.getTheme(created.challengeId);
    expect(stored).toMatchObject({ companyId: "acme", participantCount: 0, completedCount: 0, createdBy: "uid-admin", revision: 1 });
    const reused = await failure(api.createTheme(requestId, draft({ title: "Other" })));
    expect(reused).toMatchObject({ code: "invalid-argument", reason: THEME_REASONS.requestReused });
  });

  it("enforces one theme per week and names the conflict", async () => {
    const api = await signedIn();
    const overlap = await failure(api.createTheme(crypto.randomUUID(), draft(week("2026-11-09"))));
    expect(overlap).toMatchObject({ code: "failed-precondition", reason: THEME_REASONS.overlap });
    expect(overlap.conflict).toEqual({ challengeId: "weekly-fitness-20261109", ...week("2026-11-09") });
    expect(Object.keys(overlap.fields).sort()).toEqual(["endDate", "startDate"]);
  });

  it("refuses a new theme whose weeks have already passed, but allows this week", async () => {
    const api = await signedIn();
    const past = await failure(api.createTheme(crypto.randomUUID(), draft(week("2026-10-26"))));
    expect(past).toMatchObject({ code: "invalid-argument" });
    expect(Object.keys(past.fields)).toEqual(["endDate"]);
    // The week already under way is still creatable (it fails here only because it's taken, not as "passed").
    expect((await failure(api.createTheme(crypto.randomUUID(), draft(week("2026-11-09"))))).reason).toBe(THEME_REASONS.overlap);
    expect(validateThemeDraft(draft(week("2026-11-09")), { now: NOW })).toEqual({});
  });

  it("validates like the server", async () => {
    const api = await signedIn();
    const bad = await failure(api.createTheme(crypto.randomUUID(), draft({ coverImageURL: "catalog://default/fitness", endDate: weekEndIso("2026-12-06") })));
    expect(bad.code).toBe("invalid-argument");
    expect(Object.keys(bad.fields).sort()).toEqual(["coverImageURL", "endDate"]);
  });

  it("updates with expectedRevision and keeps server-owned counts", async () => {
    const api = await signedIn();
    const current = (await api.listThemes())[0];
    expect(current.participantCount).toBe(128);
    const result = await api.updateTheme(current.id, 1, { ...current, participantCount: 0, completedCount: 0, title: "Fitness+" } as WeeklyTheme);
    expect(result).toEqual({ challengeId: current.id, revision: 2 });
    expect(await api.getTheme(current.id)).toMatchObject({ title: "Fitness+", participantCount: 128, completedCount: 41, revision: 2 });
    const stale = await failure(api.updateTheme(current.id, 1, current));
    expect(stale).toMatchObject({ code: "aborted", reason: THEME_REASONS.revisionConflict });
  });

  it("locks the start once people have joined, but allows extending", async () => {
    const api = await signedIn();
    const current = (await api.listThemes())[0];
    const moved = await failure(api.updateTheme(current.id, 1, { ...current, ...week("2026-11-16") }));
    expect(moved).toMatchObject({ code: "failed-precondition", reason: THEME_REASONS.windowLocked });
    const extended = await api.updateTheme(current.id, 1, { ...current, endDate: weekEndIso("2026-11-22") });
    expect(extended.revision).toBe(2);
  });

  it("locks the window when only completions exist, and leaves untouched themes free", () => {
    expect(windowLocked({ participantCount: 0, completedCount: 1 })).toBe(true);
    expect(windowLocked({ participantCount: 3, completedCount: 0 })).toBe(true);
    expect(windowLocked({ participantCount: 0, completedCount: 0 })).toBe(false);
  });

  it("seeds themes into preview data saved before themes existed, keeping its events", async () => {
    const store = memoryStore();
    const api = await signedIn("admin", store);
    const events = await api.listEvents();
    const saved = JSON.parse(store.getItem("dip-admin-mock-v2")!);
    delete saved.themes;
    delete saved.themeReceipts;
    store.setItem("dip-admin-mock-v2", JSON.stringify(saved));
    expect((await api.listThemes()).length).toBe(2);
    expect((await api.listEvents()).length).toBe(events.length);
    expect(seedThemes(NOW)[0].startDate).toBe(week("2026-11-09").startDate);
  });
});

describe("Firebase adapter mapping", () => {
  it("keeps the server reason and draft-relative fields", () => {
    const mapped = apiErrorFrom({
      code: "functions/failed-precondition", message: "Overlaps another theme.",
      details: {
        reason: "CHALLENGE_WINDOW_OVERLAP", fields: ["draft.startDate", "endDate"],
        conflict: { challengeId: "weekly-fitness-20261109", startDate: "2026-11-09T05:00:00Z", endDate: "2026-11-16T04:59:59Z" },
      },
    });
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped).toMatchObject({
      code: "failed-precondition", reason: "CHALLENGE_WINDOW_OVERLAP",
      conflict: { challengeId: "weekly-fitness-20261109", startDate: "2026-11-09T05:00:00Z", endDate: "2026-11-16T04:59:59Z" },
    });
    expect(apiErrorFrom({ code: "functions/failed-precondition", message: "x", details: { conflict: { challengeId: 3 } } })).toMatchObject({ conflict: undefined });
    expect(Object.keys((mapped as ApiError).fields).sort()).toEqual(["endDate", "startDate"]);
    expect(apiErrorFrom({ code: "functions/aborted", message: "Stale" })).toMatchObject({ code: "aborted", reason: undefined });
    const offline = new Error("network");
    expect(apiErrorFrom(offline)).toBe(offline);
  });

  it("maps challenge documents with Timestamps to ISO strings", () => {
    const start = new Date(week("2026-11-09").startDate);
    const end = new Date(week("2026-11-09").endDate);
    const mapped = themeFromDoc("weekly-fitness-20261109", {
      companyId: "acme", title: "Fitness", description: "d", tagIds: ["t", 3], type: "weekly", goal: 3, goalUnit: "workouts",
      coverImageURL: "catalog://theme/fitness", startDate: Timestamp.fromDate(start), endDate: Timestamp.fromDate(end),
      pointsReward: 50, participantCount: 7, completedCount: 2,
    });
    expect(mapped).toMatchObject({
      id: "weekly-fitness-20261109", tagIds: ["t"], startDate: start.toISOString(), endDate: end.toISOString(),
      participantCount: 7, completedCount: 2, revision: 1, createdAt: "",
    });
  });
});
