// @vitest-environment jsdom
// New event and New theme autosave: the restore banner, restoring, starting fresh, discarding and clearing on publish.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type DraftStore, draftKey, readDraft, writeDraft } from "@/lib/formDraft";
import { eventSnapshot, parseEventSnapshot, parseThemeSnapshot, themeSnapshot } from "@/lib/formDraftSnapshots";
import { emptyDraft } from "@/lib/contract";
import { THEMES } from "@/lib/themes";
import { setLocale } from "@/lib/i18n";
import { stubLocalStorage } from "./storageStub";

const push = vi.fn();
const createEvent = vi.fn(async () => ({ eventId: "e1", revision: 1 }));
const createTheme = vi.fn(async () => ({ challengeId: "t1", revision: 1 }));
const session = { uid: "u1", companyId: "c1", name: "A", email: "a@b.c", role: "admin" };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../AppProvider", () => ({
  useApp: () => ({
    session,
    api: {
      tagStats: async () => [], listThemes: async () => [], createEvent, createTheme, resolvePlace: async () => ({ placeId: "p1", name: null, address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.4, longitude: -79.9, kind: "other", setting: "unknown" }),
    },
  }),
}));
vi.mock("../TagCatalog", () => ({
  useTags: () => ({ status: "ready", tags: [{ id: "tag-a", name: "Games" }], reload: () => {} }),
}));
vi.mock("../Toast", () => ({ toast: vi.fn() }));
vi.mock("../CoverPicker", () => ({
  CoverPicker: ({ value, onChange }: { value: string; onChange: (url: string, by: string) => void }) => (
    <button type="button" id="cover-first" onClick={() => onChange("catalog://default/games", "admin")}>cover:{value || "none"}</button>
  ),
}));
vi.mock("../WhereSection", () => ({
  WhereSection: ({ venue, onVenue }: { venue: { name: string; address: string; locality: string }; onVenue: (p: object) => void }) => (
    <div>
      <input aria-label="venue name" value={venue.name} onChange={(e) => onVenue({ name: e.target.value })} />
      <input aria-label="venue address" value={venue.address} onChange={(e) => onVenue({ address: e.target.value })} />
      <input aria-label="venue city" value={venue.locality} onChange={(e) => onVenue({ locality: e.target.value })} />
    </div>
  ),
}));
vi.mock("../WhenPicker", () => ({
  WhenPicker: ({ startTime, onChange }: { startTime: string; onChange: (a: string, b: string) => void }) => (
    <button type="button" onClick={() => onChange("2031-01-01T10:00:00.000Z", "2031-01-01T11:00:00.000Z")}>when:{startTime}</button>
  ),
}));
vi.mock("../EventPreview", () => ({ EventPreview: () => null }));
vi.mock("../ThemePreview", () => ({ ThemePreview: () => null }));
vi.mock("../ThemeArt", () => ({ ThemeArt: () => null }));

import { EventForm } from "../EventForm";
import { ThemeForm } from "../ThemeForm";

const eventKey = draftKey("event", { uid: "u1", companyId: "c1" });
const themeKey = draftKey("theme", { uid: "u1", companyId: "c1" });
let storage: Storage;
const FUTURE = "2099-05-05T18:00:00.000Z";
const FUTURE_END = "2099-05-05T19:00:00.000Z";

function seedEvent(over: Partial<ReturnType<typeof emptyDraft>> = {}, savedAt = Date.now() - 5 * 60_000) {
  const draft = { ...emptyDraft(), title: "Trivia night", description: "Teams of four", startTime: FUTURE, endTime: FUTURE_END, ...over };
  draft.venue = { ...draft.venue, name: "The Pub", address: "1 Main St", locality: "Pittsburgh, PA" };
  writeDraft(storage as DraftStore, eventKey, eventSnapshot(draft, "12.50", null), savedAt);
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
beforeEach(() => {
  storage = stubLocalStorage();
  const session$ = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => session$.get(k) ?? null, setItem: (k: string, v: string) => { session$.set(k, v); }, removeItem: (k: string) => { session$.delete(k); } });
  push.mockClear(); createEvent.mockClear(); createTheme.mockClear();
});
afterEach(() => { cleanup(); setLocale("en"); vi.useRealTimers(); });

describe("New event draft", () => {
  it("shows nothing when there is no draft, and a quiet saved line only after typing", async () => {
    vi.useFakeTimers();
    render(<EventForm />);
    expect(screen.queryByText(/unfinished event draft/)).toBeNull();
    expect(screen.queryByText("Draft saved on this device")).toBeNull();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pizza" } });
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByText("Draft saved on this device")).toBeTruthy();
    expect(parseEventSnapshot(readDraft(storage as DraftStore, eventKey, (r) => r)?.data)?.title).toBe("Pizza");
  });

  it("offers a draft with its age, and Restore fills every field and moves focus to the title", async () => {
    seedEvent({ costNote: "Cash only", isOutdoor: true, capacity: 12, tagIds: ["tag-a"] });
    render(<EventForm />);
    expect(await screen.findByText("You have an unfinished event draft, saved 5 minutes ago.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Trivia night");
    expect((screen.getByLabelText("venue address") as HTMLInputElement).value).toBe("1 Main St");
    expect((screen.getByLabelText("venue city") as HTMLInputElement).value).toBe("Pittsburgh, PA");
    expect((document.getElementById("price") as HTMLInputElement).value).toBe("12.50");
    expect((document.getElementById("capacity") as HTMLInputElement).value).toBe("12");
    expect((document.getElementById("note") as HTMLInputElement).value).toBe("Cash only");
    expect(screen.getByText(`when:${FUTURE}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Games/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/unfinished event draft/)).toBeNull();
    expect(screen.getByText("Draft restored. Check everything before you continue.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
  });

  it("flags dates that have passed instead of keeping them", async () => {
    seedEvent({ startTime: "2020-01-01T10:00:00.000Z", endTime: "2020-01-01T11:00:00.000Z" });
    render(<EventForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore draft" }));
    expect(screen.getByText(/Its date had passed/)).toBeTruthy();
    expect(screen.queryByText(/when:2020/)).toBeNull();
  });

  it("Start fresh asks first, then deletes the draft", async () => {
    seedEvent();
    render(<EventForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Start fresh" }));
    expect(screen.getByText("Discard the saved draft?")).toBeTruthy();
    expect(storage.getItem(eventKey)).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Start fresh" }).at(-1)!);
    await waitFor(() => expect(storage.getItem(eventKey)).toBeNull());
    expect(screen.queryByText(/unfinished event draft/)).toBeNull();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  });

  it("restoring over a page that already has content asks first and names the age", async () => {
    seedEvent();
    render(<EventForm />);
    await screen.findByText(/unfinished event draft/);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Something else" } });
    expect(screen.getByText(/You also have an older draft, saved 5 minutes ago/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));
    expect(screen.getByText("Replace what is on this page?")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Something else");
    fireEvent.click(screen.getAllByRole("button", { name: "Restore draft" }).at(-1)!);
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Trivia night"));
  });

  it("Dipbot's hand-off wins over an older autosaved draft, which is offered rather than overwritten", async () => {
    seedEvent();
    window.history.pushState({}, "", "/events/new/?from=ai");
    sessionStorage.setItem("dip.aiDraft.v1", JSON.stringify({
      draft: { title: "Dipbot idea", description: "From Dipbot", tagIds: ["tag-a"], coverImageURL: "", costCents: 0, costNote: "", capacity: 8, isOutdoor: false, coverBy: "dipbot" },
      savedAt: Date.now(),
    }));
    render(<EventForm />);
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Dipbot idea"));
    expect(screen.getByText(/You also have an older draft, saved 5 minutes ago/)).toBeTruthy();
    window.history.pushState({}, "", "/");
  });

  it("Cancel on a started event confirms, then deletes the draft; with nothing typed it just leaves and keeps an offered draft", async () => {
    seedEvent();
    const { unmount } = render(<EventForm />);
    await screen.findByText(/unfinished event draft/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(push).toHaveBeenCalledWith("/events/");
    expect(storage.getItem(eventKey)).not.toBeNull();
    unmount();
    push.mockClear();

    storage.removeItem(eventKey);
    render(<EventForm />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bingo" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard this draft?")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/"));
    expect(storage.getItem(eventKey)).toBeNull();
  });

  it("publishing clears the draft", async () => {
    seedEvent();
    render(<EventForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore draft" }));
    fireEvent.click(screen.getByRole("button", { name: /cover:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/"));
    expect(storage.getItem(eventKey)).toBeNull();
  });

  it("works with storage blocked: no offer, no crash, and the browser's leave dialog protects the typing", async () => {
    vi.useFakeTimers();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    vi.stubGlobal("localStorage", blocked);
    Object.defineProperty(window, "localStorage", { value: blocked, configurable: true });
    render(<EventForm />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pizza" } });
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByText(/Draft not saved/)).toBeTruthy();
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
  });

  it("reads Spanish", async () => {
    setLocale("es");
    seedEvent();
    render(<EventForm />);
    expect(await screen.findByText("Tienes un borrador de evento sin terminar, guardado hace 5 minutos.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restaurar borrador" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Empezar de cero" })).toBeTruthy();
  });
});

describe("New theme draft", () => {
  const theme = () => ({
    title: "Yoga week", description: "Stretch daily", tagIds: ["tag-a"], type: "weekly" as const, goal: 5, goalUnit: "classes",
    coverImageURL: THEMES[1].url, startDate: "2020-01-06T05:00:00.000Z", endDate: "2020-01-13T04:59:59.000Z", pointsReward: 75,
  });

  it("autosaves after an edit and offers the draft next time; weeks that have passed are replaced and flagged", async () => {
    writeDraft(storage as DraftStore, themeKey, themeSnapshot(theme()), Date.now() - 2 * 3_600_000);
    render(<ThemeForm />);
    expect(await screen.findByText("You have an unfinished theme draft, saved 2 hours ago.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Yoga week");
    expect((document.getElementById("goal") as HTMLInputElement).value).toBe("5");
    expect((document.getElementById("unit") as HTMLInputElement).value).toBe("classes");
    expect((document.getElementById("points") as HTMLInputElement).value).toBe("75");
    expect(screen.getByText(/weeks were no longer free/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Games" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
  });

  it("saves edits, and creating the theme clears the draft", async () => {
    vi.useFakeTimers();
    render(<ThemeForm />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Custom" } });
    act(() => { vi.advanceTimersByTime(900); });
    expect(parseThemeSnapshot(readDraft(storage as DraftStore, themeKey, (r) => r)?.data)?.title).toBe("Custom");
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
    await waitFor(() => expect(createTheme).toHaveBeenCalled());
    expect(storage.getItem(themeKey)).toBeNull();
  });

  it("an untouched form leaves a waiting draft alone", async () => {
    vi.useFakeTimers();
    writeDraft(storage as DraftStore, themeKey, themeSnapshot(theme()), Date.now());
    render(<ThemeForm />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(parseThemeSnapshot(readDraft(storage as DraftStore, themeKey, (r) => r)?.data)?.title).toBe("Yoga week");
  });
});
