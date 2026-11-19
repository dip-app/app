import { describe, expect, it } from "vitest";
import {
  DRAFT_ENVELOPE_VERSION, DRAFT_MAX_CHARS, DRAFT_TTL_MS, clearDraft, draftKey, readDraft, relativeAgo, writeDraft,
} from "../formDraft";
import { eventMeaningful, eventSnapshot, parseEventSnapshot, parseThemeSnapshot, restoreEvent, restoreTheme, themeSnapshot } from "../formDraftSnapshots";
import { emptyDraft } from "../contract";
import { THEMES } from "../themes";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}
const ok = (raw: unknown) => (raw && typeof raw === "object" ? (raw as { a: number }) : null);

describe("draft storage", () => {
  const key = draftKey("event", { uid: "u1", companyId: "c1" });

  it("keys by kind, company and user, so nobody sees another admin's draft", () => {
    expect(key).not.toBe(draftKey("event", { uid: "u2", companyId: "c1" }));
    expect(key).not.toBe(draftKey("event", { uid: "u1", companyId: "c2" }));
    expect(key).not.toBe(draftKey("theme", { uid: "u1", companyId: "c1" }));
    expect(draftKey("event", { uid: "a.b", companyId: "c" })).not.toBe(draftKey("event", { uid: "a", companyId: "b.c" }));
  });

  it("round-trips a draft with its save time", () => {
    const store = memory();
    expect(writeDraft(store, key, { a: 1 }, 1_000)).toBe("ok");
    expect(readDraft(store, key, ok, 2_000)).toEqual({ data: { a: 1 }, savedAt: 1_000 });
  });

  it("drops a draft past its 30-day TTL and removes it", () => {
    const store = memory();
    writeDraft(store, key, { a: 1 }, 0);
    expect(readDraft(store, key, ok, DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(readDraft(store, key, ok, DRAFT_TTL_MS + 1)).toBeNull();
    expect(store.data.has(key)).toBe(false);
  });

  it("drops another envelope version, garbage, a future save time and data the parser rejects", () => {
    const store = memory();
    store.setItem(key, JSON.stringify({ v: DRAFT_ENVELOPE_VERSION + 1, savedAt: 1, data: { a: 1 } }));
    expect(readDraft(store, key, ok, 2)).toBeNull();
    expect(store.data.has(key)).toBe(false);
    store.setItem(key, "{not json");
    expect(readDraft(store, key, ok, 2)).toBeNull();
    store.setItem(key, JSON.stringify({ v: DRAFT_ENVELOPE_VERSION, savedAt: 10_000_000, data: { a: 1 } }));
    expect(readDraft(store, key, ok, 2)).toBeNull();
    store.setItem(key, JSON.stringify({ v: DRAFT_ENVELOPE_VERSION, savedAt: 1, data: 5 }));
    expect(readDraft(store, key, ok, 2)).toBeNull();
    expect(store.data.has(key)).toBe(false);
  });

  it("refuses a draft over the size cap and reports blocked or full storage instead of throwing", () => {
    const store = memory();
    expect(writeDraft(store, key, { a: "x".repeat(DRAFT_MAX_CHARS) })).toBe("too-large");
    expect(store.data.size).toBe(0);
    const full = { ...memory(), setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
    expect(writeDraft(full, key, { a: 1 })).toBe("unavailable");
    expect(writeDraft(null, key, { a: 1 })).toBe("unavailable");
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readDraft(blocked, key, ok)).toBeNull();
    expect(() => clearDraft(blocked, key)).not.toThrow();
    expect(readDraft(null, key, ok)).toBeNull();
  });

  it("describes the age in words", () => {
    expect(relativeAgo(0, 10_000, "en")).toBeNull();
    expect(relativeAgo(0, 5 * 60_000, "en")).toBe("5 minutes ago");
    expect(relativeAgo(0, 3 * 3_600_000, "en")).toBe("3 hours ago");
    expect(relativeAgo(0, 2 * 86_400_000, "en")).toBe("2 days ago");
    expect(relativeAgo(0, 5 * 86_400_000, "es")).toBe("hace 5 días");
  });
});

describe("event snapshot", () => {
  const filled = () => {
    const draft = { ...emptyDraft(), title: "Trivia", startTime: "2030-01-02T18:00:00.000Z", endTime: "2030-01-02T19:00:00.000Z" };
    draft.venue = { name: "Bar", address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.4, longitude: -79.9, placeId: "p1" };
    return draft;
  };

  it("keeps typed text and the place id, never the map position or any id of a person", () => {
    const snap = eventSnapshot(filled(), "12.50", null);
    expect(snap.venue).toEqual({ name: "Bar", address: "1 Main St", locality: "Pittsburgh, PA", placeId: "p1" });
    const text = JSON.stringify(snap);
    expect(text).not.toMatch(/latitude|longitude|40\.4|requestId|token|uid/i);
  });

  it("ignores an empty form and the default capacity or times", () => {
    expect(eventMeaningful(eventSnapshot(emptyDraft(), "", null))).toBe(false);
    expect(eventMeaningful(eventSnapshot({ ...emptyDraft(), startTime: "2030-01-02T18:00:00.000Z" }, "", null))).toBe(false);
    expect(eventMeaningful(eventSnapshot({ ...emptyDraft(), capacity: 12 }, "", null))).toBe(true);
    expect(eventMeaningful(eventSnapshot(emptyDraft(), "5", null))).toBe(true);
  });

  it("survives JSON, including an empty capacity", () => {
    const draft = { ...filled(), capacity: Number.NaN };
    const parsed = parseEventSnapshot(JSON.parse(JSON.stringify(eventSnapshot(draft, "", null))));
    expect(parsed?.capacity).toBeNull();
    expect(restoreEvent(parsed!, { now: new Date("2029-12-31T00:00:00Z") }).draft.capacity).toBeNaN();
  });

  it("rejects malformed and empty drafts and truncates oversize text", () => {
    expect(parseEventSnapshot(null)).toBeNull();
    expect(parseEventSnapshot({ title: "x" })).toBeNull();
    expect(parseEventSnapshot({ title: "x", venue: {} })?.title).toBe("x");
    expect(parseEventSnapshot({ title: "", venue: {} })).toBeNull();
    expect(parseEventSnapshot({ title: "x".repeat(5000), venue: {}, tagIds: [1, "a"] })?.title.length).toBeLessThan(300);
    expect(parseEventSnapshot({ title: "x", venue: {}, tagIds: [1, "a"] })?.tagIds).toEqual(["a"]);
  });

  it("flags dates that have passed and replaces them with the next free hour", () => {
    const snap = eventSnapshot(filled(), "", null);
    const future = restoreEvent(snap, { now: new Date("2029-12-31T00:00:00Z") });
    expect(future.datesReset).toBe(false);
    expect(future.draft.startTime).toBe("2030-01-02T18:00:00.000Z");
    const later = new Date("2030-02-01T10:30:00Z");
    const stale = restoreEvent(snap, { now: later });
    expect(stale.datesReset).toBe(true);
    expect(Date.parse(stale.draft.startTime)).toBeGreaterThan(later.getTime());
    expect(restoreEvent({ ...snap, startTime: "nope" }, { now: later }).datesReset).toBe(true);
    expect(restoreEvent({ ...snap, endTime: snap.startTime }, { now: new Date("2029-12-31T00:00:00Z") }).datesReset).toBe(true);
  });

  it("drops covers and tags that no longer exist", () => {
    const snap = { ...eventSnapshot(filled(), "", null), coverImageURL: "catalog://cover/gone-forever", tagIds: ["a", "b"] };
    const restored = restoreEvent(snap, { now: new Date("2029-12-31T00:00:00Z"), knownTagIds: ["b"] });
    expect(restored.draft.coverImageURL).toBe("");
    expect(restored.draft.tagIds).toEqual(["b"]);
    expect(restored.draft.venue.latitude).toBeNaN();
  });
});

describe("theme snapshot", () => {
  const theme = {
    title: "Yoga", description: "Stretch", tagIds: ["t1"], type: "weekly" as const, goal: 3, goalUnit: "classes",
    coverImageURL: THEMES[0].url, startDate: "2030-01-07T05:00:00.000Z", endDate: "2030-01-14T04:59:59.000Z", pointsReward: 50,
  };

  it("round-trips and keeps an emptied number as empty", () => {
    const parsed = parseThemeSnapshot(JSON.parse(JSON.stringify(themeSnapshot({ ...theme, goal: Number.NaN }))));
    expect(parsed?.goal).toBeNull();
    expect(restoreTheme(parsed!, ["t1"])).toMatchObject({ title: "Yoga", tagIds: ["t1"], type: "weekly" });
    expect(restoreTheme(parsed!, ["t1"]).goal).toBeNaN();
    expect(restoreTheme(parsed!, ["other"]).tagIds).toEqual([]);
  });

  it("rejects a theme art that is not in the catalog", () => {
    expect(parseThemeSnapshot({ ...themeSnapshot(theme), coverImageURL: "https://evil.example/x.png" })).toBeNull();
    expect(parseThemeSnapshot("nope")).toBeNull();
  });
});
