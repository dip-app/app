import type { DecisionAnswer, DecisionQuestion } from "../../ai/application/ports";
import { THEME_LABELS, themeForTags, type IdeaTemplate } from "./catalog";
import { monthAbbr, MONTH_NAMES, type CompanySignals, type CompanySummary } from "./signals";

/** Weights of the composite score (sum 1). */
export const SUGGEST_WEIGHTS = { interest: 0.35, appeal: 0.25, fresh: 0.2, theme: 0.1, prior: 0.1 } as const;
export const MAX_QUESTIONS_PER_REQUEST = 24;

export const INTEREST_LEVELS = [
  "No listed interest relates to it",
  "A small or loosely related interest relates to it",
  "A clearly related interest has a fair number of members",
  "One of the largest interests is exactly this kind of activity",
] as const;
export const FRESH_LEVELS = [
  "Nearly the same activity was held recently",
  "A similar activity was held recently",
  "Somewhat related to a recent event",
  "Nothing like it was held recently",
] as const;
export const APPEAL_LEVELS = [
  "Only a few enthusiasts",
  "A small group",
  "A good share of the team",
  "Most of the team",
] as const;

export type QuestionKind = "interest" | "fresh" | "appeal" | "theme";
export const QUESTION_KINDS: readonly QuestionKind[] = ["interest", "fresh", "appeal", "theme"];

const LEVELS: Readonly<Record<Exclude<QuestionKind, "theme">, readonly string[]>> = {
  interest: INTEREST_LEVELS, fresh: FRESH_LEVELS, appeal: APPEAL_LEVELS,
};

function clean(text: string): string {
  return text.replace(/\S+@\S+/g, "").replace(/\s+/g, " ").trim();
}
function truncate(text: string, max: number): string {
  const t = clean(text);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function sizeBucket(memberCount: number | null): string {
  if (memberCount === null || memberCount < 0) return "unknown";
  if (memberCount < 10) return "under 10 members";
  if (memberCount < 20) return "10 to 20 members";
  if (memberCount < 50) return "20 to 50 members";
  if (memberCount < 100) return "50 to 100 members";
  if (memberCount < 250) return "100 to 250 members";
  return "over 250 members";
}

export function fillWords(fill: number | null): string {
  if (fill === null) return "unknown";
  if (fill >= 0.95) return "nearly full";
  return `about ${Math.round(fill * 10) * 10}% full`;
}

export function bucketText(bucket: "5-9" | "10-19" | "20+" | null): string {
  return bucket === "20+" ? "20+" : bucket === "10-19" ? "10 to 19" : bucket === "5-9" ? "5 to 9" : "under 5";
}

/** JSON state of company aggregates only: no names, emails or per-member data. */
export function buildState(summary: CompanySummary, signals: CompanySignals): string {
  const pastTurnout: Record<string, { events: number; typicalFill: string }> = {};
  for (const stats of Object.values(summary.themes)) {
    if (stats.events > 0) pastTurnout[THEME_LABELS[stats.theme]] = { events: stats.events, typicalFill: fillWords(stats.avgFill) };
  }
  const state = {
    company: {
      size: sizeBucket(summary.memberCount),
      interests: summary.interests.filter(i => i.members > 0).slice(0, 14).map(i => ({ interest: i.name, members: bucketText(i.bucket) })),
      recentEvents: summary.eligible.slice(0, 10).map(e => {
        const theme = themeForTags(e.tagIds);
        return { title: truncate(e.title, 60), theme: theme ? THEME_LABELS[theme] : "General", month: monthAbbr(e.end.getUTCMonth() + 1) };
      }),
      pastTurnout,
      weeklyThemes: signals.weeklyThemes.filter(t => t.endDate.getTime() >= signals.now.getTime()).slice(0, 4).map(t => truncate(t.title, 60)),
      season: summary.season,
      month: MONTH_NAMES[summary.month - 1],
    },
  };
  return JSON.stringify(state);
}

export function questionId(index: number, kind: QuestionKind): string {
  return `c${index + 1}_${kind}`;
}

/** Which judgments the state can support. A question over an empty list is skipped (its component falls back to the prior). */
export interface QuestionAvailability { interest: boolean; fresh: boolean; theme: boolean }

export function availability(summary: CompanySummary, signals: CompanySignals): QuestionAvailability {
  return {
    interest: summary.interests.some(i => i.members > 0),
    fresh: summary.eligible.length > 0,
    theme: signals.weeklyThemes.some(t => t.endDate.getTime() >= signals.now.getTime()),
  };
}

const ALL: QuestionAvailability = { interest: true, fresh: true, theme: true };

/** Up to four typed questions per candidate; each names the idea so answers stay independent. */
export function candidateQuestions(shortlist: readonly IdeaTemplate[], available: QuestionAvailability = ALL): Record<string, DecisionQuestion> {
  const out: Record<string, DecisionQuestion> = {};
  shortlist.forEach((idea, i) => {
    const what = `"${idea.title}" (${idea.pitch})`;
    if (available.interest) out[questionId(i, "interest")] = {
      type: "score",
      instructions: `How well does ${what} match what people at this company are interested in (\`company.interests\`)?`,
      criteria: INTEREST_LEVELS,
    };
    if (available.fresh) out[questionId(i, "fresh")] = {
      type: "score",
      instructions: `How different is ${what} from the company's recent events (\`company.recentEvents\`)?`,
      criteria: FRESH_LEVELS,
    };
    out[questionId(i, "appeal")] = {
      type: "score",
      instructions: `How many coworkers in this company would want to join ${what} given \`company.size\` and \`company.pastTurnout\`?`,
      criteria: APPEAL_LEVELS,
    };
    if (available.theme) out[questionId(i, "theme")] = {
      type: "noul",
      instructions: `Does ${what} fit one of the weekly challenge themes in \`company.weeklyThemes\`? Answer true when the idea clearly matches a listed theme. Answer false when the themes are about something else or none are listed.`,
      criteria: "The idea clearly matches a listed theme.",
    };
  });
  return out;
}

/** Splits into requests of at most `max` questions, never separating the questions of one candidate. */
export function chunkQuestions(questions: Readonly<Record<string, DecisionQuestion>>, max = MAX_QUESTIONS_PER_REQUEST): Array<Record<string, DecisionQuestion>> {
  const groups = new Map<string, string[]>();
  for (const id of Object.keys(questions)) {
    const key = id.split("_")[0]!;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const chunks: Array<Record<string, DecisionQuestion>> = [];
  let current: Record<string, DecisionQuestion> = {};
  let size = 0;
  for (const ids of groups.values()) {
    if (size > 0 && size + ids.length > max) { chunks.push(current); current = {}; size = 0; }
    for (const id of ids) current[id] = questions[id]!;
    size += ids.length;
  }
  if (size > 0) chunks.push(current);
  return chunks;
}

export interface Components { interest: number | null; fresh: number | null; appeal: number | null; theme: number | null }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Expected position along the levels, scaled to 0..1. Probabilities keyed by index or by level text; else the score. */
function scoreValue(answer: DecisionAnswer, levels: readonly string[]): number | null {
  if (answer.type !== "score") return null;
  const n = levels.length;
  for (const keys of [levels.map((_, i) => String(i)), [...levels]]) {
    let total = 0;
    let weighted = 0;
    keys.forEach((key, i) => {
      const p = answer.probabilities?.[key];
      if (typeof p === "number" && Number.isFinite(p) && p > 0) { total += p; weighted += p * i; }
    });
    if (total > 0) return clamp01(weighted / total / (n - 1));
  }
  return Number.isFinite(answer.score) ? clamp01(answer.score / (n - 1)) : null;
}

/** Per candidate (shortlist order): each judgment in 0..1, or null when the answer is missing or malformed. */
export function interpret(answers: Readonly<Record<string, DecisionAnswer>> | null, shortlist: readonly IdeaTemplate[]): Components[] {
  return shortlist.map((_, i) => {
    const get = (kind: QuestionKind): number | null => {
      const answer = answers?.[questionId(i, kind)];
      if (!answer) return null;
      if (kind === "theme") return answer.type === "noul" && Number.isFinite(answer.noul) ? clamp01(answer.noul) : null;
      return scoreValue(answer, LEVELS[kind]);
    };
    return { interest: get("interest"), fresh: get("fresh"), appeal: get("appeal"), theme: get("theme") };
  });
}

/** Weighted composite in 0..1; a missing component takes the prior. */
export function composite(components: Components, prior: number): number {
  const w = SUGGEST_WEIGHTS;
  const v = (c: number | null) => c ?? prior;
  return clamp01(
    w.interest * v(components.interest) + w.appeal * v(components.appeal) + w.fresh * v(components.fresh)
    + w.theme * v(components.theme) + w.prior * prior,
  );
}

