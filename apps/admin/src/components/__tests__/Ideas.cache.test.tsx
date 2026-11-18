// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSIDERATIONS } from "@/lib/considerations";
import { type AdminApi, type KeyValueStore, createMockApi } from "@/lib/api";

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

async function open(search: string) {
  const api = createMockApi(memory(), () => NOW);
  await api.signIn("admin");
  const suggestions = vi.spyOn(api, "eventIdeaSuggestions");
  const drafts = vi.spyOn(api, "generateEventDrafts");
  current = { api };
  window.history.replaceState(null, "", `/${search}`);
  render(<TagCatalogProvider><Ideas /></TagCatalogProvider>);
  return { suggestions, drafts };
}
const wait = { timeout: 4000 };
const refreshButton = () => screen.queryByRole("button", { name: /Refresh Dipbot suggestions/ }) as HTMLButtonElement | null;

beforeEach(() => { current = null; });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("saved suggestions: visiting is free", () => {
  it("fetches once per page load and never refetches while moving between steps", async () => {
    const { suggestions } = await open("?step=5");
    await waitFor(() => expect(suggestions).toHaveBeenCalledTimes(1), wait);
    await screen.findByRole("button", { name: /Generate drafts/ }, wait);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Tab refocus and visibility changes do not refetch either.
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(suggestions).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveBeenCalledWith();
    expect(suggestions.mock.calls.some((call) => (call[0] as { refresh?: boolean } | undefined)?.refresh)).toBe(false);
  });

  it("a fresh saved answer shows a quiet 'Updated' line and says this visit used 0 credits", async () => {
    await open("?step=2");
    expect((await screen.findByText(/Updated 2 hours ago/, {}, wait)).closest(".sg-meta")?.getAttribute("data-stale")).toBeNull();
    expect(document.querySelector(".credits-tip")?.textContent).toContain("This visit used 0 credits.");
    expect(document.querySelector(".credits-meter")?.textContent).toContain("Credits: 412 of 500");
    expect(refreshButton()?.disabled).toBe(false);
    expect(refreshButton()?.textContent).toBe("Refresh, 1 credit");
  });

  it("stale data shows the hint and a Refresh button but does not run anything on load", async () => {
    const { suggestions } = await open("?cache=stale&step=2");
    await screen.findByText("Updated 3 days ago, new data available", {}, wait);
    expect(screen.getByText(/Dipbot suggests 1 choice/)).toBeTruthy();
    expect(suggestions).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".credits-meter")?.textContent).toContain("Credits: 412 of 500");
  });

  it("refresh is an explicit press: one request with refresh, then 1 credit is spent and the line is current", async () => {
    const { suggestions } = await open("?cache=stale&step=2");
    await screen.findByText("Updated 3 days ago, new data available", {}, wait);
    fireEvent.click(refreshButton()!);
    await screen.findByText("Updated just now", {}, wait);
    expect(suggestions).toHaveBeenCalledTimes(2);
    expect(suggestions.mock.calls[1]![0]).toMatchObject({ refresh: true, requestId: expect.any(String) });
    await waitFor(() => expect(document.querySelector(".credits-meter")?.textContent).toContain("Credits: 411 of 500"));
    expect(document.querySelector(".credits-tip")?.textContent).toContain("This visit used 1 credit");
  });

  it("an older-than-a-week answer says when it was updated, without claiming new data", async () => {
    await open("?cache=age&step=2");
    await screen.findByText("Updated 9 days ago", {}, wait);
    expect(screen.queryByText(/new data available/)).toBeNull();
  });

  it("the very first visit computes once, shows a loading state, and charges 1 credit", async () => {
    const { suggestions } = await open("?cache=first&step=2");
    await screen.findByText(/looking at your members/, {}, wait);
    await screen.findByText(/Updated just now/, {}, wait);
    expect(suggestions).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector(".credits-meter")?.textContent).toContain("Credits: 411 of 500"));
    expect(document.querySelector(".credits-tip")?.textContent).toContain("This visit used 1 credit to set up your suggestions.");
  });

  it("out of credits: the first visit shows the free suggestions without a charge and offers no refresh", async () => {
    const { suggestions } = await open("?cache=first&ai=nocredits&step=2");
    await screen.findByText(/Dipbot suggests 1 choice/, {}, wait);
    expect(suggestions).toHaveBeenCalledTimes(1);
    expect(refreshButton()).toBeNull();
    expect(document.querySelector(".credits-meter")?.textContent).toContain("Credits: 0 of 500");
  });

  it("out of credits with a stale answer: shown as saved, Refresh is disabled and never auto-runs", async () => {
    const { suggestions } = await open("?cache=stale&ai=nocredits&step=2");
    await screen.findByText("Updated 3 days ago, new data available", {}, wait);
    expect(refreshButton()?.disabled).toBe(true);
    fireEvent.click(refreshButton()!);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(suggestions).toHaveBeenCalledTimes(1);
  });
});

describe("preference chips on the last step", () => {
  it("shows a few chips up front with a More options expander that lists the rest grouped, searchable and accessible", async () => {
    await open("?step=5");
    const chips = await screen.findByRole("list", { name: "Preferences" }, wait);
    const up = within(chips).getAllByRole("button");
    expect(up.length).toBeGreaterThanOrEqual(6);
    expect(up.length).toBeLessThanOrEqual(8);
    expect(up.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    fireEvent.click(up[0]!);
    expect(up[0]!.getAttribute("aria-pressed")).toBe("true");
    const more = screen.getByRole("button", { name: /More options/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const panelId = more.getAttribute("aria-controls")!;
    expect(document.getElementById(panelId)?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(panelId)!;
    expect(panel.hasAttribute("hidden")).toBe(false);
    // Grouped by category with real fieldset/legend semantics.
    const legends = Array.from(panel.querySelectorAll("legend")).map((l) => l.textContent);
    expect(legends).toEqual(expect.arrayContaining(["Accessibility", "Food and drink"]));
    // Accessibility and dietary options are reachable even if they are not ranked up front.
    const search = within(panel).getByRole("searchbox", { name: "Search preferences" });
    fireEvent.change(search, { target: { value: "wheelchair" } });
    const wheelchair = within(panel).getByRole("button", { name: /Wheelchair accessible/ });
    fireEvent.click(wheelchair);
    expect(wheelchair.getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(search, { target: { value: "nothing matches this" } });
    expect(within(panel).getByText("Nothing matches that search.")).toBeTruthy();
    fireEvent.change(search, { target: { value: "gluten" } });
    expect(within(panel).getByRole("button", { name: /Gluten-free options/ })).toBeTruthy();
  });

  it("keeps the chosen preferences across steps and sends the ids with the request", async () => {
    const { drafts } = await open("?step=5");
    const generate = await screen.findByRole("button", { name: /Generate drafts/ }, wait);
    const first = within(await screen.findByRole("list", { name: "Preferences" }, wait)).getAllByRole("button")[0]!;
    const firstLabel = first.querySelector("span")!.textContent!;
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: /More options/ }));
    fireEvent.click(screen.getByRole("button", { name: /Step-free access/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: /Step-free access/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(generate);
    await waitFor(() => expect(drafts).toHaveBeenCalledTimes(1), wait);
    const sent = drafts.mock.calls[0]![0].considerations!;
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe("step_free");
    expect(CONSIDERATIONS.find((c) => c.id === sent[0])?.label).toBe(firstLabel);
  });
});
