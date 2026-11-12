import type { CompanyInsights, InsightsDay, Role } from "./adminTypes";

/**
 * Preview data for the Overview. The mock derives what it can from the preview company (members, roster,
 * events, themes, review queue) and fills the 30-day activity with a deterministic curve, so the page looks the
 * same on every visit. `?insights=` picks a scenario for design review: empty, low, high, error or slow.
 */
export type InsightsScenario = "default" | "empty" | "low" | "high" | "error" | "slow";

export function scenarioFromSearch(search: string): InsightsScenario {
  const value = new URLSearchParams(search).get("insights");
  return value === "empty" || value === "low" || value === "high" || value === "error" || value === "slow" ? value : "default";
}

export interface MockInsightsInput {
  members: { id: string; displayName: string; status: string; pointsBalance: number }[];
  invited: number;
  events: { id: string; title: string; status: string; startTime: string; attendeeCount: number; capacity: number }[];
  photos: number;
  comments: number;
  theme: { id: string; title: string; startDate: string; endDate: string; participantCount: number; completedCount: number } | null;
  pendingReviews: number;
}

const DAY = 86_400_000;

/** Same input, same curve: a weekday rhythm with a mid-month push. */
export function mockActivity(now: Date, scale: number): InsightsDay[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 30 }, (_, i) => {
    const at = new Date(today - (29 - i) * DAY);
    const weekend = at.getUTCDay() === 0 || at.getUTCDay() === 6;
    const base = weekend ? 0.25 : 1 + ((i * 7) % 5) / 4 + (i > 12 && i < 20 ? 1.2 : 0);
    return { date: at.toISOString().slice(0, 10), rsvps: Math.round(base * scale), photos: Math.round(base * scale * (i % 4 === 1 ? 0.5 : 0.12)) };
  });
}

export function buildMockInsights(input: MockInsightsInput, scenario: InsightsScenario, role: Role, now: Date): CompanyInsights {
  const empty = scenario === "empty";
  const scale = scenario === "high" ? 24 : scenario === "low" ? 1 : 5;
  const activity = empty ? mockActivity(now, 0) : mockActivity(now, scale);
  const rsvps = activity.reduce((n, d) => n + d.rsvps, 0);
  const photos = activity.reduce((n, d) => n + d.photos, 0);
  const active = input.members.filter((m) => m.status !== "deactivated");
  const high = scenario === "high";
  const total = empty ? 1 : high ? 1840 : scenario === "low" ? 4 : input.members.length;
  const deactivated = empty ? 0 : high ? 96 : scenario === "low" ? 0 : input.members.length - active.length;
  const nowMs = now.getTime();
  const live = input.events.filter((e) => e.status !== "cancelled");
  const topEvents = empty ? [] : [...live].sort((a, b) => b.attendeeCount - a.attendeeCount).slice(0, scenario === "low" ? 1 : 5)
    .map((e) => ({
      eventId: e.id, title: e.title, startTime: e.startTime, attendeeCount: high ? e.attendeeCount * 14 : e.attendeeCount, capacity: high ? e.capacity * 14 : e.capacity,
      status: Date.parse(e.startTime) < nowMs ? "completed" as const : "scheduled" as const,
    }));
  const current = !empty && input.theme ? { challengeId: input.theme.id, title: input.theme.title, startDate: input.theme.startDate, endDate: input.theme.endDate,
    participantCount: high ? 612 : input.theme.participantCount, completedCount: high ? 340 : input.theme.completedCount, pendingReviews: empty ? 0 : high ? 37 : input.pendingReviews } : null;
  return {
    generatedAt: now.toISOString(), windowDays: 30,
    members: {
      total, active: Math.max(0, total - deactivated), deactivated, invited: empty ? 0 : high ? 214 : scenario === "low" ? 2 : input.invited,
      activeLast30Days: empty ? 0 : high ? 1120 : scenario === "low" ? 2 : Math.max(0, Math.round(active.length * 0.62)), activeCapped: high,
    },
    events: empty ? { upcoming: 0, thisMonth: 0, completed: 0, cancelled: 0 } : high
      ? { upcoming: 41, thisMonth: 58, completed: 412, cancelled: 19 }
      : { upcoming: live.filter((e) => Date.parse(e.startTime) >= nowMs).length, thisMonth: live.filter((e) => new Date(e.startTime).getUTCMonth() === now.getUTCMonth()).length,
        completed: live.filter((e) => Date.parse(e.startTime) < nowMs).length, cancelled: input.events.length - live.length },
    participation: { rsvpsLast30Days: rsvps, attendanceRate: empty ? null : high ? 0.81 : scenario === "low" ? 0.5 : 0.74, attendanceSample: empty ? 0 : high ? 25 : scenario === "low" ? 1 : Math.min(8, live.length), topEvents },
    content: { photosLast30Days: empty ? 0 : Math.max(photos, input.photos), commentsLast30Days: empty ? 0 : high ? 530 : Math.max(input.comments, scenario === "low" ? 0 : 6) },
    challenges: { pendingReviews: current?.pendingReviews ?? 0, current },
    points: role !== "admin" ? null : {
      issuedLast30Days: empty ? 0 : high ? 48_250 : scenario === "low" ? 120 : 3_420,
      topMembers: empty ? [] : [...active].sort((a, b) => b.pointsBalance - a.pointsBalance).slice(0, scenario === "low" ? 1 : 5)
        .map((m) => ({ userId: m.id, displayName: m.displayName, pointsBalance: high ? m.pointsBalance * 9 : m.pointsBalance })),
    },
    activity,
  };
}
