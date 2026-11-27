// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockInsights } from "@/lib/insightsMock";
import type { CompanyInsights } from "@/lib/adminTypes";
import type { TagStat } from "@/lib/tagStats";
import { stubLocalStorage } from "./storageStub";

const state = vi.hoisted(() => ({
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  session: { uid: "u", role: "admin", name: "Ada" },
  tags: { status: "ready" as const, tags: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], reload: vi.fn() },
}));

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/AppProvider", () => ({ useApp: () => ({ api: state.api, session: state.session }) }));
vi.mock("@/components/TagCatalog", () => ({ useTags: () => state.tags }));
vi.mock("@/components/Shell", () => ({ Shell: ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => <div><div data-testid="action">{action}</div>{children}</div> }));

import OverviewPage from "@/app/overview/page";

const NOW = new Date("2026-11-11T12:00:00Z");
const make = (rsvps: number): CompanyInsights => {
  const base = buildMockInsights({
    members: [{ id: "m1", displayName: "Ada", status: "active", pointsBalance: 5 }], invited: 1,
    events: [{ id: "e1", title: "Trivia", status: "scheduled", startTime: "2026-11-20T18:00:00Z", attendeeCount: 5, capacity: 10 }],
    photos: 1, comments: 1, theme: null, pendingReviews: 0,
  }, "default", "admin", NOW);
  return { ...base, participation: { ...base.participation, rsvpsLast30Days: rsvps } };
};
const stat = (tagId: string, memberCount: number): TagStat => ({ tagId, memberCount, updatedAt: "2026-11-01T00:00:00Z" });

beforeEach(() => {
  stubLocalStorage();
  window.localStorage.setItem("dip.admin.interestsView", "list");
  state.tags.reload = vi.fn().mockResolvedValue(true);
  state.api = {
    companyInsights: vi.fn(async (refresh?: boolean) => make(refresh ? 777 : 111)),
    tagStats: vi.fn(async () => [stat("a", 3), stat("b", 1)]),
    listEvents: vi.fn(async () => []),
    listAudit: vi.fn(async () => []),
  };
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

const tile = (name: string) => screen.getByRole("group", { name });

describe("Overview Refresh", () => {
  it("refreshes insights, interest counts and the tag catalog together", async () => {
    render(<OverviewPage />);
    await waitFor(() => expect(tile("RSVPs, last 30 days").textContent).toContain("111"), { timeout: 3000 });
    expect(state.api.tagStats).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(tile("RSVPs, last 30 days").textContent).toContain("777"));
    expect(state.api.companyInsights).toHaveBeenLastCalledWith(true);
    expect(state.api.tagStats).toHaveBeenCalledTimes(2);
    expect(state.tags.reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows one pending state and keeps the last data visible while it runs", async () => {
    render(<OverviewPage />);
    await waitFor(() => expect(tile("RSVPs, last 30 days").textContent).toContain("111"), { timeout: 3000 });
    let release: (value: CompanyInsights) => void = () => {};
    state.api.companyInsights.mockImplementationOnce(() => new Promise<CompanyInsights>((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const busy = await screen.findByRole("button", { name: "Refreshing" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: /Refresh/ })).toHaveLength(1);
    expect(tile("RSVPs, last 30 days").textContent).toContain("111"); // old numbers stay, no flash to a skeleton
    expect(document.querySelector(".sk-region")).toBeNull();
    expect(screen.getByRole("table", { name: "Members who picked each interest" })).toBeTruthy();
    await act(async () => { release(make(999)); });
    await waitFor(() => expect(tile("RSVPs, last 30 days").textContent).toContain("999"));
  });

  it("reports a partial failure per section and keeps what did refresh", async () => {
    render(<OverviewPage />);
    await waitFor(() => expect(tile("RSVPs, last 30 days").textContent).toContain("111"), { timeout: 3000 });
    state.api.tagStats.mockRejectedValueOnce(new Error("offline"));
    state.tags.reload.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("interest counts and interest names");
    expect(alert.textContent).not.toContain("insights");
    expect(tile("RSVPs, last 30 days").textContent).toContain("777"); // insights did refresh
  });
});
