// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WeeklyTheme } from "@/lib/challenge";
import { ChallengeRow, ChallengeTable, sortChallenges } from "../ChallengeRows";

afterEach(cleanup);

type Phase = "current" | "upcoming" | "past";

function theme(over: Partial<WeeklyTheme>): WeeklyTheme {
  return {
    id: "t1", companyId: "acme", title: "Fitness", description: "", tagIds: [], type: "weekly", goal: 3, goalUnit: "workouts",
    coverImageURL: "catalog://theme/fitness", startDate: "2026-11-09T05:00:00.000Z", endDate: "2026-11-16T04:59:59.000Z", pointsReward: 50,
    participantCount: 128, completedCount: 41, createdBy: "u", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", revision: 1, ...over,
  };
}

function renderRow(t: WeeklyTheme, phase: Phase, pending?: string) {
  return render(<ChallengeTable><ChallengeRow theme={t} phase={phase} pending={pending} /></ChallengeTable>);
}

describe("ChallengeRow", () => {
  it("shows the known theme's art on its accent, columns and the review action", () => {
    const { container } = renderRow(theme({}), "current", "7");
    const art = container.querySelector(".theme-art") as HTMLElement;
    expect(art.style.background).not.toBe("");
    expect(art.querySelector("img")?.getAttribute("src")).toContain("fitness");
    const row = screen.getByTestId("challenge-row");
    // Normal phases carry no chip: the note says where the week stands.
    expect(within(row).queryByText("This week")).toBeNull();
    expect(within(row).getByText(/Review as entries arrive/)).toBeTruthy();
    expect(within(row).getByText("7 pending")).toBeTruthy();
    expect(within(row).getByText("3 workouts")).toBeTruthy();
    // Same words as the Schedule's Participation column.
    expect(within(row).getByText("128 joined · 41 completed")).toBeTruthy();
    const link = within(row).getByRole("link", { name: /Review submissions for Fitness/ });
    expect(link.getAttribute("href")).toBe("/challenges/review?id=t1");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Challenge");
  });

  it("falls back to the neutral tile for an unknown theme key", () => {
    const { container } = renderRow(theme({ title: "Karaoke Week", coverImageURL: "catalog://theme/karaoke" }), "past", "0");
    const art = container.querySelector(".theme-art") as HTMLElement;
    expect(art.querySelector("img")).toBeNull();
    expect(art.textContent).toBe("Karaoke Week");
    expect(screen.queryByText("Past")).toBeNull();
    expect(screen.getByText("0 pending")).toBeTruthy();
  });

  it("has no review action for an upcoming week", () => {
    renderRow(theme({ participantCount: 0, completedCount: 0 }), "upcoming");
    expect(screen.queryByRole("link", { name: /Review submissions/ })).toBeNull();
    expect(screen.getByText("Not open yet")).toBeTruthy();
    expect(screen.queryByText("Upcoming")).toBeNull();
  });
});

describe("sortChallenges", () => {
  it("orders this week, then upcoming soonest first, then past newest first", () => {
    const list = [
      theme({ id: "past-old", startDate: "2026-10-12T00:00:00Z" }),
      theme({ id: "later", startDate: "2026-11-23T00:00:00Z" }),
      theme({ id: "past-new", startDate: "2026-11-02T00:00:00Z" }),
      theme({ id: "now", startDate: "2026-11-09T00:00:00Z" }),
      theme({ id: "next", startDate: "2026-11-16T00:00:00Z" }),
    ];
    const phase = (t: WeeklyTheme): Phase => (t.id === "now" ? "current" : t.id === "next" || t.id === "later" ? "upcoming" : "past");
    expect(sortChallenges(list, phase).map((t) => t.id)).toEqual(["now", "next", "later", "past-new", "past-old"]);
  });
});
