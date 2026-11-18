// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AdminApi, type KeyValueStore, createMockApi } from "@/lib/api";
import { QUICK_KEY, armQuick } from "@/lib/dipbotTouches";

const NOW = new Date();
const memory = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
let current: { api: AdminApi } | null = null;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("../AppProvider", () => ({ useApp: () => ({ api: current!.api, session: { uid: "u" } }) }));

import { Ideas } from "../Ideas";
import { TagCatalogProvider } from "../TagCatalog";

async function open(search: string, token: boolean) {
  const api = createMockApi(memory(), () => NOW);
  await api.signIn("admin");
  const suggestions = vi.spyOn(api, "eventIdeaSuggestions");
  const drafts = vi.spyOn(api, "generateEventDrafts");
  current = { api };
  if (token) armQuick(window.sessionStorage);
  window.history.replaceState(null, "", `/${search}`);
  render(<TagCatalogProvider><Ideas /></TagCatalogProvider>);
  return { suggestions, drafts };
}
const wait = { timeout: 5000 };

beforeEach(() => { current = null; window.sessionStorage.clear(); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("quick mode (Generate suggestions from the New event page)", () => {
  it("never spends without the button's token: a bookmarked /ideas/?quick=1 shows the wizard", async () => {
    const { drafts } = await open("?quick=1", false);
    await screen.findByRole("heading", { name: "What people like" }, wait);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(drafts).not.toHaveBeenCalled();
    expect(screen.queryByText(/drafts: \d+ ready/)).toBeNull();
  });

  it("the token alone is not enough either: without ?quick=1 nothing starts and the token is kept for the link", async () => {
    const { drafts } = await open("", true);
    await screen.findByRole("heading", { name: "What people like" }, wait);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(drafts).not.toHaveBeenCalled();
  });

  it("with the token: answers every step, starts generation exactly once and lands on the results", async () => {
    const { drafts, suggestions } = await open("?quick=1", true);
    // Loading state: the illustrated writing screen, not the wizard.
    expect(await screen.findByLabelText("Generating drafts", {}, wait)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "What people like" })).toBeNull();
    await screen.findByText(/Dipbot’s drafts: 3 ready/, {}, wait);
    expect(drafts).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveBeenCalledWith(); // the free, saved answer: never a refresh
    const request = drafts.mock.calls[0]![0];
    expect(request.count).toBe(3);
    expect(request.choices.goal && request.choices.groupSize && request.choices.setting && request.choices.budget && request.choices.timing).toBeTruthy();
    // The token is single use and the link no longer carries quick=1, so a reload shows the wizard.
    expect(window.sessionStorage.getItem(QUICK_KEY)).toBeNull();
    expect(window.location.search).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(drafts).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Open in editor" }).length).toBe(3);
  });

  it("uses the suggested choices (the mock suggests a goal) rather than only defaults", async () => {
    const { drafts, suggestions } = await open("?quick=1", true);
    await screen.findByText(/Dipbot’s drafts: 3 ready/, {}, wait);
    const saved = await suggestions.mock.results[0]!.value;
    const goal = saved.suggestions.find((s: { question: string }) => s.question === "goal");
    if (goal) expect(drafts.mock.calls[0]![0].choices.goal).toBe(goal.value);
  });

  it("out of credits: explains, spends nothing and links back to the manual wizard with the choices kept", async () => {
    const { drafts } = await open("?ai=nocredits&quick=1", true);
    await screen.findByRole("button", { name: "Choose manually" }, wait);
    expect(screen.getByLabelText("Drafts could not be written").textContent).toMatch(/used this month’s Dipbot credits/);
    expect(drafts).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose manually" }));
    await screen.findByRole("heading", { name: "What people like" }, wait);
    expect(drafts).not.toHaveBeenCalled();
  });

  it("an error keeps everything and Try again retries the same request", async () => {
    const { drafts } = await open("?ai=error&quick=1", true);
    await screen.findByRole("alert", {}, wait);
    expect(drafts).toHaveBeenCalledTimes(1);
    const first = drafts.mock.calls[0]![0];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(drafts).toHaveBeenCalledTimes(2), wait);
    expect(drafts.mock.calls[1]![0]).toMatchObject({ requestId: first.requestId, choices: first.choices });
  });
});
