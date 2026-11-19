import { describe, expect, it, vi } from "vitest";
import { ApiError, type Venue, emptyDraft, normalizeDraft, reviveStashedDraft, validateDraft } from "../contract";
import { FAKE_PLACES, createFakeProvider, fakeAutocomplete, fakeResolve } from "../location/fake";
import { createCallableProvider } from "../location/index";
import { applyOutcome, planLocation, resolveTyped } from "../location/saveLocation";
import { LocationError, type ResolvedPlace } from "../location/types";
import { placeToVenue, venueOptionToVenue } from "../location/venueFill";
import { highlightParts } from "../location/highlight";
import { buildVenueRequest, readRadius, saveRadius } from "../venues";
import { MOCK_OFFICE, mockVenues } from "../venuesMock";

const PARK = FAKE_PLACES.find((p) => p.placeId === "fake-schenley")!;
const STREET = FAKE_PLACES.find((p) => p.placeId === "fake-forbes")!;

describe("fake provider and fake data", () => {
  it("suggests by word prefix, at most 5, as typeahead rows", async () => {
    const rows = fakeAutocomplete("pittsburgh");
    expect(rows.length).toBe(5);
    expect(rows[0]).toEqual({ placeId: "fake-schenley", primary: "Schenley Park", secondary: "Panther Hollow Rd, Pittsburgh, PA", isPlace: true });
    expect(fakeAutocomplete("412 forbes")[0]).toMatchObject({ primary: "412 Forbes Avenue", secondary: "Pittsburgh, PA", isPlace: false });
    expect(fakeAutocomplete("zzzz")).toEqual([]);
    // A typed street address no canned place matches comes back as one suggestion that resolves by id (like Places).
    const [typed] = fakeAutocomplete("600 grant street, Pittsburgh, PA");
    expect(typed).toMatchObject({ primary: "600 Grant Street", secondary: "Pittsburgh, PA", isPlace: false });
    expect(fakeResolve({ placeId: typed.placeId })).toMatchObject({ address: "600 Grant Street", locality: "Pittsburgh, PA" });
    expect(fakeAutocomplete("grant street")).toEqual([]);
    expect(await createFakeProvider().autocomplete("schenley", { sessionToken: "t" })).toHaveLength(2); // Schenley Park and Phipps (1 Schenley Dr)
  });
  it("resolves by id and by typed text, and says not found otherwise", () => {
    expect(fakeResolve({ placeId: "fake-schenley" })).toMatchObject({ name: "Schenley Park", setting: "outdoor", latitude: 40.4354 });
    expect(fakeResolve({ placeId: "nope" })).toBeNull();
    expect(fakeResolve({ query: "412 Forbes Avenue, Pittsburgh, PA" })?.placeId).toBe("fake-forbes");
    expect(fakeResolve({ query: "77 Imaginary Way, Pittsburgh, PA" })).toMatchObject({ name: null, address: "77 Imaginary Way", latitude: 40.4406 });
    expect(fakeResolve({ query: "zzzz" })).toBeNull();
  });
  it("can fail like the server and honors abort", async () => {
    await expect(createFakeProvider({ fail: "limit" }).autocomplete("forbes", { sessionToken: "t" })).rejects.toMatchObject({ kind: "limit" });
    const controller = new AbortController();
    controller.abort();
    await expect(createFakeProvider().autocomplete("forbes", { sessionToken: "t", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("callable provider", () => {
  const api = (over: object = {}) => ({ autocompletePlaces: vi.fn(async () => fakeAutocomplete("forbes")), resolvePlace: vi.fn(async () => PARK as ResolvedPlace | null), ...over });
  it("passes the input, session token and place id through the callables", async () => {
    const a = api();
    const provider = createCallableProvider(a);
    await provider.autocomplete("forb", { sessionToken: "tok" });
    expect(a.autocompletePlaces).toHaveBeenCalledWith("forb", "tok");
    await provider.resolve({ placeId: "p1", sessionToken: "tok" });
    expect(a.resolvePlace).toHaveBeenCalledWith({ placeId: "p1", sessionToken: "tok" });
  });
  it("maps PLACES_DISABLED and PLACES_LIMIT, and everything else to failed", async () => {
    const kind = async (error: unknown) => (await createCallableProvider(api({ autocompletePlaces: async () => { throw error; } })).autocomplete("forb", { sessionToken: "t" }).catch((e) => e)).kind;
    expect(await kind(new ApiError("failed-precondition", "x", {}, "PLACES_DISABLED"))).toBe("disabled");
    expect(await kind(new ApiError("resource-exhausted", "x", {}, "PLACES_LIMIT"))).toBe("limit");
    expect(await kind(new Error("offline"))).toBe("failed");
  });
  it("treats PLACE_NOT_FOUND as not found for a typed address (null) and reports it for a stale place id", async () => {
    const gone = createCallableProvider(api({ resolvePlace: async () => { throw new ApiError("not-found", "x", {}, "PLACE_NOT_FOUND"); } }));
    expect(await gone.resolve({ query: "1 Nowhere St" })).toBeNull();
    await expect(gone.resolve({ placeId: "stale" })).rejects.toMatchObject({ kind: "notFound" });
  });
  it("ignores an answer that arrives after the caller aborted", async () => {
    const controller = new AbortController();
    const provider = createCallableProvider(api({ autocompletePlaces: () => new Promise((resolve) => setTimeout(() => resolve([]), 5)) }));
    const pending = provider.autocomplete("forb", { sessionToken: "t", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("form fill mapping", () => {
  it("fills name, street, city, position and place id from a named place, and outdoor from the setting", () => {
    const fill = placeToVenue(PARK, { name: "Old name" });
    expect(fill.patch).toEqual({ name: "Schenley Park", address: "Panther Hollow Rd", locality: "Pittsburgh, PA", latitude: 40.4354, longitude: -79.9433, placeId: "fake-schenley" });
    expect(fill.outdoor).toBe(true);
    expect(fill.primary).toBe("Schenley Park");
  });
  it("keeps the venue name already typed for a plain street address; indoor and unknown are not outdoor", () => {
    expect(placeToVenue(STREET, { name: "Team lunch spot" }).patch.name).toBe("Team lunch spot");
    expect(placeToVenue(STREET, { name: "" }).patch.name).toBe("");
    expect(placeToVenue(STREET, { name: "" }).outdoor).toBe(false);
    expect(placeToVenue({ ...PARK, setting: "indoor" }, { name: "" }).outdoor).toBe(false);
  });
  it("maps a Dipbot venue including its place id; outdoor only when its setting says so", () => {
    const option = { id: "v", placeId: "gp1", name: "Point State Park", address: "601 Commonwealth Pl", locality: "Pittsburgh, PA", latitude: 40.44, longitude: -80.01, kind: "park" as const, setting: "outdoor" as const, distanceMiles: 0.5, website: null, reasons: [] };
    expect(venueOptionToVenue(option)).toMatchObject({ patch: { name: "Point State Park", address: "601 Commonwealth Pl", latitude: 40.44, longitude: -80.01, placeId: "gp1" }, outdoor: true });
    expect(venueOptionToVenue({ ...option, setting: "indoor" }).outdoor).toBe(false);
  });
});

describe("save location step", () => {
  const saved: Venue = { name: "Pub", address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.4, longitude: -79.9, placeId: "p1" };
  const typed: Venue = { name: "Pub", address: "77 Imaginary Way", locality: "Pittsburgh, PA", latitude: Number.NaN, longitude: Number.NaN };
  const forSaved = { address: "1 Main St", locality: "Pittsburgh, PA" };

  it("keeps stored coordinates when an existing event's address is unchanged (even with other edits and different casing)", () => {
    expect(planLocation(saved, forSaved, true)).toEqual({ action: "keep" });
    expect(planLocation({ ...saved, name: "Other pub", address: " 1  main st " }, forSaved, true)).toEqual({ action: "keep" });
    expect(applyOutcome({ action: "keep" }, null, saved).venue).toEqual(saved);
  });
  it("resolves when the text changed, or when the coordinates were dropped, or there is no resolved text", () => {
    expect(planLocation({ ...saved, address: "2 Main St" }, forSaved, true)).toEqual({ action: "resolve", lenient: false });
    expect(planLocation({ ...saved, locality: "Erie, PA" }, forSaved, true)).toEqual({ action: "resolve", lenient: false });
    expect(planLocation(typed, null, false)).toEqual({ action: "resolve", lenient: false });
  });
  it("legacy 0/0 event with an unchanged address resolves once but never blocks", () => {
    const legacy = { ...saved, latitude: 0, longitude: 0, placeId: undefined };
    const withText = planLocation(legacy, forSaved, true); // the form records a saved event's own address as resolved
    expect(withText).toEqual({ action: "resolve", lenient: true });
    expect(planLocation({ ...legacy, address: "9 New St" }, forSaved, true)).toEqual({ action: "resolve", lenient: false });
    for (const outcome of [{ kind: "notFound" }, { kind: "error" }] as const) {
      const applied = applyOutcome(withText, outcome, legacy);
      expect(applied.error).toBeUndefined();
      expect(applied.venue).toMatchObject({ latitude: 0, longitude: 0 });
    }
  });
  it("a found address fills position and place id and keeps the admin's own text", () => {
    const place = { ...PARK, address: "77 Imaginary Way (resolved)", latitude: 40.5, longitude: -80.1, placeId: "px" };
    const applied = applyOutcome({ action: "resolve", lenient: false }, { kind: "found", place }, typed);
    expect(applied.venue).toEqual({ ...typed, latitude: 40.5, longitude: -80.1, placeId: "px" });
    expect(applied.error).toBeUndefined();
  });
  it("not found blocks with the address message and never asks for coordinates", () => {
    const applied = applyOutcome({ action: "resolve", lenient: false }, { kind: "notFound" }, typed);
    expect(applied.error).toBe("We couldn’t find that address. Pick one from the suggestions.");
    expect(applied.venue).toBe(typed);
  });
  it("Places off saves without a map location; other failures block", () => {
    const off = applyOutcome({ action: "resolve", lenient: false }, { kind: "disabled" }, typed);
    expect(off).toMatchObject({ noMapLocation: true, venue: { latitude: 0, longitude: 0, placeId: null } });
    expect(off.error).toBeUndefined();
    expect(applyOutcome({ action: "resolve", lenient: false }, { kind: "error" }, typed).error).toBe("Couldn’t check the address right now. Pick a suggestion or try again.");
  });
  it("never sends NaN", () => {
    expect(applyOutcome({ action: "keep" }, null, typed).venue).toMatchObject({ latitude: 0, longitude: 0 });
    expect(applyOutcome({ action: "resolve", lenient: true }, { kind: "error" }, typed).venue).toMatchObject({ latitude: 0, longitude: 0 });
  });
  it("resolveTyped asks with 'street, city' and maps failures", async () => {
    const resolve = vi.fn(async () => PARK as ResolvedPlace | null);
    expect(await resolveTyped(resolve, typed)).toEqual({ kind: "found", place: PARK });
    expect(resolve).toHaveBeenCalledWith({ query: "77 Imaginary Way, Pittsburgh, PA" });
    expect(await resolveTyped(async () => null, typed)).toEqual({ kind: "notFound" });
    expect(await resolveTyped(async () => { throw new ApiError("failed-precondition", "x", {}, "PLACES_DISABLED"); }, typed)).toEqual({ kind: "disabled" });
    expect(await resolveTyped(async () => { throw new LocationError("disabled"); }, typed)).toEqual({ kind: "disabled" });
    expect(await resolveTyped(async () => { throw new ApiError("not-found", "x", {}, "PLACE_NOT_FOUND"); }, typed)).toEqual({ kind: "notFound" });
    expect(await resolveTyped(async () => { throw new ApiError("resource-exhausted", "x", {}, "PLACES_LIMIT"); }, typed)).toEqual({ kind: "error" });
    expect(await resolveTyped(async () => { throw new Error("offline"); }, typed)).toEqual({ kind: "error" });
  });
});

describe("highlight", () => {
  it("marks typed words where they start a word, case-insensitively", () => {
    expect(highlightParts("Schenley Park", "sch pa")).toEqual([{ text: "Sch", match: true }, { text: "enley ", match: false }, { text: "Pa", match: true }, { text: "rk", match: false }]);
    expect(highlightParts("a.b (c)", "(")).toEqual([{ text: "a.b (c)", match: false }]);
  });
});

describe("draft coordinates and place id", () => {
  const base = () => ({ ...emptyDraft(), title: "T", description: "D", coverImageURL: "catalog://x", startTime: "2030-01-01T10:00:00Z", endTime: "2030-01-01T11:00:00Z", venue: { name: "V", address: "1 Main", locality: "Pittsburgh, PA", latitude: Number.NaN, longitude: Number.NaN } });
  it("starts unset (NaN) and the client no longer asks for coordinates", () => {
    expect(Number.isNaN(emptyDraft().venue.latitude)).toBe(true);
    expect(validateDraft(base(), { requireFuture: false })).toEqual({});
  });
  it("keeps range validation as a safety net on the address field", () => {
    const errors = validateDraft({ ...base(), venue: { ...base().venue, latitude: 91, longitude: 10 } }, { requireFuture: false });
    expect(Object.keys(errors)).toEqual(["venue.address"]);
  });
  it("restores null coordinates to NaN after the editor stash round trip", () => {
    const revived = reviveStashedDraft(JSON.parse(JSON.stringify(emptyDraft())));
    expect(Number.isNaN(revived.venue.latitude) && Number.isNaN(revived.venue.longitude)).toBe(true);
    expect(reviveStashedDraft(JSON.parse(JSON.stringify({ ...emptyDraft(), venue: { ...emptyDraft().venue, latitude: 40.4, longitude: -79.9 } }))).venue).toMatchObject({ latitude: 40.4, longitude: -79.9 });
  });
  it("sends the place id only when there is one, and never a server-owned field", () => {
    const withPlace = normalizeDraft({ ...base(), venue: { ...base().venue, latitude: 1, longitude: 2, placeId: "p1" } });
    expect(withPlace.venue.placeId).toBe("p1");
    expect("placeId" in normalizeDraft({ ...base(), venue: { ...base().venue, latitude: 1, longitude: 2, placeId: null } }).venue).toBe(false);
    expect(JSON.stringify(withPlace)).not.toContain("venueLocationAt");
  });
});

describe("venue request and radius", () => {
  it("builds the request from the event text, trimmed, with only the hints that are set", () => {
    expect(buildVenueRequest({ title: "  ", tagIds: [] }, 5, "r1")).toBeNull();
    expect(buildVenueRequest({ title: " Picnic ", description: " ", tagIds: ["tag-outdoors"], isOutdoor: true, capacity: 20, costCents: 0 }, 3, "r2")).toEqual({ requestId: "r2", title: "Picnic", radiusMiles: 3, tagIds: ["tag-outdoors"], isOutdoor: true, capacity: 20, costCents: 0 });
    expect(buildVenueRequest({ title: "Picnic", capacity: Number.NaN, costCents: Number.NaN }, 5, "r3")).toEqual({ requestId: "r3", title: "Picnic", radiusMiles: 5 });
  });
  it("remembers the radius with try/catch around storage", () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readRadius(store)).toBe(5);
    saveRadius(10, store);
    expect(readRadius(store)).toBe(10);
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readRadius(blocked)).toBe(5);
    expect(() => saveRadius(3, blocked)).not.toThrow();
  });
  it("the mock returns deterministic nearest-first venues with place ids inside the radius", () => {
    const wide = mockVenues({ requestId: "r", title: "x", radiusMiles: 25 }, MOCK_OFFICE);
    expect(wide.length).toBeGreaterThanOrEqual(3);
    expect(wide.every((v) => v.placeId && v.website === null)).toBe(true);
    expect(wide.map((v) => v.distanceMiles)).toEqual([...wide.map((v) => v.distanceMiles)].sort((a, b) => a - b));
    expect(mockVenues({ requestId: "r", title: "x", radiusMiles: 1 }, MOCK_OFFICE).every((v) => v.distanceMiles <= 1)).toBe(true);
  });
});
