// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyInsights } from "@/lib/adminTypes";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("Overview people and stacking", () => {
  it("top members use the shared Avatar: photo, stored avatar, then the generated character", () => {
    const data = insights([]);
    data.points = { issuedLast30Days: 10, topMembers: [
      { userId: "uid-123", displayName: "Pat Lee", pointsBalance: 90, photoURL: "https://lh3.googleusercontent.com/a/abc" },
      { userId: "member-1", displayName: "Sam Roe", pointsBalance: 60, avatarId: "teal" },
      { userId: "u", displayName: "Kim Fox", pointsBalance: 30 },
    ] };
    const { container } = render(<TopMembers insights={data} />);
    const rows = container.querySelectorAll(".rank-main");
    expect(rows[0].querySelector("img.avatar.photo")).not.toBeNull();
    expect(rows[1].querySelector("img.avatar.mascot")!.getAttribute("src")).toBe("/admin/img/avatars/teal.webp");
    expect(rows[2].querySelector("svg.avatar.crew")!.getAttribute("data-avatar")).toBe("crew-square-wink-grey");
    expect(container.querySelector(".avatar:not(img):not(svg)")).toBeNull();
  });

  it("the stack has a gap in both style sheets (no flush sections)", () => {
    const sheet = readFileSync(join(__dirname, "../../styles/_overview.scss"), "utf8");
    const pro = readFileSync(join(__dirname, "../../styles/pro.scss"), "utf8");
    expect(sheet).toMatch(/\.overview \{ display: grid; gap: \d+px;/);
    expect(pro).toMatch(/\.overview \{ gap: \d+px; \.panel, \.notice \{ margin-bottom: 0; \}/);
  });
});
