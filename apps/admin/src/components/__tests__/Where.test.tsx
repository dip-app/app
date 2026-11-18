// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type EventDraft, emptyDraft } from "@/lib/contract";
import { createFakeProvider } from "@/lib/location/fake";
import type { LocationProvider } from "@/lib/location/types";
import type { CompanyOffice, FindVenuesInput, FindVenuesResult, VenueOption } from "@/lib/venues";
import { mockVenues, MOCK_OFFICE } from "@/lib/venuesMock";
import { WhereSection } from "../WhereSection";

const CREDITS = { creditsAllowance: 500, creditsUsed: 88, creditsRemaining: 412, resetsAt: "2026-12-01T05:00:00.000Z", creditCost: { suggest: 1, generate: 10, regenerate: 10, weeklyEmail: 3, coverPick: 1, venueSearch: 1 } };

const api = {
  companyOffice: vi.fn<() => Promise<CompanyOffice | null>>(),
  setCompanyOffice: vi.fn<(r: { placeId: string; sessionToken?: string }) => Promise<CompanyOffice>>(),
  findVenues: vi.fn<(i: FindVenuesInput) => Promise<FindVenuesResult>>(),
  eventIdeaContext: vi.fn(),
};
const memory = new Map<string, string>(); // the runtime may lack a working localStorage
let role = "admin";
// One stable object per role, like the real provider: a new session each render would reload useLoad forever.
const sessions: Record<string, unknown> = {};
vi.mock("../AppProvider", () => ({ useApp: () => ({ api, session: (sessions[role] ??= { role, uid: "u", companyId: "c", name: "A" }) }) }));

const venuesResult = (venues: VenueOption[], over: Partial<FindVenuesResult> = {}): FindVenuesResult => ({ venues, provider: "google", cached: false, charged: true, radiusMiles: 5, office: MOCK_OFFICE, ...over });
const fakeProvider = (): LocationProvider => createFakeProvider();

function Harness({ provider = fakeProvider(), title = "Team picnic", initial, errors = {} }: { provider?: LocationProvider | null; title?: string; initial?: Partial<EventDraft["venue"]>; errors?: Partial<Record<string, string>> }) {
  const [draft, setDraft] = useState<EventDraft>(() => ({ ...emptyDraft(), venue: { ...emptyDraft().venue, ...initial } }));
  return (
    <>
      <WhereSection venue={draft.venue} isOutdoor={draft.isOutdoor} errors={errors} provider={provider}
        onVenue={(patch) => setDraft((d) => ({ ...d, venue: { ...d.venue, ...patch } }))} onOutdoor={(next) => setDraft((d) => ({ ...d, isOutdoor: next }))}
        event={{ title, description: "Lunch outside", tagIds: ["tag-outdoors"], capacity: 20, costCents: 0 }} />
      <output data-testid="draft">{JSON.stringify(draft.venue)}</output>
      <output data-testid="outdoor">{String(draft.isOutdoor)}</output>
    </>
  );
}
const venue = () => JSON.parse(screen.getByTestId("draft").textContent!) as Record<string, string | number | null>;
const field = (name: string) => screen.getAllByLabelText(name).find((el): el is HTMLInputElement => el instanceof HTMLInputElement)!;

beforeEach(() => {
  role = "admin";
  memory.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) });
  api.companyOffice.mockReset().mockResolvedValue(MOCK_OFFICE);
  api.setCompanyOffice.mockReset().mockResolvedValue({ address: "601 Commonwealth Pl", locality: "Pittsburgh, PA", latitude: 40.4414, longitude: -80.0107 });
  api.findVenues.mockReset().mockImplementation(async (i) => venuesResult(mockVenues(i, MOCK_OFFICE)));
  api.eventIdeaContext.mockReset().mockResolvedValue({ enabled: true, credits: CREDITS });
});
afterEach(cleanup);

async function pick(text: string, option: string) {
  // After a pick the summary replaces the input: Change brings it back.
  const change = screen.queryByRole("button", { name: "Change the address" });
  if (change) { fireEvent.click(change); await act(async () => { await Promise.resolve(); }); }
  const box = screen.getByRole("combobox", { name: "Street address" });
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  const choice = await screen.findByRole("option", { name: new RegExp(option) });
  fireEvent.click(choice);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

describe("WhereSection address search", () => {
  it("leads with the street address search and has no coordinate inputs or Advanced area", async () => {
    render(<Harness />);
    expect(screen.getAllByRole("combobox")[0].id).toBe("vaddr");
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
    expect(screen.queryByRole("button", { name: /Advanced/ })).toBeNull();
    expect(screen.getByText("Pick a result to fill the venue and city. You can also type the address yourself.")).toBeTruthy();
  });

  it("picking a park fills venue, street, city and coordinates, turns Outdoor on and tags it as Dipbot's", async () => {
    render(<Harness />);
    await pick("schenley", "Schenley Park");
    expect(venue()).toMatchObject({ name: "Schenley Park", address: "Panther Hollow Rd", locality: "Pittsburgh, PA", latitude: 40.4354, longitude: -79.9433, placeId: "fake-schenley" });
    // The summary row replaces the search input (no duplicate address).
    expect(screen.queryByRole("combobox", { name: "Street address" })).toBeNull();
    expect(screen.getByTestId("outdoor").textContent).toBe("true");
    const toggle = screen.getByRole("switch", { name: /Outdoor event/ });
    expect(within(toggle).getByText("Dipbot picked this")).toBeTruthy();
    const summary = screen.getByRole("group", { name: "Selected address" });
    expect(within(summary).getByText("Schenley Park")).toBeTruthy();
    // Change brings the input back, prefilled and focused; the summary goes away.
    fireEvent.click(within(summary).getByRole("button", { name: "Change the address" }));
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(field("Street address"));
    expect(field("Street address").value).toBe("Panther Hollow Rd");
    expect(screen.queryByRole("group", { name: "Selected address" })).toBeNull();
    // Flipping the toggle takes the tag away.
    fireEvent.click(toggle);
    expect(within(screen.getByRole("switch", { name: /Outdoor event/ })).queryByText("Dipbot picked this")).toBeNull();
  });

  it("picking a street address keeps the venue name the admin typed, and an indoor pick drops the tag but leaves the toggle", async () => {
    render(<Harness initial={{ name: "My spot" }} />);
    await pick("forbes", "412 Forbes Avenue");
    expect(venue()).toMatchObject({ name: "My spot", address: "412 Forbes Avenue", latitude: 40.4388 });
    expect(screen.getByTestId("outdoor").textContent).toBe("false");
    await pick("point", "Point State Park");
    expect(within(screen.getByRole("switch", { name: /Outdoor event/ })).getByText("Dipbot picked this")).toBeTruthy();
    await pick("primanti", "Primanti");
    expect(within(screen.getByRole("switch", { name: /Outdoor event/ })).queryByText("Dipbot picked this")).toBeNull();
    expect(screen.getByTestId("outdoor").textContent).toBe("true");
  });

  it("changing the street after a pick drops the hidden position and place id but keeps the typed text", async () => {
    render(<Harness />);
    await pick("schenley", "Schenley Park");
    expect(venue().placeId).toBe("fake-schenley");
    fireEvent.click(screen.getByRole("button", { name: "Change the address" }));
    fireEvent.change(field("Street address"), { target: { value: "Panther Hollow Road" } });
    expect(venue()).toMatchObject({ address: "Panther Hollow Road", placeId: null, latitude: null, longitude: null, name: "Schenley Park" });
    expect(screen.queryByRole("group", { name: "Selected address" })).toBeNull();
  });

  it("shows address errors, including a server coordinate error, on the address field", () => {
    render(<Harness errors={{ "venue.address": "We couldn’t find that address. Pick one from the suggestions." }} />);
    expect(screen.getByText("We couldn’t find that address. Pick one from the suggestions.")).toBeTruthy();
    expect(field("Street address").getAttribute("aria-invalid")).toBe("true");
    cleanup();
    render(<Harness errors={{ "venue.latitude": "Latitude is −90 to 90." }} />);
    expect(screen.getByText("Latitude is −90 to 90.")).toBeTruthy();
  });

  it("falls back to plain fields with a quiet hint when Places is not set up", () => {
    render(<Harness provider={null} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Address search is not set up, so this event won’t have a map location.")).toBeTruthy();
    fireEvent.change(field("Street address"), { target: { value: "1 Main St" } });
    fireEvent.change(field("Venue name"), { target: { value: "Pub" } });
    expect(venue()).toMatchObject({ address: "1 Main St", name: "Pub" });
  });

  it("switches to plain fields when the first search finds Places disabled", async () => {
    render(<Harness provider={createFakeProvider({ fail: "disabled" })} />);
    const box = screen.getByRole("combobox", { name: "Street address" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "forbes" } });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Street address" })).toBeNull(), { timeout: 2000 });
    expect(field("Street address").value).toBe("forbes");
    expect(screen.getByText(/won’t have a map location/)).toBeTruthy();
  });
});

describe("DipbotVenues", () => {
  const find = () => screen.findByRole("button", { name: /Find venues near your office/ });

  it("sits last in the section, after the venue fields and the Outdoor toggle", async () => {
    const { container } = render(<Harness />);
    await find();
    const order = ["#vname", ".toggle", ".venues"].map((q) => container.querySelector(q)!);
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".where")!.lastElementChild).toBe(order[2]);
  });

  it("looks disabled without a title (aria-disabled, hint linked) and sends nothing", async () => {
    render(<Harness title="" />);
    const button = await find();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const hint = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toBe("Add a title so Dipbot knows what to look for.");
    fireEvent.click(button);
    expect(api.findVenues).not.toHaveBeenCalled();
  });

  it("uses one Change link style and labels the office one Change office", async () => {
    const { container } = render(<Harness />);
    await find();
    const link = await screen.findByRole("button", { name: "Change office" });
    expect(container.querySelectorAll(".where-link").length).toBe(1);
    fireEvent.click(link);
    expect(screen.getByText("Set your office address to find venues nearby.")).toBeTruthy();
  });

  it("does not run on mount; it waits for the click", async () => {
    render(<Harness />);
    await find();
    expect(api.findVenues).not.toHaveBeenCalled();
    expect(screen.getByText(/Near 500 Grant Street, Pittsburgh, PA, within/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find venues near your office, 1 credit" })).toBeTruthy();
  });

  it("is admin only, and hidden when Dipbot is off", async () => {
    role = "organizer";
    const view = render(<Harness />);
    await waitFor(() => expect(api.eventIdeaContext).toHaveBeenCalled());
    expect(screen.queryByText("Dipbot venues")).toBeNull();
    view.unmount();
    role = "admin";
    api.eventIdeaContext.mockResolvedValue({ enabled: false, credits: CREDITS });
    render(<Harness />);
    await waitFor(() => expect(api.eventIdeaContext).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Dipbot venues")).toBeNull();
  });

  it("asks for a title first and sends nothing without one", async () => {
    render(<Harness title="  " />);
    fireEvent.click(await find());
    expect(screen.getAllByText("Add a title so Dipbot knows what to look for.").length).toBeGreaterThan(0);
    expect(api.findVenues).not.toHaveBeenCalled();
  });

  it("sends the event text, radius and a fresh requestId per click, shows loading, then the cards", async () => {
    let release: (r: FindVenuesResult) => void = () => {};
    api.findVenues.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText("Search radius"), { target: { value: "10" } });
    expect(memory.get("dip.venueRadius.v1")).toBe("10");
    fireEvent.click(await find());
    expect(screen.getByText("Dipbot is looking nearby…")).toBeTruthy();
    expect(api.findVenues.mock.calls[0][0]).toMatchObject({ title: "Team picnic", description: "Lunch outside", tagIds: ["tag-outdoors"], isOutdoor: false, capacity: 20, costCents: 0, radiusMiles: 10 });
    await act(async () => { release(venuesResult(mockVenues({ requestId: "x", title: "t", radiusMiles: 10 }, MOCK_OFFICE), { radiusMiles: 10 })); await Promise.resolve(); });
    const list = screen.getByRole("list", { name: "Venues near your office" });
    const cards = within(list).getAllByRole("button");
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.length).toBeLessThanOrEqual(5);
    expect(cards[0].textContent).toMatch(/Point State Park.*Park · \d\.\d mi · Outdoor.*Fits the theme/);
    expect(list.textContent).not.toMatch(/\$|star|rating|open until/i);
    const credit = document.querySelector(".venues-credit")!;
    expect(credit.textContent).toBe("Google Maps");
    expect(credit.getAttribute("translate")).toBe("no");
    fireEvent.click(await find());
    await waitFor(() => expect(api.findVenues).toHaveBeenCalledTimes(2));
    expect(api.findVenues.mock.calls[0][0].requestId).not.toBe(api.findVenues.mock.calls[1][0].requestId);
  });

  it("clicking a venue fills the form, marks it selected and sets Outdoor for an outdoor venue", async () => {
    render(<Harness />);
    fireEvent.click(await find());
    const card = await screen.findByRole("button", { name: "Use Point State Park" });
    fireEvent.click(card);
    expect(venue()).toMatchObject({ name: "Point State Park", address: "601 Commonwealth Pl", locality: "Pittsburgh, PA", latitude: 40.4414, longitude: -80.0107, placeId: "fake-pointstate" });
    expect(screen.getByTestId("outdoor").textContent).toBe("true");
    expect(screen.getByRole("button", { name: "Use Point State Park" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Selected address" })).toBeTruthy();
  });

  it("explains an empty answer with the radius", async () => {
    api.findVenues.mockResolvedValue(venuesResult([], { radiusMiles: 5 }));
    render(<Harness />);
    fireEvent.click(await find());
    expect((await screen.findAllByText("No venues found within 5 mi. Try a larger radius.")).length).toBeGreaterThan(0);
  });

  it("shows the reasons for failures: out of credits, the daily limit, a generic error, and hides when venues are switched off", async () => {
    render(<Harness />);
    api.findVenues.mockRejectedValueOnce(new ApiError("resource-exhausted", "x", {}, "AI_CREDITS_EXHAUSTED"));
    fireEvent.click(await find());
    expect(await screen.findByText(/You’ve used this month’s Dipbot credits\. They reset on/)).toBeTruthy();
    api.findVenues.mockRejectedValueOnce(new ApiError("resource-exhausted", "x", {}, "VENUE_SEARCH_LIMIT"));
    fireEvent.click(await find());
    expect(await screen.findByText("You’ve reached today’s venue searches. Try again tomorrow.")).toBeTruthy();
    api.findVenues.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(await find());
    expect(await screen.findByText("Dipbot couldn’t find venues this time. Try again.")).toBeTruthy();
    api.findVenues.mockRejectedValueOnce(new ApiError("failed-precondition", "x", {}, "AI_VENUES_DISABLED"));
    fireEvent.click(await find());
    await waitFor(() => expect(screen.queryByText("Dipbot venues")).toBeNull());
  });

  it("disables the button with the credits message when the allowance is used up", async () => {
    api.eventIdeaContext.mockResolvedValue({ enabled: true, credits: { ...CREDITS, creditsRemaining: 0 } });
    render(<Harness />);
    const button = await find();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You’ve used this month’s Dipbot credits/)).toBeTruthy();
  });

  it("sets the office when it is missing: search, pick, saved, then the find button appears", async () => {
    api.companyOffice.mockResolvedValue(null);
    render(<Harness />);
    expect(await screen.findByText("Set your office address to find venues nearby.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Find venues near your office/ })).toBeNull();
    const box = screen.getByRole("combobox", { name: "Office address" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "point state" } });
    fireEvent.click(await screen.findByRole("option", { name: /Point State Park/ }));
    await waitFor(() => expect(api.setCompanyOffice).toHaveBeenCalledWith({ placeId: "fake-pointstate", sessionToken: expect.any(String) }));
    expect(await find()).toBeTruthy();
    expect(screen.getByText(/Near 601 Commonwealth Pl, Pittsburgh, PA, within/)).toBeTruthy();
    expect(api.findVenues).not.toHaveBeenCalled();
  });

  it("falls back to the office setup when the server says it is not set", async () => {
    render(<Harness />);
    api.findVenues.mockRejectedValueOnce(new ApiError("failed-precondition", "x", {}, "OFFICE_NOT_SET"));
    fireEvent.click(await find());
    expect(await screen.findByText("Set your office address to find venues nearby.")).toBeTruthy();
  });
});
