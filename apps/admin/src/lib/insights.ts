import { type CompanyInsights, type InsightsDay, type Role, can } from "./adminTypes";

// Pure helpers behind the Overview page (formatting, the activity chart geometry, the "needs attention" list).

export const formatCount = (value: number): string => value.toLocaleString("en-US");

/** 0.744 -> "74%"; null (no completed events yet) -> "n/a". */
export function formatPercent(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}

/** "Updated just now", "Updated 4 min ago", "Updated 2 hr ago", then the date. */
export function updatedLabel(generatedAt: string, now: Date): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - at) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  return `Updated ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** The next "nice" ceiling for an axis (1, 2, 5, 10, 20, 50 ...) so grid lines land on round numbers. */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 4, 5, 10]) if (value <= step * magnitude) return step * magnitude;
  return 10 * magnitude;
}

export interface ChartBar { x: number; y: number; width: number; height: number; day: InsightsDay }
export interface ChartModel {
  width: number; height: number; plotTop: number; plotBottom: number; plotLeft: number; plotRight: number;
  max: number; ticks: { value: number; y: number }[];
  bars: ChartBar[];
  /** Photos per day as polyline points, plotted on the same axis. */
  line: string;
  /** Day labels: first, middle, last. */
  labels: { x: number; text: string; anchor: "start" | "middle" | "end" }[];
  total: { rsvps: number; photos: number };
}

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export { shortDay };

/** Geometry for the 30-day chart: RSVP bars with a photo line on one shared axis. */
export function chartModel(days: InsightsDay[], width = 720, height = 260): ChartModel {
  const plotLeft = 44, plotRight = width - 8, plotTop = 12, plotBottom = height - 32;
  const max = niceMax(Math.max(0, ...days.flatMap((d) => [d.rsvps, d.photos])));
  const plotWidth = plotRight - plotLeft, plotHeight = plotBottom - plotTop;
  const slot = days.length > 0 ? plotWidth / days.length : plotWidth;
  const yFor = (value: number) => plotBottom - (value / max) * plotHeight;
  const bars = days.map((day, i) => {
    const barHeight = (day.rsvps / max) * plotHeight;
    return { x: plotLeft + i * slot + slot * 0.18, y: plotBottom - barHeight, width: slot * 0.64, height: barHeight, day };
  });
  const line = days.map((day, i) => `${(plotLeft + i * slot + slot / 2).toFixed(1)},${yFor(day.photos).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1].map((fraction) => ({ value: Math.round(max * fraction), y: yFor(max * fraction) }));
  const at = (i: number, anchor: "start" | "middle" | "end" = "middle") => ({ x: plotLeft + i * slot + slot / 2, text: shortDay(days[i].date), anchor });
  // The outer labels hang inward so "Nov 12" is never clipped by the edge.
  const labels = days.length >= 3 ? [at(0, "start"), at(Math.floor(days.length / 2)), at(days.length - 1, "end")] : days.map((_, i) => at(i));
  return {
    width, height, plotTop, plotBottom, plotLeft, plotRight, max, ticks, bars, line, labels,
    total: { rsvps: days.reduce((n, d) => n + d.rsvps, 0), photos: days.reduce((n, d) => n + d.photos, 0) },
  };
}

export interface PendingAction { id: string; label: string; detail: string; count: number; href: string | null }

/** What needs a person: reviews waiting, people invited who haven't signed in. Zero-count items are left out. */
export function pendingActions(insights: CompanyInsights, role: Role): PendingAction[] {
  const items: PendingAction[] = [];
  if (insights.challenges.pendingReviews > 0) {
    items.push({
      id: "reviews", label: "Challenge submissions to review", count: insights.challenges.pendingReviews,
      detail: insights.challenges.current ? `Current theme: ${insights.challenges.current.title}` : "Recent weekly themes",
      href: can(role, "challenges.review") ? "/challenges/" : null,
    });
  }
  if (insights.members.invited > 0) {
    items.push({
      id: "invited", label: "Invited, not joined yet", count: insights.members.invited,
      detail: "Resend the invite message from the roster", href: can(role, "roster.manage") ? "/roster/" : null,
    });
  }
  return items;
}

/** Share of a theme's participants who finished, 0..1 (0 without participants). */
export function completionRate(participants: number, completed: number): number {
  return participants > 0 ? Math.min(1, completed / participants) : 0;
}

/** True when the company has produced nothing the page can chart yet. */
export function isQuiet(insights: CompanyInsights): boolean {
  return insights.participation.rsvpsLast30Days === 0 && insights.events.completed === 0 && insights.events.upcoming === 0;
}
