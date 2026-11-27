import { createHash } from "node:crypto";
import type { ThemeSuggestion } from "../../../generated/models";
import { THEME_LABELS, THEME_MAIN_TAG, themeForTags, type ThemeKey } from "../../suggestions/domain/catalog";
import { fitLabel } from "../../suggestions/domain/labels";
import { APPEAL_LEVELS, FRESH_LEVELS, INTEREST_LEVELS, buildState, composite, interpret, questionId } from "../../suggestions/domain/questions";
import type { DecisionAnswer, DecisionQuestion } from "../application/ports";
import { cleanText, hasForbiddenContent, normalizeTagId } from "./drafts";
import { fitWhy, groundedNumbers, interestClaimsHold, isGrounded } from "./ideaValidate";
import { SUPPRESSION_THRESHOLD } from "./interests";
import { THEME_IDEAS, type ThemeIdea } from "./themeCatalog";
import {
  THEME_LIMITS, catalogFor, modelThemesSchema, pastThemes, scheduledThemes, type ModelTheme, type ThemeSnapshot, type ThemeTrace,
} from "./themeTools";

/**
 * Validation, repair, de-duplication, grounding and ranking of Dipbot Suggest theme (docs/design/stretch/dipbot-suggest-theme.md).
 * Pure: no IO. The server owns every field the form receives: catalog tags only, lengths clamped, a free week, why lines
 * that quote only numbers the tools returned, and never a repeat of a recent or scheduled theme or a recent event.
 */

export type ThemeLocale = "en" | "es";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Tools whose numbers describe the catalog or the calendar, not the company's people. */
const NON_COMPANY_TOOLS: ReadonlySet<string> = new Set(["getThemeCatalog", "getAvailableWeeks"]);

// ---------------------------------------------------------------------------------------------------------------------
// Similarity (embedding-free): normalized title tokens and their overlap

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "at", "with", "your", "our", "my", "we", "you", "it", "by", "is", "be",
  "week", "weekly", "theme", "challenge", "day", "days", "month", "club", "time",
  "el", "la", "los", "las", "un", "una", "de", "del", "y", "en", "con", "para", "por", "tu", "tus", "nuestro", "semana", "reto", "tema", "dia",
]);

/** Lowercase, accents removed, punctuation dropped, stop words removed, a light plural strip. */
export function titleTokens(title: string): string[] {
  const flat = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const out = new Set<string>();
  for (const word of flat.split(" ")) {
    const stem = word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
    if (!word || STOP_WORDS.has(word) || STOP_WORDS.has(stem)) continue;
    out.add(stem);
  }
  return [...out];
}

/** Jaccard overlap of the token sets, 0..1 (two empty titles are equal: 1). */
export function titleSimilarity(a: string, b: string): number {
  const x = new Set(titleTokens(a));
  const y = new Set(titleTokens(b));
  if (x.size === 0 && y.size === 0) return 1;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/** Thresholds: a theme title this close to a recent or scheduled theme, or this close to a recent event, is a repeat. */
export const SIMILAR_THEME = 0.6;
export const SIMILAR_EVENT = 0.75;

/** Titles this suggestion must not repeat: themes in the duplicate window and every scheduled one, and recent events. */
export interface Taken { themes: string[]; events: string[] }

export function takenTitles(snapshot: ThemeSnapshot): Taken {
  const now = snapshot.idea.signals.now.getTime();
  return {
    themes: [...pastThemes(snapshot), ...scheduledThemes(snapshot)].map(t => t.title),
    events: snapshot.idea.summary.eligible.filter(e => now - e.end.getTime() <= THEME_LIMITS.eventWindowDays * DAY_MS).map(e => e.title),
  };
}

export function isDuplicate(title: string, taken: Taken): boolean {
  return taken.themes.some(t => titleSimilarity(title, t) >= SIMILAR_THEME) || taken.events.some(t => titleSimilarity(title, t) >= SIMILAR_EVENT);
}

// ---------------------------------------------------------------------------------------------------------------------
// Server-built why lines (our copy, localized) and the prior

const BUCKET_VALUE: Record<string, number> = { "5-9": 0.5, "10-19": 0.75, "20+": 1 };

interface InterestHit { name: string; bucket: string }

/** The strongest interest among the tags that is at or above the privacy floor (bucket only). */
function topInterest(tagIds: readonly string[], snapshot: ThemeSnapshot): InterestHit | null {
  let best: InterestHit | null = null;
  let value = 0;
  for (const i of snapshot.idea.summary.interests) {
    if (!tagIds.includes(i.tagId) || i.members < SUPPRESSION_THRESHOLD || !i.bucket) continue;
    const v = BUCKET_VALUE[i.bucket] ?? 0;
    if (v > value) { value = v; best = { name: i.name, bucket: i.bucket }; }
  }
  return best;
}

/** Weeks since a theme with this illustration last started, or null when none in the window. */
function weeksSinceIllustration(theme: ThemeKey, snapshot: ThemeSnapshot): number | null {
  const now = snapshot.idea.signals.now.getTime();
  let best: number | null = null;
  for (const t of pastThemes(snapshot)) {
    if ((t.themeKey ?? themeForTags(t.tagIds)) !== theme) continue;
    const w = Math.max(0, Math.floor((now - t.startDate.getTime()) / WEEK_MS));
    if (best === null || w < best) best = w;
  }
  return best;
}

const WHY_TEXT: Record<ThemeLocale, { interest: string; fresh: string; fill: string; generic: string }> = {
  en: {
    interest: "{name} is a popular interest here ({bucket} members).",
    fresh: "No {label} theme in the last {weeks} weeks.",
    fill: "{label} events filled {pct}% on average.",
    generic: "An easy weekly habit anyone can join.",
  },
  es: {
    interest: "{name} es un interés popular aquí ({bucket} miembros).",
    fresh: "No hubo un tema de {label} en las últimas {weeks} semanas.",
    fill: "Los eventos de {label} se llenaron un {pct}% en promedio.",
    generic: "Un hábito semanal fácil al que cualquiera puede unirse.",
  },
};

/** Theme names in our own copy (the English ones are THEME_LABELS). */
const LABELS_ES: Readonly<Record<ThemeKey, string>> = {
  fitness: "Fitness", outdoors: "Aire libre", food: "Comida y bebida", arts: "Arte y manualidades", games: "Juegos",
  music: "Música", learning: "Aprendizaje", volunteering: "Voluntariado", wellness: "Bienestar",
};
const labelOf = (theme: ThemeKey, locale: ThemeLocale) => (locale === "es" ? LABELS_ES[theme] : THEME_LABELS[theme]);

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

/** Up to three lines built only from the snapshot (buckets, weeks, fill percent of at least 2 events). */
export function serverWhy(theme: ThemeKey, tagIds: readonly string[], snapshot: ThemeSnapshot, locale: ThemeLocale): { why: string[]; basis: ThemeSuggestion["reasonBasis"] } {
  const text = WHY_TEXT[locale];
  const lines: string[] = [];
  const hit = topInterest(tagIds, snapshot);
  if (hit) lines.push(fill(text.interest, { name: hit.name, bucket: hit.bucket }));
  const stats = snapshot.idea.summary.themes[theme];
  if (stats.events >= 2 && stats.avgFill !== null && stats.avgFill >= 0.6) lines.push(fill(text.fill, { label: labelOf(theme, locale), pct: Math.round(stats.avgFill * 100) }));
  if (snapshot.themes.length > 0 && weeksSinceIllustration(theme, snapshot) === null) {
    lines.push(fill(text.fresh, { label: labelOf(theme, locale), weeks: THEME_LIMITS.freshWeeks }));
  }
  const basis = lines.length > 0 && snapshot.idea.summary.dataLevel !== "none" ? "company_data" : "generic";
  if (lines.length === 0) lines.push(text.generic);
  return { why: lines.slice(0, THEME_LIMITS.maxWhy), basis };
}

/** Deterministic prior 0..1: interest buckets of the tags, a fresh illustration, past fill of the theme's events. */
export function themePrior(theme: ThemeKey, tagIds: readonly string[], snapshot: ThemeSnapshot): number {
  const { summary } = snapshot.idea;
  const members = new Map(summary.interests.map(i => [i.tagId, i.bucket]));
  const interest = summary.interests.length === 0 ? 0.3 : Math.max(0, ...tagIds.map(t => BUCKET_VALUE[members.get(t) ?? ""] ?? 0));
  const since = weeksSinceIllustration(theme, snapshot);
  const fresh = since === null || since >= THEME_LIMITS.freshWeeks ? 1 : (since / THEME_LIMITS.freshWeeks) * 0.5;
  const history = summary.themes[theme].avgFill ?? 0.4;
  return Math.min(1, Math.max(0, 0.45 * interest + 0.3 * fresh + 0.25 * history));
}

// ---------------------------------------------------------------------------------------------------------------------
// Repair

export interface ThemeContext {
  snapshot: ThemeSnapshot;
  locale: ThemeLocale;
}

const flat = (text: string, max: number) => cleanText(text.replace(/\s*\n\s*/g, " "), max);

/** Catalog tag ids only, deduplicated, at most 4, the illustration's own tag first when it is in the catalog. */
export function repairTags(raw: readonly unknown[], theme: ThemeKey, snapshot: ThemeSnapshot): string[] {
  const ids = new Set(snapshot.idea.catalogTags.map(t => t.id));
  const names = new Map(snapshot.idea.catalogTags.map(t => [t.id, t.name]));
  const out: string[] = [];
  const main = THEME_MAIN_TAG[theme];
  if (ids.has(main)) out.push(main);
  for (const value of raw) {
    const id = normalizeTagId(value, { catalogIds: ids, catalogNames: names });
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, THEME_LIMITS.maxTags);
}

/** The model's why lines that survive: cleaned, clamped, no contact data, every number grounded in this run's tool output. */
export function groundedWhy(lines: readonly string[], traces: readonly ThemeTrace[]): { why: string[]; companyNumbers: boolean } {
  const all = groundedNumbers(traces as never);
  const company = groundedNumbers(traces.filter(t => !NON_COMPANY_TOOLS.has(t.name)) as never);
  const why: string[] = [];
  let companyNumbers = false;
  for (const raw of lines.slice(0, THEME_LIMITS.maxWhy)) {
    const line = fitWhy(raw, THEME_LIMITS.whyMax);
    if (!line || hasForbiddenContent(line) || !isGrounded(line, all)) continue;
    if (/\d/.test(line) && isGrounded(line, company)) companyNumbers = true;
    why.push(line);
  }
  return { why, companyNumbers };
}

interface Draft {
  title: string; description: string; tagIds: string[]; themeKey: ThemeKey; weekStart: string | null;
  why: string[]; reasonBasis: ThemeSuggestion["reasonBasis"]; source: ThemeSuggestion["source"];
}

const COLD_START_CLAIM = /\b(your|you've|teammates?|colleagues?|coworkers?|members?|employees?|filled|signed up|picked|recorded|history|past themes?|no themes?|tu|tus|miembros|equipo)\b/i;

function repairModel(m: ModelTheme, ctx: ThemeContext, traces: readonly ThemeTrace[]): Draft | null {
  const { snapshot } = ctx;
  const title = flat(m.title, THEME_LIMITS.titleMax);
  const description = cleanText(m.description, THEME_LIMITS.descriptionMax);
  if (!title || !description || hasForbiddenContent(`${title}\n${description}`)) return null;
  const tagIds = repairTags(m.tagIds, m.themeKey, snapshot);
  if (tagIds.length === 0) return null;
  const weekStart = m.weekStart && snapshot.freeWeeks.includes(m.weekStart) ? m.weekStart : null;
  const raw = groundedWhy(m.why.filter(line => interestClaimsHold(line, snapshot.idea)), traces);
  // A company with no history gets no claims about it (eval 2026-11-26: "no themes recorded" lines on a cold start).
  const grounded = snapshot.idea.summary.dataLevel === "none"
    ? { why: raw.why.filter(line => !COLD_START_CLAIM.test(line) && !/\d/.test(line)), companyNumbers: false }
    : raw;
  const built = serverWhy(m.themeKey, tagIds, snapshot, ctx.locale);
  const why = grounded.why.length > 0 ? grounded.why : built.why;
  const reasonBasis = snapshot.idea.summary.dataLevel === "none" ? "generic" : grounded.why.length > 0 ? (grounded.companyNumbers ? "company_data" : built.basis) : built.basis;
  return { title, description, tagIds, themeKey: m.themeKey, weekStart, why, reasonBasis, source: "agent" };
}

function fromCatalog(idea: ThemeIdea, ctx: ThemeContext): Draft | null {
  const tagIds = repairTags(idea.tagIds, idea.theme, ctx.snapshot);
  if (tagIds.length === 0) return null;
  const built = serverWhy(idea.theme, tagIds, ctx.snapshot, ctx.locale);
  return { title: idea.title, description: idea.description, tagIds, themeKey: idea.theme, weekStart: null, why: built.why, reasonBasis: built.basis, source: "catalog" };
}

/** Stable id: source, position and a short hash of the title (a replay returns the same ids). */
const idOf = (d: Draft, index: number) => `${d.source === "agent" ? "ts" : "tc"}-${index}-${createHash("sha256").update(d.title).digest("hex").slice(0, 10)}`;

function finalize(d: Draft, index: number, snapshot: ThemeSnapshot): ThemeSuggestion {
  const weekStart = d.weekStart ?? snapshot.freeWeeks[0];
  return {
    id: idOf(d, index), title: d.title, description: d.description, tagIds: d.tagIds, themeKey: d.themeKey,
    ...(weekStart ? { weekStart } : {}), why: d.why, reasonBasis: d.reasonBasis, source: d.source,
  };
}

/** Catalog ideas ranked by the prior: no repeats, at most one per illustration, seasonal first then the rest. */
export function catalogDrafts(ctx: ThemeContext, count: number, exclude: { titles: string[]; themes: Set<ThemeKey> }): Draft[] {
  const taken = takenTitles(ctx.snapshot);
  const pool = [...catalogFor(ctx.snapshot), ...THEME_IDEAS.filter(i => !catalogFor(ctx.snapshot).includes(i))];
  const ranked = pool
    .map((idea, index) => ({ idea, index, score: themePrior(idea.theme, idea.tagIds, ctx.snapshot) - (index >= catalogFor(ctx.snapshot).length ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const out: Draft[] = [];
  const titles = [...exclude.titles];
  const themes = new Set(exclude.themes);
  for (const { idea } of ranked) {
    if (out.length >= count) break;
    if (themes.has(idea.theme) || isDuplicate(idea.title, taken) || titles.some(t => titleSimilarity(t, idea.title) >= SIMILAR_THEME)) continue;
    const draft = fromCatalog(idea, ctx);
    if (!draft) continue;
    out.push(draft);
    titles.push(draft.title);
    themes.add(draft.themeKey);
  }
  return out;
}

/** Model answer parse (strict schema), or null when malformed or empty. */
export function parseModelThemes(value: unknown, snapshot: ThemeSnapshot): ModelTheme[] | null {
  const parsed = modelThemesSchema(snapshot.idea.catalogTags.map(t => t.id), snapshot.freeWeeks).safeParse(value);
  return parsed.success && parsed.data.themes.length > 0 ? parsed.data.themes : null;
}

export interface BuiltThemes { suggestions: ThemeSuggestion[]; agentCount: number }

/**
 * Repairs the model's themes (drops repeats of recent or scheduled themes and recent events, duplicates among themselves,
 * unsafe text and moderated ones via `flagged`), keeps at most 4 and tops up from the catalog to at least 3.
 */
export function buildThemes(ctx: ThemeContext, modelThemes: readonly ModelTheme[] | null, traces: readonly ThemeTrace[], flagged: ReadonlySet<number> = new Set()): BuiltThemes {
  const taken = takenTitles(ctx.snapshot);
  const drafts: Draft[] = [];
  (modelThemes ?? []).forEach((m, index) => {
    if (drafts.length >= THEME_LIMITS.maxSuggestions || flagged.has(index)) return;
    const d = repairModel(m, ctx, traces);
    if (!d || isDuplicate(d.title, taken)) return;
    if (drafts.some(o => titleSimilarity(o.title, d.title) >= SIMILAR_THEME)) return;
    drafts.push(d);
  });
  const agentCount = drafts.length;
  if (drafts.length < THEME_LIMITS.maxSuggestions) {
    const want = Math.max(THEME_LIMITS.minSuggestions, THEME_LIMITS.maxSuggestions) - drafts.length;
    drafts.push(...catalogDrafts(ctx, want, { titles: drafts.map(d => d.title), themes: new Set(drafts.map(d => d.themeKey)) }));
  }
  return { suggestions: drafts.map((d, i) => finalize(d, i, ctx.snapshot)), agentCount };
}

/** Text the moderation call screens per model theme (title, description and why lines). */
export function moderationTexts(themes: readonly ModelTheme[]): string[] {
  return themes.map(t => [t.title, t.description, ...t.why].join("\n").slice(0, 2000));
}

// ---------------------------------------------------------------------------------------------------------------------
// Ranking and fit labels (one decision call: Jev, then the OpenAI mini model, then the prior only)

export function themeRankingRequest(suggestions: readonly ThemeSuggestion[], snapshot: ThemeSnapshot): { state: string; questions: Record<string, DecisionQuestion> } {
  const base = JSON.parse(buildState(snapshot.idea.summary, snapshot.idea.signals)) as { company: Record<string, unknown> };
  base.company.recentWeeklyThemes = pastThemes(snapshot).slice(-8).map(t => t.title.slice(0, 60));
  const questions: Record<string, DecisionQuestion> = {};
  suggestions.forEach((s, i) => {
    const what = `the weekly theme "${s.title}" (${s.description.slice(0, 160)})`;
    if (snapshot.idea.summary.interests.length > 0) {
      questions[questionId(i, "interest")] = { type: "score", instructions: `How well does ${what} match what people at this company are interested in (\`company.interests\`)?`, criteria: INTEREST_LEVELS };
    }
    questions[questionId(i, "fresh")] = {
      type: "score", instructions: `How different is ${what} from the company's recent weekly themes (\`company.recentWeeklyThemes\`) and events (\`company.recentEvents\`)?`, criteria: FRESH_LEVELS,
    };
    questions[questionId(i, "appeal")] = { type: "score", instructions: `How many coworkers in this company would take part in ${what} given \`company.size\`?`, criteria: APPEAL_LEVELS };
  });
  return { state: JSON.stringify(base), questions };
}

/** Orders by the composite (answers null: the prior only) and sets the fit label (none without company data). Stable. */
export function rankThemes(suggestions: readonly ThemeSuggestion[], snapshot: ThemeSnapshot, answers: Record<string, DecisionAnswer> | null): ThemeSuggestion[] {
  const components = interpret(answers, suggestions as never);
  return suggestions
    .map((s, index) => {
      const prior = themePrior(s.themeKey, s.tagIds, snapshot);
      const score = answers ? composite({ ...components[index]!, theme: null }, prior) : prior;
      const { fitLabel: _old, ...rest } = s;
      const label = fitLabel(score, snapshot.idea.summary.dataLevel);
      return { s: (label ? { ...rest, fitLabel: label } : rest) as ThemeSuggestion, score, index };
    })
    .sort((a, b) => b.score - a.score || (a.s.source === b.s.source ? 0 : a.s.source === "agent" ? -1 : 1) || a.index - b.index)
    .map(r => r.s);
}

/** The free fallback: catalog suggestions only, ranked by the prior. */
export function fallbackThemes(ctx: ThemeContext): ThemeSuggestion[] {
  return rankThemes(buildThemes(ctx, null, []).suggestions, ctx.snapshot, null);
}
