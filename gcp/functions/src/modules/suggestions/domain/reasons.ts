import { THEME_LABELS, themeForTags, type AiDaypart, type IdeaTemplate, type ThemeKey } from "./catalog";
import type { DataLevel } from "./signals";
import { BEST_FILL, WEEKDAY_NAMES, weekLabel, type CompanySignals, type CompanySummary } from "./signals";
import { GAP_DAYS, activeThemeTagIds } from "./rules";
import { bucketText } from "./questions";

export const MAX_REASONS = 2;
const REASON_MAX = 120;

function cut(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Noun used in sentences such as "Your last outdoor event". */
function themeNoun(theme: ThemeKey): string {
  return theme === "outdoors" ? "outdoor" : THEME_LABELS[theme].toLowerCase();
}

/** Up to two grounded "why" lines in priority order. Only aggregates; counts under 5 never appear. */
export function reasonsFor(idea: IdeaTemplate, summary: CompanySummary, signals: CompanySignals): string[] {
  const out: string[] = [];
  const push = (text: string | null) => { if (text && out.length < MAX_REASONS) out.push(cut(text, REASON_MAX)); };
  const mine = summary.interests.filter(i => idea.tagIds.includes(i.tagId) && i.members >= 5);

  const grown = mine.filter(i => (i.growth ?? 0) >= 2).sort((a, b) => b.growth! - a.growth! || b.members - a.members)[0];
  push(grown ? `${grown.growth} more teammates picked ${grown.name} this month` : null);

  const top3 = summary.interests.filter(i => i.members >= 5).slice(0, 3).map(i => i.tagId);
  const topTag = mine.filter(i => top3.includes(i.tagId)).sort((a, b) => b.members - a.members)[0];
  push(topTag ? `${topTag.name} is one of your top interests (${bucketText(topTag.bucket)} members)` : null);

  const stats = summary.themes[idea.theme];
  const own = summary.eligible.filter(e => themeForTags(e.tagIds) === idea.theme);
  const newest = own[0];
  if (newest && newest.capacity > 0 && newest.attendeeCount / newest.capacity >= BEST_FILL) {
    push(`Your last ${themeNoun(idea.theme)} event, "${cut(newest.title, 40)}", filled ${newest.attendeeCount} of ${newest.capacity} spots`);
  } else if (stats.best) {
    push(`Your ${themeNoun(idea.theme)} event "${cut(stats.best.title, 40)}" filled ${stats.best.attendeeCount} of ${stats.best.capacity} spots`);
  }

  if (stats.events === 0 && summary.eligible.length > 0) push(`No ${themeNoun(idea.theme)} events yet`);
  else if (stats.lastHeldDaysAgo !== null && stats.lastHeldDaysAgo >= GAP_DAYS) {
    push(`No ${themeNoun(idea.theme)} events in the last ${Math.floor(stats.lastHeldDaysAgo / 7)} weeks`);
  }

  const active = new Set(activeThemeTagIds(signals));
  const weekly = signals.weeklyThemes.find(t => t.endDate.getTime() >= signals.now.getTime() && t.tagIds.some(id => idea.tagIds.includes(id) && active.has(id)));
  push(weekly ? `Fits the "${cut(weekly.title, 40)}" weekly challenge` : null);

  const quiet = summary.busyWeeks.find(w => w.weekStart.getTime() === summary.quietestWeekStart.getTime());
  push(quiet && quiet.events <= 1 ? `The ${weekLabel(summary.quietestWeekStart).replace("Week", "week")} is quiet on your calendar` : null);

  push(idea.months.length < 12 && idea.months.includes(summary.month) ? `A good pick for ${summary.season}` : null);
  return out;
}

export const NO_DATA_NOTE = "We don't have much activity from your team yet, so these come from our catalog of crowd favorites.";

export function dataNote(level: DataLevel): string | null {
  return level === "none" ? NO_DATA_NOTE : null;
}

const DAYPART_LABEL: Readonly<Record<AiDaypart, string>> = {
  weekday_morning: "morning", weekday_lunch: "lunch", weekday_afternoon: "afternoon", after_work: "after work",
  weekend_daytime: "daytime", weekend_evening: "evening",
};

/** For example "Try a Thursday after work, week of Dec 1". */
export function whenHint(idea: IdeaTemplate, summary: CompanySummary): string | null {
  const daypart = idea.dayparts[0];
  if (!daypart) return null;
  const weekend = daypart.startsWith("weekend");
  const fitting = idea.weekdays.filter(d => (d >= 6) === weekend);
  const options = fitting.length > 0 ? fitting : idea.weekdays;
  let best = options[0];
  for (const d of options) if ((summary.weekdayFill[d] ?? 0) > (summary.weekdayFill[best!] ?? 0)) best = d;
  if (best === undefined) return null;
  const day = WEEKDAY_NAMES[best - 1]!;
  const week = weekLabel(summary.quietestWeekStart).replace("Week", "week");
  return `Try a ${day} ${DAYPART_LABEL[daypart]}, ${week}`;
}

export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function costText(costCents: number): string {
  if (costCents === 0) return "Free";
  for (const dollars of [15, 25, 35, 50]) if (costCents < dollars * 100) return `Under $${dollars} per person`;
  return "Up to $50 per person";
}

/** For example "90 min · 8 to 20 people · Under $15 per person". */
export function factsLine(idea: IdeaTemplate): string {
  return `${durationText(idea.durationMinutes)} · ${idea.groupMin} to ${idea.groupMax} people · ${costText(idea.costCents)}`;
}
