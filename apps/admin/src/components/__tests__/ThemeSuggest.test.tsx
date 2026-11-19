// @vitest-environment jsdom
// Suggest theme on the New theme form: fills in place, keeps the admin's own edits, Another idea, Undo, errors and credits.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestThemeResult, ThemeSuggestion } from "@/lib/adminTypes";
import { ApiError } from "@/lib/contract";
import { setLocale } from "@/lib/i18n";
import { applySuggestion } from "@/lib/themeSuggest";
import { addDays, nextMonday, weekStartIso } from "@/lib/weeks";

const suggestTheme = vi.fn();
const eventIdeaContext = vi.fn();
let role = "admin";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const api = {
  suggestTheme: (i: unknown) => suggestTheme(i), eventIdeaContext: () => eventIdeaContext(), listThemes: async () => [],
  listTags: async () => [{ id: "tag-food", name: "Food & Drink" }, { id: "tag-cooking", name: "Cooking" }, { id: "tag-fitness", name: "Fitness" }, { id: "tag-games", name: "Games" }],
};
const sessions: Record<string, { uid: string; role: string }> = { admin: { uid: "u", role: "admin" }, organizer: { uid: "u", role: "organizer" } };
vi.mock("../AppProvider", () => ({ useApp: () => ({ session: sessions[role], api }) }));

import { TagCatalogProvider } from "../TagCatalog";
import { ThemeForm } from "../ThemeForm";
import { SuggestThemeAction, ThemeSuggestProvider } from "../ThemeSuggest";

const credits = (left = 400) => ({ creditsAllowance: 500, creditsUsed: 500 - left, creditsRemaining: left, resetsAt: "2026-12-01T05:00:00.000Z",
  creditCost: { suggest: 1, generate: 10, regenerate: 10, weeklyEmail: 3, coverPick: 1, venueSearch: 1, ideas: 3, themeSuggest: 2 } });
const context = (left = 400, on = true) => ({ enabled: true, themeSuggestEnabled: on, interestDataAvailable: true, topInterests: [], thinInterestTagIds: [],
  usage: { monthlyGenerationLimit: 30, monthlyGenerationsUsed: 0, dailyGenerationLimit: 10, dailyGenerationsUsed: 0, generationsRemaining: 10 }, credits: credits(left) });

const week = addDays(nextMonday(), 14);
const s = (title: string, themeKey: string, tagIds: string[], extra: Partial<ThemeSuggestion> = {}): ThemeSuggestion => ({
  id: title, title, description: `${title}: post a photo.`, tagIds, themeKey, weekStart: week, why: [`Why ${title}.`], reasonBasis: "company_data", source: "agent", ...extra,
});
const RESULT: SuggestThemeResult = {
  suggestion: s("Recipe Swap", "food", ["tag-food", "tag-cooking"], { fitLabel: "perfect" }),
  alternatives: [s("Lunch Walk", "fitness", ["tag-fitness"]), s("Game Break", "games", ["tag-games"])],
  outcome: "suggested", replay: false, credits: credits(398), creditsCharged: 2,
};

function Page() {
  return (
    <TagCatalogProvider>
      <ThemeSuggestProvider>
        <SuggestThemeAction />
        <ThemeForm />
      </ThemeSuggestProvider>
    </TagCatalogProvider>
  );
}

const title = () => (document.getElementById("title") as HTMLInputElement).value;
const description = () => (document.getElementById("description") as HTMLTextAreaElement).value;
const pressed = () => screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent);
const suggestButton = () => screen.findByRole("button", { name: /^Suggest theme, 2 credits/ });

beforeEach(() => { suggestTheme.mockReset(); eventIdeaContext.mockReset(); eventIdeaContext.mockResolvedValue(context()); role = "admin"; });
afterEach(() => { cleanup(); setLocale("en"); });

describe("Suggest theme on the New theme form", () => {
  it("fills title, description, tags, picture and week in place, with the tag and an announcement", async () => {
    suggestTheme.mockResolvedValue(RESULT);
    render(<Page />);
    await waitFor(() => expect(pressed()).toEqual(["Fitness"])); // the default tag arrived
    fireEvent.click(await suggestButton());
    await waitFor(() => expect(title()).toBe("Recipe Swap"));
    expect(description()).toBe("Recipe Swap: post a photo.");
    expect(pressed()).toEqual(["Food & Drink", "Cooking"]);
    expect((document.getElementById("start-week") as HTMLSelectElement).value).toBe(week);
    expect(screen.getByRole("radio", { name: "Food & Drink" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll(".dipbot-tag").length).toBe(7);
    expect(screen.getByRole("heading", { name: "Dipbot suggested “Recipe Swap”" })).toBeTruthy();
    expect(screen.getByText("Why Recipe Swap.")).toBeTruthy();
    expect(screen.getByRole("status", { name: "" }).textContent ?? "").toBeDefined();
    expect(document.body.textContent).toContain("Dipbot filled in: theme picture, title, description, tags, week, and goal. Undo is available.");
    const sent = suggestTheme.mock.calls[0]![0] as { requestId: string; locale: string };
    expect(sent.locale).toBe("en");
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps what the admin typed and replaces it only on request; Undo restores everything", async () => {
    suggestTheme.mockResolvedValue(RESULT);
    render(<Page />);
    await waitFor(() => expect(pressed()).toEqual(["Fitness"]));
    fireEvent.change(document.getElementById("title")!, { target: { value: "My own title" } });
    fireEvent.click(await suggestButton());
    await waitFor(() => expect(description()).toBe("Recipe Swap: post a photo."));
    expect(title()).toBe("My own title");
    expect(screen.getByText(/Kept what you entered: title\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace mine too" }));
    expect(title()).toBe("Recipe Swap");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(title()).toBe("My own title");
    expect(pressed()).toEqual(["Fitness"]);
    expect(document.querySelectorAll(".dipbot-tag").length).toBe(0);
    expect(screen.getByText("Your previous values are back.", { selector: ".ts-note" })).toBeTruthy();
  });

  it("Another idea cycles the alternatives without a new request and never touches edited fields", async () => {
    suggestTheme.mockResolvedValue(RESULT);
    render(<Page />);
    fireEvent.click(await suggestButton());
    await waitFor(() => expect(title()).toBe("Recipe Swap"));
    fireEvent.change(document.getElementById("description")!, { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Another idea" }));
    expect(title()).toBe("Lunch Walk");
    expect(description()).toBe("Mine");
    expect(screen.getByText("Idea 2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Another idea" }));
    fireEvent.click(screen.getByRole("button", { name: "Another idea" }));
    expect(title()).toBe("Recipe Swap");
    expect(suggestTheme).toHaveBeenCalledTimes(1);
  });

  it("a hint is sent with Suggest again; a failure shows the error alert and Try again reuses the request id", async () => {
    suggestTheme.mockResolvedValueOnce(RESULT).mockRejectedValueOnce(Object.assign(new Error("unavailable [503]"), { name: "FirebaseError", code: "functions/unavailable" }))
      .mockResolvedValueOnce({ ...RESULT, suggestion: s("Calm Week", "wellness", []) });
    render(<Page />);
    fireEvent.click(await suggestButton());
    await waitFor(() => expect(title()).toBe("Recipe Swap"));
    fireEvent.change(screen.getByLabelText("Refine with a hint (optional)"), { target: { value: "something calm" } });
    fireEvent.click(screen.getByRole("button", { name: /^Suggest again, 2 credits/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("busy");
    expect(alert.textContent).not.toMatch(/503|unavailable/);
    expect(title()).toBe("Recipe Swap");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(title()).toBe("Calm Week"));
    const [, second, third] = suggestTheme.mock.calls.map((c) => c[0] as { requestId: string; hint?: string });
    expect(second!.hint).toBe("something calm");
    expect(third!.requestId).toBe(second!.requestId);
  });

  it("out of credits: the button is disabled with the reason, and an exhausted answer shows the reset date", async () => {
    eventIdeaContext.mockResolvedValue(context(1));
    render(<Page />);
    const button = await suggestButton();
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toMatch(/credits\. They reset on Dec 1/);
  });

  it("an exhausted answer turns into the credits notice", async () => {
    suggestTheme.mockRejectedValue(new ApiError("resource-exhausted", "This company has used this month's Dipbot credits.", {}, "AI_CREDITS_EXHAUSTED"));
    render(<Page />);
    fireEvent.click(await suggestButton());
    await waitFor(() => expect(document.querySelector(".theme-suggest")?.textContent).toContain("They reset on"));
    expect(await suggestButton()).toHaveProperty("disabled", true);
  });

  it("hidden for organizers and when theme suggestions are off", async () => {
    role = "organizer";
    const { unmount } = render(<Page />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /Suggest theme/ })).toBeNull();
    unmount();
    role = "admin";
    eventIdeaContext.mockResolvedValue(context(400, false));
    render(<Page />);
    await waitFor(() => expect(eventIdeaContext).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /Suggest theme/ })).toBeNull();
  });

  it("Spanish: the request asks for Spanish and the copy is translated", async () => {
    setLocale("es");
    suggestTheme.mockResolvedValue(RESULT);
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: /^Sugerir tema, 2 créditos/ }));
    await waitFor(() => expect(suggestTheme).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector(".theme-suggest h2")?.textContent).toBe("Dipbot sugirió “Recipe Swap”"), { timeout: 2000 });
    expect((suggestTheme.mock.calls[0]![0] as { locale: string }).locale).toBe("es");
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeTruthy();
  });
});

describe("applySuggestion", () => {
  const draft = {
    title: "Fitness", description: "d", tagIds: ["tag-fitness"], type: "weekly" as const, goal: 3, goalUnit: "workouts",
    coverImageURL: "catalog://theme/fitness", startDate: weekStartIso(nextMonday()), endDate: "", pointsReward: 50,
  };
  it("drops unknown tags and moves goal and unit with the picture only while they are the defaults", () => {
    const out = applySuggestion(draft, s("Recipe Swap", "food", ["tag-food", "tag-gone"]), { mine: new Set(), knownTagIds: ["tag-food"], freeMonday: () => null });
    expect(out.draft.tagIds).toEqual(["tag-food"]);
    expect(out.draft.goalUnit).not.toBe("workouts");
    expect(out.filled).toEqual(["illustration", "title", "description", "tags", "goal"]);
    const kept = applySuggestion({ ...draft, goalUnit: "laps" }, s("Recipe Swap", "food", ["tag-food"]), { mine: new Set(["tags"]), knownTagIds: null, freeMonday: () => null });
    expect(kept.draft.goalUnit).toBe("laps");
    expect(kept.kept).toEqual(["tags"]);
  });
});

describe("suggestThemeFromWire", () => {
  it("keeps valid suggestions, drops malformed alternatives and refuses an answer without a suggestion", async () => {
    const { suggestThemeFromWire } = await import("@/lib/adminLive");
    const ok = suggestThemeFromWire({
      suggestion: { id: "a", title: "T", description: "D", tagIds: ["tag-food"], themeKey: "food", weekStart: "2026-12-07", why: ["W"], reasonBasis: "company_data", source: "agent", fitLabel: "great" },
      alternatives: [{ id: "b", title: "", description: "D", themeKey: "food" }, { id: "c", title: "C", description: "D", tagIds: [], themeKey: "nope" }],
      outcome: "suggested", replay: false, credits: {}, creditsCharged: 2,
    });
    expect(ok.suggestion.fitLabel).toBe("great");
    expect(ok.alternatives).toEqual([]);
    expect(ok.creditsCharged).toBe(2);
    expect(() => suggestThemeFromWire({ alternatives: [] })).toThrow();
  });
});
