// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyInsights } from "@/lib/adminTypes";
import { PeopleCard, StatTiles, ThemeCard, TopEvents, TopMembers, UnavailableNotice } from "../Overview";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(cleanup);

const insights = (unavailable: CompanyInsights["unavailable"]): CompanyInsights => ({
  generatedAt: "2026-11-17T12:00:00Z", windowDays: 30,
  members: { total: 12, active: 11, deactivated: 1, invited: 2, activeLast30Days: 5, activeCapped: false },
  events: { upcoming: 3, thisMonth: 4, completed: 9, cancelled: 1 },
  participation: { rsvpsLast30Days: 0, attendanceRate: null, attendanceSample: 0, topEvents: [] },
  content: { photosLast30Days: 6, commentsLast30Days: 2 },
  challenges: { pendingReviews: 0, current: null },
  points: { issuedLast30Days: 0, topMembers: [] },
  activity: [],
  unavailable,
});

describe("Overview unavailable sections", () => {
  it("shows unavailable sections inline instead of their placeholder zeros, and keeps the rest", () => {
    const data = insights(["participation", "points"]);
    render(<><UnavailableNotice insights={data} /><StatTiles insights={data} role="admin" /><TopEvents insights={data} /><TopMembers insights={data} /><PeopleCard insights={data} /></>);
    expect(screen.getByText(/Some sections couldn’t be loaded/)).toBeTruthy();
    const rsvps = screen.getByRole("group", { name: "RSVPs, last 30 days" });
    expect(rsvps.textContent).toContain("Unavailable right now");
    expect(rsvps.querySelector(".stat-value")?.textContent).toBe("–");
    expect(rsvps.textContent).not.toContain("Going, across all events");
    expect(screen.getByRole("group", { name: "Members" }).textContent).toContain("12");
    expect(screen.getAllByText(/This section is unavailable right now/)).toHaveLength(2);
    expect(screen.queryByText("No events with attendees yet.")).toBeNull();
    expect(screen.getByText("Total members")).toBeTruthy();
  });

  it("a complete summary shows no notice and the normal empty states", () => {
    const data = insights([]);
    render(<><UnavailableNotice insights={data} /><TopEvents insights={data} /><ThemeCard insights={data} role="admin" /></>);
    expect(screen.queryByText(/Some sections couldn’t be loaded/)).toBeNull();
    expect(screen.queryByText(/This section is unavailable/)).toBeNull();
    expect(screen.getByText("No events with attendees yet.")).toBeTruthy();
  });
});
