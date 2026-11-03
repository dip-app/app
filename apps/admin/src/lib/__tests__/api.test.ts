import { describe, expect, it } from "vitest";
import { type KeyValueStore, createMockApi } from "../api";
import { ApiError, type EventDraft, emptyDraft, validateDraft } from "../contract";
import { dollarsToCents } from "../datetime";

const NOW = new Date("2026-11-03T12:00:00Z");

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function validDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    ...emptyDraft(),
    title: "Trivia night",
    description: "Teams of four.",
    coverImageURL: "catalog://default/games",
    startTime: "2026-11-10T22:00:00.000Z",
    endTime: "2026-11-10T23:30:00.000Z",
    venue: { name: "Pub", address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.44, longitude: -79.99 },
    capacity: 10,
    ...overrides,
  };
}

async function signedIn(persona: "admin" | "member" = "admin") {
  const api = createMockApi(memoryStore(), () => NOW);
  await api.signIn(persona);
  return api;
}

async function code(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (e) { return e instanceof ApiError ? e.code : "other"; }
  return "ok";
}

describe("validateDraft", () => {
  it("accepts a complete future draft", () => {
    expect(validateDraft(validDraft(), { requireFuture: true, now: NOW })).toEqual({});
  });
  it("rejects bad times, capacity, coordinates and price", () => {
    const errors = validateDraft(
      validDraft({ endTime: "2026-11-10T21:00:00.000Z", capacity: 0, costCents: -1, venue: { ...validDraft().venue, latitude: 91, longitude: -181 } }),
      { requireFuture: true, now: NOW });
    expect(Object.keys(errors).sort()).toEqual(["capacity", "costCents", "endTime", "venue.latitude", "venue.longitude"]);
  });
  it("requires a future start only when creating", () => {
    const past = validDraft({ startTime: "2026-11-01T10:00:00.000Z", endTime: "2026-11-01T11:00:00.000Z" });
    expect(validateDraft(past, { requireFuture: true, now: NOW }).startTime).toBeDefined();
    expect(validateDraft(past, { requireFuture: false })).toEqual({});
  });
  it("keeps capacity at or above people already going", () => {
    expect(validateDraft(validDraft({ capacity: 5 }), { requireFuture: true, now: NOW, minCapacity: 8 }).capacity).toBeDefined();
  });
});

describe("price entry", () => {
  it("converts dollars to integer cents and rejects junk", () => {
    expect(dollarsToCents("12.50")).toBe(1250);
    expect(dollarsToCents("")).toBe(0);
    expect(dollarsToCents("0.1")).toBe(10);
    expect(Number.isNaN(dollarsToCents("1.234"))).toBe(true);
    expect(Number.isNaN(dollarsToCents("-3"))).toBe(true);
  });
});

describe("mock API authorization", () => {
  it("rejects signed-out and member callers", async () => {
    const api = createMockApi(memoryStore(), () => NOW);
    expect(await code(api.listEvents())).toBe("unauthenticated");
    await api.signIn("member");
    expect(await code(api.listEvents())).toBe("permission-denied");
    expect(await code(api.createEvent(crypto.randomUUID(), validDraft()))).toBe("permission-denied");
  });
});

describe("createEvent", () => {
  it("assigns server fields", async () => {
    const api = await signedIn();
    const { eventId, revision } = await api.createEvent(crypto.randomUUID(), validDraft());
    const event = await api.getEvent(eventId);
    expect(revision).toBe(1);
    expect(event).toMatchObject({ companyId: "acme", status: "scheduled", attendeeCount: 0, pointsValue: 0, revision: 1, createdBy: "uid-admin" });
  });
  it("returns the same event for a retry and rejects a changed payload", async () => {
    const api = await signedIn();
    const requestId = crypto.randomUUID();
    const first = await api.createEvent(requestId, validDraft());
    const again = await api.createEvent(requestId, validDraft());
    expect(again).toEqual(first);
    expect((await api.listEvents()).filter((e) => e.title === "Trivia night")).toHaveLength(1);
    expect(await code(api.createEvent(requestId, validDraft({ title: "Other" })))).toBe("invalid-argument");
  });
});

describe("updateEvent", () => {
  it("increments revision and rejects stale edits", async () => {
    const api = await signedIn();
    const { eventId } = await api.createEvent(crypto.randomUUID(), validDraft());
    const loaded = await api.getEvent(eventId);
    const saved = await api.updateEvent(eventId, 1, { ...loaded, title: "Trivia night!" }, "scheduled");
    expect(saved.revision).toBe(2);
    expect(await code(api.updateEvent(eventId, 1, { ...loaded, title: "Stale" }, "scheduled"))).toBe("aborted");
    expect((await api.getEvent(eventId)).title).toBe("Trivia night!");
  });
  it("cannot drop capacity below attendees and can cancel without deleting", async () => {
    const api = await signedIn();
    const events = await api.listEvents();
    const full = events.find((e) => e.id === "kayaking")!;
    expect(await code(api.updateEvent(full.id, full.revision, { ...full, capacity: 5 }, "scheduled"))).toBe("invalid-argument");
    await api.updateEvent(full.id, full.revision, full, "cancelled");
    expect((await api.getEvent(full.id)).status).toBe("cancelled");
  });
});
