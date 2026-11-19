// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/contract";
import type { DipbotIdeas, DipbotIdeasInput } from "@/lib/adminTypes";
import { type AdminApi, type KeyValueStore, createMockApi } from "@/lib/api";
import { AI_DRAFT_KEY } from "@/lib/ideas";
import { buildMockIdeas } from "@/lib/ideasForYouMock";
import { creditsOf } from "@/lib/ideasMock";

const NOW = new Date("2026-11-17T12:00:00Z");
const memory = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
let current: { api: AdminApi } | null = null;
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../AppProvider", () => ({ useApp: () => ({ api: current!.api, session: { uid: "u" } }) }));

import { Ideas } from "../Ideas";
import { IdeasForYou } from "../IdeasForYou";
import { TagCatalogProvider } from "../TagCatalog";

const HOUR = 3_600_000;
function answer(over: Partial<DipbotIdeas> = {}): DipbotIdeas {
  return {
    enabled: true, ideas: buildMockIdeas("stored", 0, NOW), status: "stale", generatedAt: new Date(Date.now() - 26 * HOUR).toISOString(), dataLevel: "rich",
    autoRefreshDue: false, refreshesLeftToday: 2, credits: creditsOf(88, NOW), creditsCharged: 0, ...over,
  };
}
type Impl = (input: DipbotIdeasInput) => Promise<DipbotIdeas>;

async function makeApi(impl: Impl) {
  const api = createMockApi(memory(), () => NOW);
  await api.signIn("admin");
  const spy = vi.spyOn(api, "dipbotIdeas").mockImplementation(impl);
  current = { api };
  return { api, spy };
}
const modes = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => (c[0] as DipbotIdeasInput).mode);

async function mount(impl: Impl) {
  const made = await makeApi(impl);
  const onCredits = vi.fn();
  const onCustomize = vi.fn();
  render(<IdeasForYou onCredits={onCredits} onCustomize={onCustomize} />);
  return { ...made, onCredits, onCustomize };
}
const refreshButton = () => screen.getByRole("button", { name: /^Refresh ideas/ }) as HTMLButtonElement;
const wait = { timeout: 3000 };
vi.setConfig({ testTimeout: 15000 });

// Node 26 ships an incomplete global storage that shadows jsdom's, so each test gets plain in-memory ones.
const storage = (): Storage => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
};
beforeEach(() => {
  current = null; push.mockClear();
  Object.defineProperty(window, "localStorage", { value: storage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: storage(), configurable: true });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("Ideas for you: cards", () => {
  it("renders each idea with title, why line, chips and the fit label, after one load", async () => {
    const { spy } = await mount(async () => answer());
    const list = await screen.findByRole("list", { name: "Event ideas" }, wait);
    const cards = within(list).getAllByRole("listitem").filter((li) => li.classList.contains("ifu-card"));
    expect(cards).toHaveLength(5);
    const first = cards[0]!;
    expect(within(first).getByRole("heading", { name: "Thursday Trivia Showdown" })).toBeTruthy();
    expect(within(first).getByText(/Games drew 14 of your last 20 signups/)).toBeTruthy();
    expect(within(first).getByText("Thu after work")).toBeTruthy();
    expect(within(first).getByText("1 h 30 min")).toBeTruthy();
    expect(within(first).getByText("Free")).toBeTruthy();
    expect(within(first).getByText("Perfect fit")).toBeTruthy();
    // The fifth idea has no label, so no fit chip.
    expect(within(cards[4]!).queryByText(/fit|choice|match/i)).toBeNull();
    expect(screen.getByText("Updated yesterday")).toBeTruthy();
    expect(modes(spy)).toEqual(["load"]);
  });

  it("starter ideas say so, and no activity merges into the header status", async () => {
    await mount(async () => answer({ ideas: buildMockIdeas("starter", 0, NOW), status: "fallback", generatedAt: undefined, dataLevel: "none" }));
    expect(await screen.findByText("Starter ideas · not enough activity yet", {}, wait)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Use this idea:/ })).toHaveLength(5);
  });

  it("shows nothing at all when Dipbot ideas are off", async () => {
    const { spy } = await mount(async () => answer({ enabled: false, ideas: [] }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector(".ifu")).toBeNull());
  });

  it("a failed load shows one quiet line with Retry, and Retry loads again", async () => {
    let calls = 0;
    const { spy } = await mount(async () => { calls += 1; if (calls === 1) throw new ApiError("failed-precondition", "no"); return answer(); });
    expect(await screen.findByText(/Couldn’t load ideas right now/, {}, wait)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    expect(modes(spy)).toEqual(["load", "load"]);
  });

  it("shows skeletons of the same height while the first load is pending", async () => {
    let release: (v: DipbotIdeas) => void = () => undefined;
    await mount(() => new Promise<DipbotIdeas>((resolve) => { release = resolve; }));
    expect(document.querySelectorAll(".ifu-skeleton")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /^Refresh ideas/ })).toBeNull();
    expect(screen.getByText("Loading ideas")).toBeTruthy();
    await act(async () => { release(answer()); });
    await screen.findByRole("list", { name: "Event ideas" });
    expect(document.querySelector(".ifu-skeleton")).toBeNull();
  });
});

describe("Ideas for you: background run", () => {
  it("autoRefreshDue triggers exactly one auto call, shows Updating, then swaps the ideas in and folds the credits", async () => {
    let finish: (v: DipbotIdeas) => void = () => undefined;
    const fresh = answer({ ideas: buildMockIdeas("stored", 1, NOW), status: "fresh", outcome: "updated", autoRefreshDue: false, credits: creditsOf(91, NOW), creditsCharged: 3 });
    const { spy, onCredits } = await mount((input) => (input.mode === "auto"
      ? new Promise<DipbotIdeas>((resolve) => { finish = resolve; })
      : Promise.resolve(answer({ ideas: buildMockIdeas("starter", 0, NOW), status: "fallback", generatedAt: undefined, autoRefreshDue: true }))));
    await screen.findByText("Updating", {}, wait);
    expect(screen.getByText("Team Trivia Night")).toBeTruthy();
    await act(async () => { finish(fresh); });
    await screen.findByText("Park Bootcamp", {}, wait);
    expect(screen.queryByText("Updating")).toBeNull();
    expect(modes(spy)).toEqual(["load", "auto"]);
    expect(onCredits).toHaveBeenCalledWith(fresh.credits);
  });

  it("a failed auto run is ignored quietly and keeps the stored ideas", async () => {
    let fail: (e: unknown) => void = () => undefined;
    const { spy } = await mount((input) => (input.mode === "auto"
      ? new Promise<DipbotIdeas>((_, reject) => { fail = reject; })
      : Promise.resolve(answer({ autoRefreshDue: true }))));
    await screen.findByText("Updating", {}, wait);
    await act(async () => { fail(new ApiError("failed-precondition", "busy")); });
    await waitFor(() => expect(screen.queryByText("Updating")).toBeNull());
    expect(screen.getByText("Thursday Trivia Showdown")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(modes(spy)).toEqual(["load", "auto"]);
  });
});

describe("Ideas for you: refresh", () => {
  it("sends mode refresh with a request id, swaps the ideas and updates the credits", async () => {
    const next = answer({ ideas: buildMockIdeas("stored", 1, NOW), status: "fresh", generatedAt: new Date().toISOString(), outcome: "updated", refreshesLeftToday: 1, credits: creditsOf(91, NOW), creditsCharged: 3 });
    const { spy, onCredits } = await mount(async (input) => (input.mode === "refresh" ? next : answer()));
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    expect(refreshButton().textContent).toContain("3 credits");
    expect(refreshButton().getAttribute("aria-label")).toBe("Refresh ideas, 3 credits");
    fireEvent.click(refreshButton());
    await screen.findByText("Park Bootcamp", {}, wait);
    const call = spy.mock.calls.find((c) => (c[0] as DipbotIdeasInput).mode === "refresh")![0] as DipbotIdeasInput;
    expect(call.requestId).toMatch(/[0-9a-f-]{20,}/);
    expect(onCredits).toHaveBeenCalledWith(next.credits);
    expect(screen.getByText("Updated just now")).toBeTruthy();
  });

  it("is disabled while running, with the reason when out of credits, and when no refreshes are left today", async () => {
    await mount(async () => answer({ credits: creditsOf(499, NOW) }));
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    expect(refreshButton().disabled).toBe(true);
    expect(refreshButton().title).toMatch(/^Out of credits until /);
    // Said once by the page's credits notice, so the section header shows no visible hint of its own.
    expect(document.querySelector(".sh-hint")).toBeNull();
    // The stored ideas stay.
    expect(screen.getAllByRole("button", { name: /^Use this idea:/ })).toHaveLength(5);
    cleanup();

    await mount(async () => answer({ refreshesLeftToday: 0 }));
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    expect(refreshButton().disabled).toBe(true);
    expect(refreshButton().title).toBe("No more refreshes today. Try again tomorrow.");
    cleanup();

    let release: (v: DipbotIdeas) => void = () => undefined;
    const { spy } = await mount((input) => (input.mode === "refresh" ? new Promise<DipbotIdeas>((resolve) => { release = resolve; }) : Promise.resolve(answer())));
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    fireEvent.click(refreshButton());
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(refreshButton());
    expect(modes(spy).filter((m) => m === "refresh")).toHaveLength(1);
    await act(async () => { release(answer({ outcome: "unchanged" })); });
    await waitFor(() => expect(refreshButton().getAttribute("aria-busy")).toBeNull());
  });

  it("a refused refresh keeps the saved ideas", async () => {
    await mount(async (input) => { if (input.mode === "refresh") throw new ApiError("resource-exhausted", "limit", {}, "AI_IDEAS_REFRESH_LIMIT"); return answer(); });
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    fireEvent.click(refreshButton());
    await waitFor(() => expect(refreshButton().disabled).toBe(true));
    expect(screen.getByText("Thursday Trivia Showdown")).toBeTruthy();
  });
});

describe("Ideas for you: collapse", () => {
  it("toggles with aria-expanded and remembers the choice in localStorage", async () => {
    await mount(async () => answer());
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    const toggle = screen.getByRole("button", { name: "Hide ideas" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show ideas" }).getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem("dip.ideasForYou.collapsed")).toBe("1");
    expect(screen.queryByRole("list", { name: "Event ideas" })).toBeNull();
    cleanup();

    await mount(async () => answer());
    await waitFor(() => expect(screen.getByRole("button", { name: "Show ideas" }).getAttribute("aria-expanded")).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "Show ideas" }));
    expect(window.localStorage.getItem("dip.ideasForYou.collapsed")).toBeNull();
    await screen.findByRole("list", { name: "Event ideas" });
  });
});

describe("Ideas for you: actions", () => {
  it("Use this idea saves the draft for the editor and navigates", async () => {
    await mount(async () => answer());
    fireEvent.click(await screen.findByRole("button", { name: "Use this idea: Thursday Trivia Showdown" }, wait));
    expect(push).toHaveBeenCalledWith("/events/new/?from=ai");
    const saved = JSON.parse(window.sessionStorage.getItem(AI_DRAFT_KEY)!) as { draft: { title: string } };
    expect(saved.draft.title).toBe("Thursday Trivia Showdown");
  });

  it("Customize hands the idea's choices to the page", async () => {
    const { onCustomize } = await mount(async () => answer());
    fireEvent.click(await screen.findByRole("button", { name: "Customize with Dipbot: Lunch Break 5K Jog" }, wait));
    expect(onCustomize).toHaveBeenCalledWith(expect.objectContaining({
      focusTagIds: ["tag-fitness", "tag-outdoors"], goal: "wellness", groupSize: "team", setting: "outdoors", budget: "free", timing: "weekday_lunch", considerations: ["step_free"], prompt: "",
    }));
  });
});

describe("Ideas for you on the Dipbot page", () => {
  async function page(search: string) {
    const made = await makeApi(async () => answer());
    window.history.replaceState(null, "", `/${search}`);
    render(<TagCatalogProvider><Ideas /></TagCatalogProvider>);
    return made;
  }

  it("loads once and never again while moving between wizard steps", async () => {
    const { spy } = await page("?step=2");
    await screen.findByRole("list", { name: "Event ideas" }, wait);
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(modes(spy)).toEqual(["load"]);
  });

  it("Customize with Dipbot prefills the wizard and opens its last step with focus on the heading", async () => {
    await page("");
    fireEvent.click(await screen.findByRole("button", { name: "Customize with Dipbot: Thursday Trivia Showdown" }, wait));
    const generate = await screen.findByRole("button", { name: /^Generate drafts/ }, wait) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H2"));
    const chip = screen.getAllByRole("button", { name: /Seated and low-mobility friendly/ })[0]!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

});

// The preview mock itself (the `?ideas=` scenarios the design review uses), through the real page.
describe("Ideas for you with the preview mock", () => {
  async function previewPage(search: string) {
    const api = createMockApi(memory(), () => NOW);
    await api.signIn("admin");
    const spy = vi.spyOn(api, "dipbotIdeas");
    current = { api };
    window.history.replaceState(null, "", `/${search}`);
    render(<TagCatalogProvider><Ideas /></TagCatalogProvider>);
    return spy;
  }

  it("a refresh swaps the ideas and the page's credit meter drops by 3", async () => {
    const spy = await previewPage("");
    await waitFor(() => expect(document.querySelector(".credits-meter")?.textContent).toContain("Credits: 412 of 500"), wait);
    await screen.findAllByText(/^Updated .+ ago$/, {}, wait);
    fireEvent.click(await screen.findByRole("button", { name: /^Refresh ideas/ }, wait));
    await screen.findByText("Park Bootcamp", {}, wait);
    await waitFor(() => expect(document.querySelector(".credits-meter")?.textContent).toContain("Credits: 409 of 500"), wait);
    expect(modes(spy)).toEqual(["load", "refresh"]);
  });

  it("computing: starter ideas first, one auto run, then the new ideas", async () => {
    const spy = await previewPage("?ideas=computing");
    await screen.findByText("Team Trivia Night", {}, wait);
    await screen.findByText("Updating", {}, wait);
    await screen.findByText("Park Bootcamp", {}, wait);
    expect(modes(spy)).toEqual(["load", "auto"]);
  });

  it("exhausted, limit, off and empty each show their state", async () => {
    await previewPage("?ideas=exhausted");
    await waitFor(() => expect((screen.getByRole("button", { name: /^Refresh ideas/ }) as HTMLButtonElement).title).toMatch(/^Out of credits until /), wait);
    expect(document.querySelector(".sh-hint")).toBeNull();
    expect((screen.getByRole("button", { name: /^Refresh ideas/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    await previewPage("?ideas=limit");
    await waitFor(() => expect(document.querySelector(".sh-hint")?.textContent).toBe("No more refreshes today. Try again tomorrow."), wait);
    cleanup();
    await previewPage("?ideas=empty");
    await screen.findByText("Starter ideas · not enough activity yet", {}, wait);
    cleanup();
    await previewPage("?ideas=off");
    await screen.findByRole("button", { name: "Next" }, wait);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(document.querySelector(".ifu")).toBeNull();
  });
});
