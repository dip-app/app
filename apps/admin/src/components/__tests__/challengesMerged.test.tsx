// @vitest-environment jsdom
// Challenges after merging Weekly themes: Schedule (plan and edit) and Review (submissions) on one page.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const theme = (id: string, title: string, start: number, end: number) => ({
  id, companyId: "acme", title, description: "", tagIds: [], type: "weekly", goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness",
  startDate: at(start), endDate: at(end), pointsReward: 50, participantCount: 4, completedCount: 0, createdBy: "u", createdAt: at(-30), updatedAt: at(-30), revision: 1,
});

const state = { role: "admin", tab: "schedule", phase: "current" };
const api = { listThemes: vi.fn(), listSubmissions: vi.fn() };

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/challenges/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/AppProvider", () => ({ useApp: () => ({ api, session: { uid: `u-${state.role}`, role: state.role, name: "Ada", email: "a@acme.com", companyId: "acme" } }) }));
vi.mock("@/components/Shell", () => import("./shellMock"));
vi.mock("@/components/ThemeArt", () => ({ ThemeArt: () => null }));
vi.mock("@/lib/useQueryState", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/useQueryState")>();
  return { ...real, useQueryState: (defaults: Record<string, string>) => [{ ...defaults, tab: state.tab, phase: state.phase }, vi.fn()] };
});

import { resetCache } from "@/lib/queryCache";
import { setLocale } from "@/lib/i18n";
import ChallengesPage from "../../app/challenges/page";

beforeEach(() => {
  resetCache();
  api.listThemes.mockResolvedValue([theme("now", "Walk week", -1, 5), theme("next", "Cook week", 8, 14), theme("old", "Read week", -20, -14)]);
  api.listSubmissions.mockResolvedValue({ submissions: [{}, {}], nextCursor: null });
});

afterEach(() => {
  cleanup();
  setLocale("en");
  Object.assign(state, { role: "admin", tab: "schedule", phase: "current" });
  vi.clearAllMocks();
});

describe("Challenges (Schedule and Review)", () => {
  it("opens on the schedule: week filters with counts, edit links under /challenges/, New challenge", async () => {
    render(<ChallengesPage />);
    await waitFor(() => expect(screen.getByText("Walk week")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Schedule" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Review" })).toBeTruthy();
    const filters = screen.getByRole("group", { name: "Show challenges by week" });
    expect(within(filters).getByRole("button", { name: /Current/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Edit Walk week" }).getAttribute("href")).toBe("/challenges/edit?id=now");
    expect(within(screen.getByTestId("page-actions")).getByRole("link", { name: "New challenge" }).getAttribute("href")).toBe("/challenges/new");
    expect(screen.getByRole("columnheader", { name: "Challenge" })).toBeTruthy();
    expect(api.listSubmissions).not.toHaveBeenCalled();
  });

  it("Review lists every challenge with its pending entries", async () => {
    state.tab = "review";
    render(<ChallengesPage />);
    await waitFor(() => expect(screen.getAllByTestId("challenge-row")).toHaveLength(3));
    await waitFor(() => expect(screen.getAllByText("2 pending")).toHaveLength(2));
    expect(screen.getByRole("link", { name: /Review submissions for Walk week/ }).getAttribute("href")).toBe("/challenges/review?id=now");
  });

  it("organizers see the schedule read-only, without the Review tab", async () => {
    state.role = "organizer";
    state.tab = "review";
    render(<ChallengesPage />);
    await waitFor(() => expect(screen.getByText("Walk week")).toBeTruthy());
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTestId("page-actions")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit Walk week" })).toBeNull();
  });

  it("reads in Spanish", async () => {
    setLocale("es");
    render(<ChallengesPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Calendario" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Retos" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nuevo reto" })).toBeTruthy();
  });
});
