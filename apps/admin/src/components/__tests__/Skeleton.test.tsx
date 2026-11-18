// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockInsights, type MockInsightsInput } from "@/lib/insightsMock";
import { CHART_HEIGHT, OVERVIEW_LAYOUT as L } from "@/lib/skeletonLayout";
import { holdReadsFromQuery } from "@/lib/loadingHold";
import { INTERESTS_VIEW_KEY, readInterestsView, useInterestsView } from "@/lib/interestsView";
import type { AdminApi } from "@/lib/api";
import { PeopleCard, StatTiles, TopEvents, TopMembers } from "../Overview";
import { OverviewLoading } from "../OverviewSkeleton";
import { PageSkeleton } from "../PageSkeletons";
import { SkeletonChart, SkeletonRegion, SkeletonTable } from "../Skeleton";
import { useDelayedShow, useSkeletonGate } from "../useDelayedShow";
import { stubLocalStorage } from "./storageStub";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

function stubMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
}

let storage: Storage;
beforeEach(() => { vi.useFakeTimers(); stubMotion(false); storage = stubLocalStorage(); });
afterEach(() => { cleanup(); vi.useRealTimers(); window.localStorage.clear(); });

describe("SkeletonRegion", () => {
  it("is busy with one hidden status, paints only after 150 ms, and hides the placeholders from assistive tech", () => {
    const { container } = render(<SkeletonRegion label="Loading events"><div data-testid="ghost" aria-hidden /></SkeletonRegion>);
    const region = container.querySelector(".sk-region")!;
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading events");
    expect(screen.getByRole("status").className).toContain("sr-only");
    expect(screen.queryByTestId("ghost")).toBeNull();
    act(() => { vi.advanceTimersByTime(149); });
    expect(screen.queryByTestId("ghost")).toBeNull();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.getByTestId("ghost").getAttribute("aria-hidden")).toBe("true");
  });

  it("turns the shimmer off under prefers-reduced-motion", () => {
    stubMotion(true);
    const { container } = render(<SkeletonRegion label="Loading">x</SkeletonRegion>);
    expect(container.querySelector(".sk-region")!.className).toContain("sk-still");
    const css = readFileSync(join(__dirname, "../../styles/_skeleton.scss"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.sk, \.sk-text::before \{ animation: none/);
  });

  it("a page layout reuses the page's own column headings, row count and table classes", () => {
    vi.useRealTimers();
    const { container } = render(<SkeletonTable rows={3} columns={[{ head: "Name", cell: () => null }, { head: "Role", cell: () => null }]} />);
    expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Name", "Role"]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.querySelector(".table-wrap > table.table")).not.toBeNull();
  });

  it("every layout renders inside a labelled region", () => {
    for (const layout of ["events", "members", "challenges", "audit", "ideas", "review", "bugs"] as const) {
      const { container, unmount } = render(<PageSkeleton layout={layout} label={`Loading ${layout}`} />);
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelector(".sk-region[aria-busy='true']")).not.toBeNull();
      expect(container.querySelectorAll(".sk-text, .sk").length).toBeGreaterThan(5);
      unmount();
    }
  });
});

describe("useDelayedShow", () => {
  it("never shows for a load that finishes inside the delay", () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedShow(on, 150, 300), { initialProps: { on: true } });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ on: false });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(false);
  });

  it("shows after the delay and stays at least the minimum once shown", () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedShow(on, 150, 300), { initialProps: { on: true } });
    act(() => { vi.advanceTimersByTime(160); });
    expect(result.current).toBe(true);
    rerender({ on: false }); // data arrived 10 ms after the skeleton appeared
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(false);
  });

  it("the page gate holds the skeleton through the minimum even after the data is there", () => {
    const { result, rerender } = renderHook(({ loading }) => useSkeletonGate(loading), { initialProps: { loading: true } });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(160); });
    rerender({ loading: false });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(320); });
    expect(result.current).toBe(false);
  });

  it("a fast load goes straight to the page", () => {
    const { result, rerender } = renderHook(({ loading }) => useSkeletonGate(loading), { initialProps: { loading: true } });
    act(() => { vi.advanceTimersByTime(40); });
    rerender({ loading: false });
    expect(result.current).toBe(false);
  });
});

const input: MockInsightsInput = {
  members: ["a", "b", "c", "d", "e", "f"].map((id, i) => ({ id, displayName: `Member ${id}`, status: "active", pointsBalance: 100 - i })),
  invited: 2,
  events: ["e1", "e2", "e3"].map((id, i) => ({ id, title: `Event ${id}`, status: "scheduled", startTime: `2026-11-2${i}T18:00:00Z`, attendeeCount: 10 - i, capacity: 20 })),
  photos: 4, comments: 2,
  theme: { id: "t1", title: "Walk week", startDate: "2026-11-09T05:00:00Z", endDate: "2026-11-16T04:59:59Z", participantCount: 6, completedCount: 3 },
  pendingReviews: 1,
};

describe("Overview skeleton matches the loaded structure (shared constants)", () => {
  const data = buildMockInsights(input, "default", "admin", new Date("2026-11-11T12:00:00Z"));

  it("same number of tiles, list rows and breakdown rows as the real cards", () => {
    const real = render(<><StatTiles insights={data} role="admin" /><TopEvents insights={data} /><TopMembers insights={data} /><PeopleCard insights={data} /></>);
    const realTiles = real.container.querySelectorAll(".stat-tile").length;
    const realEventRows = real.container.querySelectorAll("#top-events-h ~ .rank-list > li").length;
    const realMemberRows = real.container.querySelectorAll("#top-members-h ~ .rank-list > li").length;
    const realPeopleRows = real.container.querySelectorAll(".breakdown > div").length;
    expect([realTiles, realEventRows, realPeopleRows]).toEqual([L.tiles, L.topEventRows, L.peopleRows]);
    expect(realMemberRows).toBeLessThanOrEqual(L.topMemberRows);
    cleanup();

    const { container } = render(<OverviewLoading role="admin" />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelectorAll(".stat-grid .stat-tile")).toHaveLength(realTiles);
    const lists = container.querySelectorAll(".rank-list");
    expect(lists[0].children).toHaveLength(L.topEventRows);
    expect(lists[1].children).toHaveLength(L.topMemberRows);
    expect(container.querySelectorAll(".breakdown > div")).toHaveLength(realPeopleRows);
    expect(container.querySelectorAll(".action-list > li")).toHaveLength(L.pendingRows);
    // Same grid, in the same order, as the loaded page.
    expect([...container.querySelector(".sk-region")!.children].filter((c) => !c.classList.contains("sr-only")).map((c) => c.className.split(" ")[0])).toEqual(["stat-grid", "overview-row", "overview-row", "overview-row", "panel"]);
    expect(container.querySelectorAll(".sk-region .overview-row")[2].className).not.toContain("single");
  });

  it("organizers get no Top members card, like the loaded page", () => {
    const { container } = render(<OverviewLoading role="organizer" />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelectorAll(".rank-list")).toHaveLength(1);
    expect(container.querySelectorAll(".overview-row")[2].className).toContain("single");
  });

  it("the ghost chart is as tall as the real chart's cap in the style sheet", () => {
    const { container } = render(<SkeletonChart />);
    expect((container.querySelector(".sk-chart") as HTMLElement).style.height).toBe(`${CHART_HEIGHT}px`);
    const pro = readFileSync(join(__dirname, "../../styles/pro.scss"), "utf8");
    expect(pro).toContain(`.chart { max-height: ${CHART_HEIGHT}px;`);
    const cards = readFileSync(join(__dirname, "../../styles/_interests.scss"), "utf8");
    expect(cards).toMatch(/\.tag-card \{[^}]*height: 76px/);
  });
});

describe("Interests view preference", () => {
  it("defaults to grid, remembers the choice, and survives blocked storage", () => {
    expect(readInterestsView()).toBe("grid");
    const { result } = renderHook(() => useInterestsView());
    expect(result.current[0]).toBe("grid");
    act(() => result.current[1]("list"));
    expect(result.current[0]).toBe("list");
    expect(window.localStorage.getItem(INTERESTS_VIEW_KEY)).toBe("list");
    expect(readInterestsView()).toBe("list");
    const spy = vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readInterestsView()).toBe("grid");
    spy.mockRestore();
    window.localStorage.setItem(INTERESTS_VIEW_KEY, "bogus");
    expect(readInterestsView()).toBe("grid");
  });
});

describe("?loading=1 (mock only)", () => {
  const api = { mode: "mock", session: vi.fn(async () => ({ uid: "u" })), listEvents: vi.fn(async () => []) } as unknown as AdminApi;

  it("holds data calls forever but keeps the session", async () => {
    const held = holdReadsFromQuery(api, "?loading=1");
    await expect(held.session()).resolves.toEqual({ uid: "u" });
    let settled = false;
    void held.listEvents().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    expect(api.listEvents).not.toHaveBeenCalled();
  });

  it("does nothing without the flag", () => {
    expect(holdReadsFromQuery(api, "?x=1")).toBe(api);
  });
});
