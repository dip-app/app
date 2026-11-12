import { describe, expect, test } from "vitest";
import { insightsFromWire } from "../adminLive";
import { can, type CompanyInsights } from "../adminTypes";
import { buildMockInsights, mockActivity, scenarioFromSearch, type MockInsightsInput } from "../insightsMock";
import { chartModel, completionRate, formatPercent, isQuiet, niceMax, pendingActions, updatedLabel } from "../insights";

const NOW = new Date("2026-11-11T12:00:00Z");
const input: MockInsightsInput = {
  members: [
    { id: "m1", displayName: "Ada Admin", status: "active", pointsBalance: 400 },
    { id: "m2", displayName: "Max Member", status: "active", pointsBalance: 900 },
    { id: "m3", displayName: "Dee Gone", status: "deactivated", pointsBalance: 5000 },
  ],
  invited: 4,
  events: [
    { id: "e1", title: "Trivia", status: "scheduled", startTime: "2026-11-20T18:00:00Z", attendeeCount: 12, capacity: 20 },
    { id: "e2", title: "Hike", status: "scheduled", startTime: "2026-11-01T18:00:00Z", attendeeCount: 30, capacity: 30 },
    { id: "e3", title: "Cancelled", status: "cancelled", startTime: "2026-11-02T18:00:00Z", attendeeCount: 99, capacity: 99 },
  ],
  photos: 2, comments: 1,
  theme: { id: "t1", title: "Walk week", startDate: "2026-11-09T00:00:00Z", endDate: "2026-11-15T23:59:59Z", participantCount: 6, completedCount: 3 },
  pendingReviews: 3,
};

describe("formatting", () => {
  test("percent and updated labels", () => {
    expect(formatPercent(0.744)).toBe("74%");
    expect(formatPercent(null)).toBe("n/a");
    expect(updatedLabel("2026-11-11T12:00:00Z", NOW)).toBe("Updated just now");
    expect(updatedLabel("2026-11-11T11:56:00Z", NOW)).toBe("Updated 4 min ago");
    expect(updatedLabel("2026-11-11T09:00:00Z", NOW)).toBe("Updated 3 hr ago");
    expect(updatedLabel("nope", NOW)).toBe("");
  });
});

describe("chart model", () => {
  test("niceMax rounds up to round numbers", () => {
    expect([0, 3, 5, 9, 11, 37, 120].map(niceMax)).toEqual([4, 4, 5, 10, 20, 40, 200]);
  });

  test("30 bars stay inside the plot and the photo line shares the axis", () => {
    const days = mockActivity(NOW, 5);
    const model = chartModel(days);
    expect(model.bars).toHaveLength(30);
    for (const bar of model.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(model.plotLeft);
      expect(bar.x + bar.width).toBeLessThanOrEqual(model.plotRight);
      expect(bar.y).toBeGreaterThanOrEqual(model.plotTop);
      expect(bar.y + bar.height).toBeCloseTo(model.plotBottom, 5);
    }
    expect(model.line.split(" ")).toHaveLength(30);
    expect(model.labels.map((l) => l.text)).toHaveLength(3);
    expect(model.total.rsvps).toBe(days.reduce((n, d) => n + d.rsvps, 0));
  });

  test("an all-zero series keeps a valid axis", () => {
    const model = chartModel(mockActivity(NOW, 0));
    expect(model.max).toBe(4);
    expect(model.bars.every((b) => b.height === 0)).toBe(true);
  });
});

describe("mock insights", () => {
  test("organizers never get points; admins do, without deactivated members", () => {
    const org = buildMockInsights(input, "default", "organizer", NOW);
    expect(org.points).toBeNull();
    expect(JSON.stringify(org)).not.toContain("Max Member");
    const admin = buildMockInsights(input, "default", "admin", NOW);
    expect(admin.points?.topMembers.map((m) => m.displayName)).toEqual(["Max Member", "Ada Admin"]);
  });

  test("top events skip cancelled ones; counts follow the data", () => {
    const data = buildMockInsights(input, "default", "admin", NOW);
    expect(data.participation.topEvents.map((e) => e.title)).toEqual(["Hike", "Trivia"]);
    expect(data.events).toMatchObject({ upcoming: 1, completed: 1, cancelled: 1 });
    expect(data.members).toMatchObject({ total: 3, deactivated: 1, invited: 4 });
    expect(data.activity).toHaveLength(30);
  });

  test("the empty scenario is all zeros and reads as quiet", () => {
    const data = buildMockInsights(input, "empty", "admin", NOW);
    expect(isQuiet(data)).toBe(true);
    expect(data.participation.attendanceRate).toBeNull();
    expect(data.challenges.current).toBeNull();
    expect(pendingActions(data, "admin")).toEqual([]);
  });

  test("scenario comes from the query string", () => {
    expect(scenarioFromSearch("?insights=high")).toBe("high");
    expect(scenarioFromSearch("?insights=bogus")).toBe("default");
    expect(scenarioFromSearch("")).toBe("default");
  });
});

describe("pending actions", () => {
  const data = buildMockInsights(input, "default", "admin", NOW);

  test("admins get links, organizers see the counts without the roster link", () => {
    const admin = pendingActions(data, "admin");
    expect(admin.map((a) => [a.id, a.count, a.href])).toEqual([["reviews", 3, "/challenges/"], ["invited", 4, "/roster/"]]);
    const organizer = pendingActions(data, "organizer");
    expect(organizer.map((a) => a.href)).toEqual([null, null]);
  });

  test("completion rate is bounded", () => {
    expect(completionRate(0, 3)).toBe(0);
    expect(completionRate(4, 9)).toBe(1);
    expect(completionRate(4, 1)).toBe(0.25);
  });

  test("capabilities: both roles see the overview, only admins see points", () => {
    expect(can("organizer", "insights.view")).toBe(true);
    expect(can("organizer", "insights.points")).toBe(false);
    expect(can("admin", "insights.points")).toBe(true);
    expect(can("member", "insights.view")).toBe(false);
  });
});

describe("wire mapping", () => {
  test("a partial or hostile response renders as zeros, never throws", () => {
    const data: CompanyInsights = insightsFromWire({ generatedAt: "2026-11-11T12:00:00Z", members: { total: -4, activeCapped: "yes" }, participation: { attendanceRate: 7 }, activity: [{ date: "2026-11-11", rsvps: "x" }] });
    expect(data.members).toMatchObject({ total: 0, activeCapped: false });
    expect(data.participation.attendanceRate).toBe(1);
    expect(data.points).toBeNull();
    expect(data.challenges.current).toBeNull();
    expect(data.activity).toEqual([{ date: "2026-11-11", rsvps: 0, photos: 0 }]);
  });

  test("points and the current theme map through", () => {
    const data = insightsFromWire({
      generatedAt: "2026-11-11T12:00:00Z",
      points: { issuedLast30Days: 70, topMembers: [{ userId: "u1", displayName: "Ada", pointsBalance: 90 }] },
      challenges: { pendingReviews: 2, current: { challengeId: "c1", title: "Walk", startDate: "2026-11-09T00:00:00Z", endDate: "2026-11-15T00:00:00Z", participantCount: 6, completedCount: 2, pendingReviews: 2 } },
    });
    expect(data.points?.topMembers[0]).toEqual({ userId: "u1", displayName: "Ada", pointsBalance: 90 });
    expect(data.challenges.current?.title).toBe("Walk");
  });
});
