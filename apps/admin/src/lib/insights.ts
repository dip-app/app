import { type CompanyInsights, type InsightsDay, type Role, can } from "./adminTypes";
import { AI_NAME } from "./aiStrings";
import { formatDate, formatNumber, t, type MessageKey } from "./i18n";

// @i18n-migrated
// Pure helpers behind the Overview page (formatting, the activity chart geometry, the "needs attention" list).

export const formatCount = (value: number): string => formatNumber(value);

/** 0.744 -> "74%"; null (no completed events yet) -> "None". */
export function formatPercent(rate: number | null): string {
  return rate === null ? t("common.none") : `${Math.round(rate * 100)}%`;
}

/** "Updated just now", "Updated 4 min ago", "Updated 2 hr ago", then the date. */
export function updatedLabel(generatedAt: string, now: Date): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - at) / 60_000));
  if (minutes < 1) return t("overview.updated.justNow");
  if (minutes < 60) return t("overview.updated.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("overview.updated.hours", { hours });
  return t("overview.updated.date", { date: formatDate(new Date(at), { month: "short", day: "numeric" }) });
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

const shortDay = (iso: string) => formatDate(new Date(`${iso}T00:00:00Z`), { month: "short", day: "numeric", timeZone: "UTC" });
export { shortDay };

/** "Tue, Nov 11": the tooltip's date line (UTC, like the data). */
export const tooltipDay = (iso: string) => formatDate(new Date(`${iso}T00:00:00Z`), { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export interface TooltipPlacement { left: number; top: number; flipped: boolean }

/**
 * Where a tooltip goes: beside the anchor (right of it by default), flipped to the left when it would pass the right edge,
 * then clamped so it never leaves the chart on either side or vertically.
 */
export function placeTooltip(a: { anchorX: number; anchorY: number; width: number; height: number; boundsWidth: number; boundsHeight: number; gap?: number }): TooltipPlacement {
  const gap = a.gap ?? 12;
  let left = a.anchorX + gap;
  let flipped = false;
  if (left + a.width > a.boundsWidth) { left = a.anchorX - gap - a.width; flipped = true; }
  left = Math.max(0, Math.min(left, Math.max(0, a.boundsWidth - a.width)));
  const top = Math.max(0, Math.min(a.anchorY, Math.max(0, a.boundsHeight - a.height)));
  return { left, top, flipped };
}

/** Arrow-key movement between days: Left/Right step (clamped), Home/End jump, Escape (null) dismisses; undefined = not our key. From nothing, an arrow lands on the latest day. */
export function stepDay(current: number | null, key: string, count: number): number | null | undefined {
  if (count <= 0) return undefined;
  if (key === "Escape") return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
  if (current === null) return count - 1;
  return Math.max(0, Math.min(count - 1, current + (key === "ArrowRight" ? 1 : -1)));
}

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

export interface PendingAction { id: string; label: string; detail: string; /** One line per theme when the open reviews span several. */ lines: string[]; count: number; href: string | null }

export type ThemePhase = "past" | "current" | "upcoming";

/** Where a theme's date range sits relative to `now`. Instants, so week edges (Sunday 23:59:59 Eastern) hold in any time zone. */
export function themePhase(startDate: string, endDate: string, now: Date): ThemePhase {
  const instant = now.getTime();
  if (instant < Date.parse(startDate)) return "upcoming";
  if (instant > Date.parse(endDate)) return "past";
  return "current";
}

/** "Nov 9 to Nov 15", always in Eastern Time because weekly themes run on Eastern weeks. */
export function weekRange(startDate: string, endDate: string): string {
  const fmt = (iso: string) => formatDate(new Date(iso), { month: "short", day: "numeric", timeZone: "America/New_York" });
  return t("overview.pending.range", { start: fmt(startDate), end: fmt(endDate) });
}

export interface ReviewGroup { phase: ThemePhase; challengeId: string | null; title: string; range: string; count: number }

/**
 * The single source for "submissions waiting for review": the total (`challenges.pendingReviews`, every open challenge)
 * split into this week's theme and past themes. The server's `openReviews` gives the exact split; without it the split is
 * this week's count versus "the rest" (past themes), so the Overview's review numbers can never disagree.
 */
export function reviewGroups(insights: CompanyInsights, now: Date): ReviewGroup[] {
  const { pendingReviews, current, openReviews } = insights.challenges;
  const groups: ReviewGroup[] = [];
  if (openReviews && openReviews.length > 0) {
    for (const item of [...openReviews].sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))) {
      if (item.count > 0) groups.push({ phase: themePhase(item.startDate, item.endDate, now), challengeId: item.challengeId, title: item.title, range: weekRange(item.startDate, item.endDate), count: item.count });
    }
    return groups;
  }
  const thisWeek = Math.min(current?.pendingReviews ?? 0, pendingReviews);
  if (current && thisWeek > 0) groups.push({ phase: "current", challengeId: current.challengeId, title: current.title, range: weekRange(current.startDate, current.endDate), count: thisWeek });
  if (pendingReviews - thisWeek > 0) groups.push({ phase: "past", challengeId: null, title: "", range: "", count: pendingReviews - thisWeek });
  return groups;
}

const GROUP_KEYS = {
  current: "overview.pending.group.current", past: "overview.pending.group.past", upcoming: "overview.pending.group.upcoming", pastThemes: "overview.pending.group.pastThemes",
} as const satisfies Record<ThemePhase | "pastThemes", MessageKey>;
const GROUP_FROM_KEYS = {
  current: "overview.pending.groupFrom.current", past: "overview.pending.groupFrom.past", upcoming: "overview.pending.groupFrom.upcoming", pastThemes: "overview.pending.groupFrom.pastThemes",
} as const satisfies Record<ThemePhase | "pastThemes", MessageKey>;

const groupText = (g: ReviewGroup, several: boolean): string => {
  const keys = several ? GROUP_FROM_KEYS : GROUP_KEYS;
  return t(g.title ? keys[g.phase] : keys.pastThemes, { count: g.count, title: g.title, range: g.range });
};

/** What needs a person: reviews waiting, people invited who haven't signed in. Zero-count items are left out. */
export function pendingActions(insights: CompanyInsights, role: Role, now: Date = new Date(), extra: { newBugReports?: number | null } = {}): PendingAction[] {
  const items: PendingAction[] = [];
  const total = insights.challenges.pendingReviews;
  if (total > 0) {
    const groups = reviewGroups(insights, now);
    const lines = groups.length > 0 ? groups.map((g) => groupText(g, groups.length > 1)) : [t("overview.pending.recentThemes")];
    // One challenge: open its queue directly (submitted filter); several: the list of themes.
    const only = groups.length === 1 ? groups[0].challengeId : null;
    items.push({
      id: "reviews", label: t("overview.pending.reviews", { count: total }), count: total,
      detail: lines.join(" · "), lines,
      href: can(role, "challenges.review") ? (only ? `/challenges/review/?id=${encodeURIComponent(only)}&status=submitted` : "/challenges/?tab=review") : null,
    });
  }
  if (extra.newBugReports && extra.newBugReports > 0 && can(role, "bugreports.manage")) {
    items.push({
      id: "bugs", label: t("overview.pending.bugs", { count: extra.newBugReports }), count: extra.newBugReports,
      detail: t("overview.pending.bugsDetail"), lines: [t("overview.pending.bugsDetail")], href: "/bug-reports/?status=new",
    });
  }
  if (insights.members.invited > 0) {
    items.push({
      id: "invited", label: t("overview.pending.invited"), count: insights.members.invited,
      detail: t("overview.pending.resend"), lines: [t("overview.pending.resend")], href: can(role, "roster.manage") ? "/members/?status=invited" : null,
    });
  }
  return items;
}

export interface Shortcut { id: string; label: string; href: string }

/** Quick links under "Needs attention" (what the role can actually do), so a short card is still useful. At most two. */
export function shortcutsFor(role: Role): Shortcut[] {
  const all: [Parameters<typeof can>[1], Shortcut][] = [
    ["events.manage", { id: "new-event", label: t("overview.shortcuts.newEvent"), href: "/events/new/" }],
    ["themes.manage", { id: "new-theme", label: t("overview.shortcuts.newTheme"), href: "/challenges/new/" }],
    ["ai.generate", { id: "ideas", label: t("overview.shortcuts.ideas", { ai: AI_NAME }), href: "/ideas/" }],
    ["import.run", { id: "import", label: t("overview.shortcuts.import"), href: "/import/" }],
  ];
  return all.filter(([capability]) => can(role, capability)).map(([, shortcut]) => shortcut).slice(0, 2);
}

/** Where `now` is inside a theme's range: day number, number of days and the elapsed fraction (0..1). */
export function weekProgress(startDate: string, endDate: string, now: Date): { day: number; days: number; fraction: number } {
  const start = Date.parse(startDate), end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return { day: 1, days: 1, fraction: 0 };
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const fraction = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  return { day: Math.min(days, Math.floor(fraction * days) + 1), days, fraction };
}

/** Share of a theme's participants who finished, 0..1 (0 without participants). */
export function completionRate(participants: number, completed: number): number {
  return participants > 0 ? Math.min(1, completed / participants) : 0;
}

/** True when the company has produced nothing the page can chart yet (never while a section is unavailable). */
export function isQuiet(insights: CompanyInsights): boolean {
  return insights.unavailable.length === 0 && insights.participation.rsvpsLast30Days === 0 && insights.events.completed === 0 && insights.events.upcoming === 0;
}

export type RefreshSection = "insights" | "interestCounts" | "interestNames";
const SECTION_KEYS = {
  insights: "overview.refresh.section.insights", interestCounts: "overview.refresh.section.interestCounts", interestNames: "overview.refresh.section.interestNames",
} as const satisfies Record<RefreshSection, MessageKey>;

/** Names the sections that failed to refresh: "insights", "insights and interest counts". */
export function refreshFailureMessage(failed: RefreshSection[]): string {
  const names = failed.map((section) => t(SECTION_KEYS[section]));
  const sections = names.length > 1 ? t("overview.refresh.and", { head: names.slice(0, -1).join(", "), last: names[names.length - 1] }) : names[0];
  return t("overview.refresh.failed", { sections });
}

// ---------- Last 7 days (Overview band). Computed from data the page already reads; no extra server work.

export interface WeekCompare {
  /** Sum over the last 7 complete UTC days (today is partial and left out). */
  current: number;
  /** Sum over the 7 days before those, or null when the series is too short to compare. */
  previous: number | null;
  /** The 14 days behind both sums, oldest first, for a small bar spark (fewer when the series is short). */
  spark: number[];
}

/** RSVPs or photos in the last 7 complete days against the 7 before, from the 30-day `activity` series. */
export function lastSevenDays(days: InsightsDay[], metric: "rsvps" | "photos", now: Date): WeekCompare {
  const today = now.toISOString().slice(0, 10);
  const complete = days.filter((day) => day.date < today);
  const last = complete.slice(-7), before = complete.slice(-14, -7);
  const sum = (list: InsightsDay[]) => list.reduce((n, day) => n + day[metric], 0);
  return { current: sum(last), previous: before.length === 7 ? sum(before) : null, spark: complete.slice(-14).map((day) => day[metric]) };
}

/** "+12 vs the 7 days before", "\u221212 ...", "Same as the 7 days before". Absolute numbers: small bases make percentages loud. */
export function changeText(current: number, previous: number | null): string | null {
  if (previous === null) return null;
  const change = current - previous;
  if (change === 0) return t("overview.week.same");
  return t("overview.week.change", { sign: change > 0 ? "+" : "\u2212", change: formatNumber(Math.abs(change)) });
}

export interface EventLike { id: string; title: string; startTime: string; endTime: string; attendeeCount: number; capacity: number; status: string }

/** Events that ended in the last 7 days (not canceled) and how many people were going to them. */
export function heldLastWeek(events: readonly EventLike[], now: Date): { count: number; going: number } {
  const from = now.getTime() - 7 * 86_400_000;
  const held = events.filter((e) => e.status !== "cancelled" && Date.parse(e.endTime) <= now.getTime() && Date.parse(e.endTime) > from);
  return { count: held.length, going: held.reduce((n, e) => n + e.attendeeCount, 0) };
}

/** Scheduled events starting within `days`, soonest first. */
export function comingUp<T extends EventLike>(events: readonly T[], now: Date, days = 14): T[] {
  const until = now.getTime() + days * 86_400_000;
  return events.filter((e) => e.status !== "cancelled" && Date.parse(e.startTime) >= now.getTime() && Date.parse(e.startTime) <= until)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}
