import type { IdeaTemplate, ThemeKey } from "./catalog";
import type { CompanySignals, CompanySummary } from "./signals";

/** Deterministic parts of the ranking: prefilter, prior score, shortlist and the final diversity rules. */

export const MAX_COST_CENTS = 5000;
export const REPEAT_WINDOW_DAYS = 42;
export const GAP_DAYS = 42;
export const SHORTLIST_SIZE = 12;
export const MAX_PER_THEME_IN_SHORTLIST = 2;
export const BUSY_EVENTS = 6;
export const QUIET_EVENTS = 2;
export const GOAL_CLOSE = 0.05;
const DAY_MS = 86_400_000;

/** Weights of the prior score (sum 1). */
export const PRIOR_WEIGHTS = { interest: 0.35, history: 0.25, gap: 0.2, weeklyTheme: 0.1, lowKey: 0.1 } as const;

export interface Scored { idea: IdeaTemplate; score: number }

const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "at", "our", "your", "team", "company", "office", "annual", "weekly",
  "night", "class", "workshop", "day", "club", "lunch", "challenge", "outing", "intro", "basic", "basics", "session", "kickoff",
  "time", "party", "shift", "break", "hour", "morning", "game", "event", "social", "talk", "talks", "beginner", "lightning", "making", "make", "build", "swap",
]);

/** Lowercase words without punctuation, with a trailing plural "s" removed. */
export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean)
    .map(w => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/** The distinctive words of an idea title; a recent event with any of them counts as the same activity. */
export function keywordsOf(idea: IdeaTemplate): string[] {
  const significant = words(idea.title).filter(w => !STOP_WORDS.has(w) && w.length > 2);
  return significant.length > 0 ? significant : words(idea.title);
}

export function isRepeat(idea: IdeaTemplate, recentTitles: readonly string[]): boolean {
  const recent = new Set(recentTitles.flatMap(words));
  return keywordsOf(idea).some(k => recent.has(k));
}

/** Ideas that fit the season, budget, group size, are not recent suggestions and not a repeat of a recent event. */
export function prefilter(catalog: readonly IdeaTemplate[], summary: CompanySummary, signals: CompanySignals): IdeaTemplate[] {
  const since = signals.now.getTime() - REPEAT_WINDOW_DAYS * DAY_MS;
  const recentTitles = summary.eligible.filter(e => e.end.getTime() >= since).map(e => e.title);
  const suggested = new Set(signals.recentlySuggested);
  return catalog.filter(idea =>
    idea.months.includes(summary.month)
    && idea.costCents <= MAX_COST_CENTS
    && (summary.memberCount === null || idea.groupMin <= summary.memberCount)
    && !suggested.has(idea.id)
    && !isRepeat(idea, recentTitles));
}

function bucketValue(members: number): number {
  return members >= 20 ? 1 : members >= 10 ? 0.7 : members >= 5 ? 0.4 : 0;
}

/** Stable pseudo-random value in [0, 1) so equal ideas rotate week to week. */
function jitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Prior score in 0..1 from the company's own history. */
export function priorScore(idea: IdeaTemplate, summary: CompanySummary, weeklyTagIds: readonly string[] = []): number {
  const members = new Map(summary.interests.map(i => [i.tagId, i.members]));
  const interest = summary.interests.length === 0
    ? 0.3
    : Math.max(0, ...idea.tagIds.map(t => bucketValue(members.get(t) ?? 0)));
  const stats = summary.themes[idea.theme as ThemeKey];
  const history = stats.avgFill ?? 0.4;
  const gap = stats.lastHeldDaysAgo === null
    ? (summary.eligible.length > 0 ? 1 : 0.6)
    : stats.lastHeldDaysAgo >= GAP_DAYS ? 1 : (stats.lastHeldDaysAgo / GAP_DAYS) * 0.5;
  const weekly = idea.tagIds.some(t => weeklyTagIds.includes(t)) ? 1 : 0;
  const lowKey = summary.upcomingTwoWeeks >= BUSY_EVENTS && idea.lowKey ? 1 : 0;
  const base = PRIOR_WEIGHTS.interest * interest + PRIOR_WEIGHTS.history * history + PRIOR_WEIGHTS.gap * gap
    + PRIOR_WEIGHTS.weeklyTheme * weekly + PRIOR_WEIGHTS.lowKey * lowKey;
  return Math.min(1, Math.max(0, base * 0.98 + 0.02 * jitter(`${summary.weekKey}:${idea.id}`)));
}

/** Tag ids of weekly themes that are current or upcoming. */
export function activeThemeTagIds(signals: CompanySignals): string[] {
  return signals.weeklyThemes.filter(t => t.endDate.getTime() >= signals.now.getTime()).flatMap(t => t.tagIds);
}

/** Top 12 by prior with at most 2 per theme; ties break by id. */
export function shortlist(ideas: readonly IdeaTemplate[], summary: CompanySummary, signals: CompanySignals): Scored[] {
  const tags = activeThemeTagIds(signals);
  const ranked = ideas
    .map(idea => ({ idea, score: priorScore(idea, summary, tags) }))
    .sort((a, b) => b.score - a.score || a.idea.id.localeCompare(b.idea.id));
  const perTheme = new Map<ThemeKey, number>();
  const out: Scored[] = [];
  for (const s of ranked) {
    const n = perTheme.get(s.idea.theme) ?? 0;
    if (n >= MAX_PER_THEME_IN_SHORTLIST) continue;
    perTheme.set(s.idea.theme, n + 1);
    out.push(s);
    if (out.length === SHORTLIST_SIZE) break;
  }
  return out;
}

/** How many ideas to send: 5 on a quiet calendar, 3 on a busy one, else 4. */
export function pickCount(summary: CompanySummary): number {
  return summary.upcomingTwoWeeks <= QUIET_EVENTS ? 5 : summary.upcomingTwoWeeks >= BUSY_EVENTS ? 3 : 4;
}

/**
 * Final selection: best first, at most one per theme, skipping a repeated goal when another option within 0.05 has a new
 * goal. Falls back to the skipped ones to reach the count.
 */
export function finalPick(scored: readonly Scored[], summary: CompanySummary): Scored[] {
  const count = pickCount(summary);
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.idea.id.localeCompare(b.idea.id));
  const chosen: Scored[] = [];
  const deferred: Scored[] = [];
  const themes = new Set<ThemeKey>();
  const goals = new Set<string>();
  sorted.forEach((cand, index) => {
    if (chosen.length >= count || themes.has(cand.idea.theme)) return;
    if (goals.has(cand.idea.goal)) {
      const alternative = sorted.slice(index + 1).some(o =>
        !themes.has(o.idea.theme) && !goals.has(o.idea.goal) && o.idea.theme !== cand.idea.theme && o.score >= cand.score - GOAL_CLOSE);
      if (alternative) { deferred.push(cand); return; }
    }
    chosen.push(cand);
    themes.add(cand.idea.theme);
    goals.add(cand.idea.goal);
  });
  for (const cand of deferred) {
    if (chosen.length >= count) break;
    if (themes.has(cand.idea.theme)) continue;
    chosen.push(cand);
    themes.add(cand.idea.theme);
  }
  return chosen.sort((a, b) => b.score - a.score || a.idea.id.localeCompare(b.idea.id));
}
