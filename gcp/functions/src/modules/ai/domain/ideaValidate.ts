import type { AiEventChoices, DipbotIdea, GeneratedEventDraft } from "../../../generated/models";
import { DEFAULT_COVER_URL, themeDefault } from "../../covers/domain/coverCatalog";
import { rankCovers } from "../../covers/domain/shortlist";
import type { DecisionAnswer, DecisionQuestion } from "../application/ports";
import {
  IDEA_CATALOG, THEME_MAIN_TAG, ideaById, type AiDaypart, type IdeaTemplate, type ThemeKey,
} from "../../suggestions/domain/catalog";
import { fitLabel, type FitLabel } from "../../suggestions/domain/labels";
import { availability, buildState, candidateQuestions, composite, interpret } from "../../suggestions/domain/questions";
import { finish, prepare } from "../../suggestions/domain/rank";
import { reasonsFor } from "../../suggestions/domain/reasons";
import { REPEAT_WINDOW_DAYS, activeThemeTagIds, isRepeat, prefilter, priorScore } from "../../suggestions/domain/rules";
import { addDays, civilDate } from "../../suggestions/domain/signals";
import { CONSIDERATION_IDS } from "./considerations";
import { GeneratedEventDraftSchema, cleanText, hasForbiddenContent, normalizeTagId } from "./drafts";
import { costBucketOf, safeLine } from "./ideaTools";
import { IDEA_LIMITS, modelIdeasSchema, type IdeaSnapshot, type ModelIdea, type ToolTrace } from "./ideaTypes";
import { BUDGET_CENTS, GROUP_CAPACITY } from "./vocabulary";

const DAY_MS = 86_400_000;
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_RANKED = 6;
const MAX_CONSIDERATIONS = 3;
/** Tools whose numbers describe the catalog or pictures, not the company. */
const NON_COMPANY_TOOLS: ReadonlySet<string> = new Set(["getIdeaCatalog", "getAvailableCoverLabels"]);

/** Validated model answer, or null when it is malformed or holds no idea. */
export function parseModelIdeas(value: unknown, snapshot: IdeaSnapshot): ModelIdea[] | null {
  const parsed = modelIdeasSchema(snapshot.catalogTags.map(t => t.id), CONSIDERATION_IDS).safeParse(value);
  return parsed.success && parsed.data.ideas.length > 0 ? parsed.data.ideas : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Number grounding

const NUMBER_TOKEN = /\d+(?:,\d{3})*(?:\.\d+)?/g;

function normalizeNumber(token: string): string {
  const n = Number(token.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : token;
}

function collectNumbers(value: unknown, key: string, into: Set<string>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(String(value));
    if (value > 0 && value <= 1 && /fill/i.test(key)) into.add(String(Math.round(value * 100)));
  } else if (typeof value === "string") {
    for (const m of value.matchAll(NUMBER_TOKEN)) into.add(normalizeNumber(m[0]));
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, key, into);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectNumbers(v, k, into);
  }
}

/** Every number that appears in the outputs of the tools called in this run (a fill ratio also adds its percent). */
export function groundedNumbers(traces: readonly ToolTrace[]): Set<string> {
  const out = new Set<string>();
  for (const trace of traces) collectNumbers(trace.output, "", out);
  return out;
}

/** True when every number in the text (years and percentages included) appears in the allowed set. No numbers: grounded. */
export function isGrounded(text: string, numbers: ReadonlySet<string>): boolean {
  for (const m of text.matchAll(NUMBER_TOKEN)) if (!numbers.has(normalizeNumber(m[0]))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Interest claims

const BUCKET_TOKEN = /\b(5\s*-\s*9|10\s*-\s*19|20\s*\+)/g;
const TOP_CLAIM = /\b(top|most popular|biggest|largest|favorite|más popular|principal|mayor)\b/i;
/** "One of your top interests", "a top interest": the top three visible interests (as in suggestions/domain/reasons.ts). */
const AMONG_TOP = /\b(one of|a top|among|uno de|una de|entre)\b/i;
const GROWTH_CLAIM = /\b(growing|grew|gaining|rising|on the rise|creciendo|crece|en aumento)\b/i;

/**
 * False when a line makes an interest claim the company data contradicts (eval 2026-11-26: small models wrote "Food &
 * Drink is your top interest (20+ members)" for companies where that is not true, and number grounding alone let the
 * "20" through because another interest had it). Checked for the interests the line names: a member bucket must be one
 * of their own visible buckets, "top" must be the largest visible interest ("one of the top" the top three), "growing" needs
 * a positive monthly change.
 * Lines naming no interest pass.
 */
export function interestClaimsHold(text: string, snapshot: IdeaSnapshot): boolean {
  const lower = text.toLowerCase();
  const visible = snapshot.summary.interests.filter(i => i.bucket !== null && i.members >= 5);
  const largest = visible.reduce<number>((m, i) => Math.max(m, i.members), 0);
  const named = snapshot.catalogTags.filter(tag => {
    const full = tag.name.toLowerCase();
    const head = full.split(/\s|&/)[0]!;
    return lower.includes(full) || (head.length >= 4 && new RegExp(`\\b${head}\\b`).test(lower));
  });
  if (named.length === 0) return true;
  const buckets = [...lower.matchAll(BUCKET_TOKEN)].map(m => m[1]!.replace(/\s+/g, ""));
  const facts = named.map(tag => visible.find(i => i.tagId === tag.id) ?? null);
  if (buckets.length > 0 && !buckets.every(b => facts.some(f => f?.bucket === b))) return false;
  const topThree = [...visible].sort((a, b) => b.members - a.members).slice(0, 3).map(i => i.tagId);
  const isTop = (f: (typeof facts)[number]) => f !== null && (AMONG_TOP.test(text) ? topThree.includes(f.tagId) : f.members === largest);
  if (TOP_CLAIM.test(text) && !facts.some(isTop)) return false;
  if (GROWTH_CLAIM.test(text) && !facts.some(f => f !== null && (f.growth ?? 0) > 0)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Time zone helper

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function wallOffsetMs(instant: number, timeZone: string): number {
  let f = zoneFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    zoneFormatters.set(timeZone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(instant))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` reads the given local date and time. DST safe. */
export function zonedInstant(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - wallOffsetMs(guess, timeZone);
  const second = guess - wallOffsetMs(first, timeZone);
  return new Date(second);
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared building blocks

/** A fully decided idea before the server adds id, schedule, cover and the contract shape. */
interface Plan {
  title: string; description: string; theme: ThemeKey; tagIds: string[]; goal: AiEventChoices["goal"];
  weekday: number; daypart: AiDaypart; durationMinutes: number; costBucket: AiEventChoices["budget"];
  groupSize: AiEventChoices["groupSize"]; isOutdoor: boolean; venueType: GeneratedEventDraft["venueType"];
  venueSearchHint: string; why: string; reasonBasis: DipbotIdea["reasonBasis"]; considerationIds: string[];
  source: DipbotIdea["source"]; fitLabel?: FitLabel; costCents?: number; capacity?: number;
}

interface State {
  snapshot: IdeaSnapshot;
  now: Date;
  /** Events per civil date (ISO), updated as ideas are scheduled so ideas spread over different days. */
  busy: Map<string, number>;
  covers: Set<string>;
}

const iso = (civil: Date): string => civil.toISOString().slice(0, 10);

function newState(snapshot: IdeaSnapshot, now: Date, excludeCovers: readonly string[] = []): State {
  const busy = new Map<string, number>();
  for (const e of snapshot.signals.upcomingEvents) {
    const key = iso(civilDate(e.start, snapshot.summary.timeZone));
    busy.set(key, (busy.get(key) ?? 0) + 1);
  }
  return { snapshot, now, busy, covers: new Set(excludeCovers) };
}

const DEFAULT_TIME: Readonly<Record<AiDaypart, readonly [number, number]>> = {
  weekday_morning: [9, 30], weekday_lunch: [12, 0], weekday_afternoon: [15, 0], after_work: [17, 30],
  weekend_daytime: [10, 0], weekend_evening: [18, 0],
};

/** Dates no idea is scheduled on (major year-end holidays, as MM-DD). */
const HOLIDAYS: ReadonlySet<string> = new Set(["12-24", "12-25", "12-31", "01-01"]);

/**
 * The idea's start: the earliest matching weekday in the window without a scheduled event or idea; when every one is
 * taken, a free neighboring day of the same kind (weekday or weekend) beats stacking two events on one day (eval
 * 2026-11-26). Holidays are skipped. Returns the instant at the daypart's default time and the weekday actually used.
 */
function schedule(weekday: number, daypart: AiDaypart, state: State): { at: Date; weekday: number } {
  const { timeZone } = state.snapshot.summary;
  const today = civilDate(state.now, timeZone);
  const weekend = weekday >= 6;
  let best: { day: Date; dow: number; score: number } | null = null;
  for (let offset = IDEA_LIMITS.leadDays; offset <= IDEA_LIMITS.horizonDays; offset++) {
    const day = addDays(today, offset);
    const dow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if ((dow >= 6) !== weekend || HOLIDAYS.has(iso(day).slice(5))) continue;
    const score = (state.busy.get(iso(day)) ?? 0) * 10 + Math.abs(dow - weekday) * 3 + offset / 100;
    if (best === null || score < best.score) best = { day, dow, score };
  }
  const day = best?.day ?? addDays(today, IDEA_LIMITS.leadDays);
  state.busy.set(iso(day), (state.busy.get(iso(day)) ?? 0) + 1);
  const [hour, minute] = DEFAULT_TIME[daypart];
  return { at: zonedInstant(timeZone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute), weekday: best?.dow ?? weekday };
}

const BUCKET_COST: Readonly<Record<AiEventChoices["budget"], number>> = { free: 0, under_15: 750, from_15_to_50: 3250, over_50: 7500 };
const BUCKET_NOTE: Readonly<Record<AiEventChoices["budget"], string>> = {
  free: "", under_15: "Under $15 per person", from_15_to_50: "$15 to $50 per person", over_50: "Over $50 per person",
};

function slug(title: string): string {
  const s = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "");
  return s === "" ? "idea" : s;
}

function timingOf(daypart: AiDaypart): AiEventChoices["timing"] {
  return daypart === "weekday_lunch" ? "weekday_lunch" : daypart.startsWith("weekend") ? "weekend" : "after_work";
}

function settingOf(plan: Plan): AiEventChoices["setting"] {
  if (plan.isOutdoor || plan.venueType === "park_or_outdoors") return "outdoors";
  return plan.venueType === "office" ? "indoors" : "offsite";
}

function capacityOf(plan: Plan, memberCount: number | null): number {
  if (plan.capacity !== undefined) return plan.capacity;
  const range = GROUP_CAPACITY[plan.groupSize];
  if (plan.groupSize === "company") return Math.min(range.max, Math.max(range.min, memberCount ?? 50));
  return Math.round((range.min + range.max) / 2);
}

/** Picks the cover, validates the draft against the contract and schedules the idea. Null when the draft is invalid. */
function finalize(plan: Plan, index: number, state: State): DipbotIdea | null {
  const { snapshot } = state;
  const ranked = rankCovers({ title: plan.title, description: plan.description, tagIds: plan.tagIds, theme: plan.theme, exclude: [...state.covers] });
  const coverImageURL = ranked.find(r => !state.covers.has(r.entry.url))?.entry.url ?? themeDefault(plan.theme)?.url ?? DEFAULT_COVER_URL;
  const budget = BUDGET_CENTS[plan.costBucket];
  const costCents = Math.min(budget.max, Math.max(budget.min, Math.round(plan.costCents ?? BUCKET_COST[plan.costBucket])));
  const candidate: GeneratedEventDraft = {
    title: plan.title,
    description: plan.description,
    tagIds: [...plan.tagIds],
    coverImageURL,
    suggestedDaypart: plan.daypart,
    durationMinutes: plan.durationMinutes,
    venueType: plan.venueType,
    venueSearchHint: plan.venueSearchHint,
    costCents,
    costNote: BUCKET_NOTE[plan.costBucket],
    capacity: capacityOf(plan, snapshot.summary.memberCount),
    isOutdoor: plan.isOutdoor,
    rationale: plan.why,
  };
  const checked = GeneratedEventDraftSchema.safeParse(candidate);
  if (!checked.success) return null;
  const draft: GeneratedEventDraft = { ...checked.data, tagIds: [...checked.data.tagIds] };
  const slot = schedule(plan.weekday, plan.daypart, state);
  const startsAt = slot.at.toISOString();
  state.covers.add(coverImageURL);
  const choices: AiEventChoices = {
    focusTagIds: plan.tagIds.slice(0, 3),
    goal: plan.goal,
    groupSize: plan.groupSize,
    setting: settingOf(plan),
    budget: plan.costBucket,
    timing: timingOf(plan.daypart),
  };
  return {
    id: `${slug(plan.title)}-${index + 1}`,
    title: plan.title,
    description: plan.description,
    theme: plan.theme,
    tagIds: [...plan.tagIds],
    why: plan.why,
    reasonBasis: plan.reasonBasis,
    ...(plan.fitLabel ? { fitLabel: plan.fitLabel } : {}),
    weekday: slot.weekday,
    daypart: plan.daypart,
    startsAt,
    durationMinutes: plan.durationMinutes,
    costBucket: plan.costBucket,
    groupSize: plan.groupSize,
    considerationIds: plan.considerationIds,
    coverImageURL,
    choices,
    draft,
    source: plan.source,
  };
}

interface TemplateBase {
  id: string; title: string; theme: ThemeKey; tagIds: readonly string[]; goal: AiEventChoices["goal"]; pitch: string;
  description: string; durationMinutes: number; groupSize: AiEventChoices["groupSize"]; costCents: number;
  daypart: AiDaypart; weekday: number; isOutdoor: boolean; venueType: GeneratedEventDraft["venueType"]; venueSearchHint: string;
}

/** A catalog-shaped template for an idea, so the weekly suggestions rules and questions can be reused unchanged. */
function templateOf(b: TemplateBase): IdeaTemplate {
  const range = GROUP_CAPACITY[b.groupSize];
  return {
    id: b.id, title: b.title, theme: b.theme, tagIds: [...b.tagIds], goal: b.goal, pitch: b.pitch, description: b.description,
    durationMinutes: b.durationMinutes, groupMin: range.min, groupMax: range.max, costCents: b.costCents, budget: costBucketOf(b.costCents),
    dayparts: [b.daypart], weekdays: [b.weekday], months: ALL_MONTHS, isOutdoor: b.isOutdoor, venueType: b.venueType,
    venueSearchHint: b.venueSearchHint, coverCategory: "outdoors", lowKey: false,
  };
}

function templateOfPlan(plan: Plan, id: string): IdeaTemplate {
  return templateOf({ ...plan, id, pitch: plan.why || plan.description, costCents: plan.costCents ?? BUCKET_COST[plan.costBucket] });
}

function templateOfIdea(idea: DipbotIdea): IdeaTemplate {
  return templateOf({
    id: idea.id, title: idea.title, theme: idea.theme, tagIds: idea.tagIds, goal: idea.choices.goal, pitch: idea.why || idea.description,
    description: idea.description, durationMinutes: idea.durationMinutes, groupSize: idea.groupSize, costCents: idea.draft.costCents,
    daypart: idea.daypart, weekday: idea.weekday, isOutdoor: idea.draft.isOutdoor, venueType: idea.draft.venueType,
    venueSearchHint: idea.draft.venueSearchHint,
  });
}

function recentTitles(snapshot: IdeaSnapshot): string[] {
  const since = snapshot.signals.now.getTime() - REPEAT_WINDOW_DAYS * DAY_MS;
  return snapshot.summary.eligible.filter(e => e.end.getTime() >= since).map(e => e.title);
}

const flat = (text: string, max: number): string => cleanText(text, max).replace(/\s+/g, " ").trim();

function groupSizeOf(groupMax: number): AiEventChoices["groupSize"] {
  return groupMax <= 10 ? "small" : groupMax <= 30 ? "team" : "company";
}

/** The server-built why line: a company-data reason when the company has data, else the idea's own pitch (generic). */
function serverWhy(template: IdeaTemplate, snapshot: IdeaSnapshot, genericLine: string): { why: string; reasonBasis: DipbotIdea["reasonBasis"] } {
  const { summary, signals } = snapshot;
  if (summary.dataLevel !== "none") {
    const line = reasonsFor(template, summary, signals)
      .filter(r => !r.startsWith("A good pick for"))
      .map(r => safeLine(r, IDEA_LIMITS.whyMax))
      .find(r => r !== "");
    if (line) return { why: line, reasonBasis: "company_data" };
  }
  return { why: flat(genericLine, IDEA_LIMITS.whyMax) || template.title, reasonBasis: "generic" };
}

const COMPANY_WORDS = /\b(your|you've|you|teammates?|colleagues?|coworkers?|members?|employees?|filled|signed up|picked)\b/i;

/** True when a grounded line makes a claim about this company: its numbers, event titles, weekly themes or "your" wording. */
function mentionsCompanyData(text: string, snapshot: IdeaSnapshot, companyNumbers: ReadonlySet<string>): boolean {
  if (COMPANY_WORDS.test(text)) return true;
  for (const m of text.matchAll(NUMBER_TOKEN)) if (companyNumbers.has(normalizeNumber(m[0]))) return true;
  const lower = text.toLowerCase();
  const names = [
    ...snapshot.summary.eligible.map(e => e.title),
    ...snapshot.signals.weeklyThemes.map(t => t.title),
  ];
  return names.some(n => n.trim().length >= 4 && lower.includes(n.trim().toLowerCase()));
}

// ---------------------------------------------------------------------------------------------------------------------
// Agent ideas

/**
 * A why line that fits `max` without a dangling cut: the whole line, else its first clause (before ";", ",", " and ",
 * " y "), else "" (the caller then uses the server-built reason).
 */
export function fitWhy(text: string, max: number): string {
  const line = cleanText(text, 10_000).replace(/\s+/g, " ").trim().replace(/[;,]+$/, "");
  if (Array.from(line).length <= max) return line;
  const first = line.split(/;|,| and | y /)[0]!.trim();
  return first.length >= 12 && Array.from(first).length <= max ? first : "";
}

const LUNCH_WORDS = /\b(?:lunch|almuerzo|comida del mediodía)\b/i;

function repairAgent(m: ModelIdea, snapshot: IdeaSnapshot): Plan | null {
  const title = flat(m.title, IDEA_LIMITS.titleMax);
  const description = flat(m.description, IDEA_LIMITS.descriptionMax);
  const why = fitWhy(m.why, IDEA_LIMITS.whyMax);
  if (title === "" || description === "") return null;
  if ([title, description, why].some(hasForbiddenContent)) return null;
  const hint = flat(m.venueSearchHint, 120);

  const catalogIds = new Set(snapshot.catalogTags.map(t => t.id));
  const catalogNames = new Map(snapshot.catalogTags.map(t => [t.id, t.name]));
  const mapped = m.tagIds.map(id => normalizeTagId(id, { catalogIds, catalogNames })).filter((id): id is string => id !== null);
  const main = THEME_MAIN_TAG[m.theme];
  const tagIds = [...new Set(catalogIds.has(main) ? [main, ...mapped] : mapped)].slice(0, 4);
  if (tagIds.length === 0) return null;

  let weekday = Number.isFinite(m.weekday) ? Math.min(7, Math.max(1, Math.round(m.weekday))) : 4;
  // A weekday idea that calls itself a lunch runs at lunch (eval: "lunch" cards scheduled at 3 pm).
  const daypart: AiDaypart = !m.daypart.startsWith("weekend") && LUNCH_WORDS.test(title) ? "weekday_lunch" : m.daypart;
  const weekend = daypart.startsWith("weekend");
  if (weekend && weekday < 6) weekday = 6;
  if (!weekend && weekday > 5) weekday = 4;
  const durationMinutes = Math.min(daypart === "weekday_lunch" ? 75 : 480, Number.isFinite(m.durationMinutes) ? Math.max(15, Math.round(m.durationMinutes / 15) * 15) : 60);
  const considerationIds = [...new Set(m.considerationIds.filter(id => CONSIDERATION_IDS.includes(id)))].slice(0, MAX_CONSIDERATIONS);
  return {
    title, description, theme: m.theme, tagIds, goal: m.goal, weekday, daypart, durationMinutes, costBucket: m.costBucket,
    groupSize: m.groupSize, isOutdoor: m.isOutdoor, venueType: m.venueType, venueSearchHint: hint, why, reasonBasis: "generic",
    considerationIds, source: "agent",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalog ideas

interface Candidate { template: IdeaTemplate; label: FitLabel | null }

/** Catalog candidates, best first: the ranked picks, the rest of the shortlist, the prefiltered catalog, then anything in season. */
function catalogPool(snapshot: IdeaSnapshot): Candidate[] {
  const { signals, summary } = snapshot;
  const prepared = prepare(signals);
  const ranked = finish(prepared, null, "heuristic");
  const seen = new Set<string>();
  const pool: Candidate[] = [];
  const add = (template: IdeaTemplate | undefined, label: FitLabel | null) => {
    if (!template || seen.has(template.id)) return;
    seen.add(template.id);
    pool.push({ template, label });
  };
  for (const r of ranked.ideas) add(ideaById(r.ideaId), r.label);
  for (const s of prepared.shortlist) add(s.idea, null);
  const tags = activeThemeTagIds(signals);
  const rest = prefilter(IDEA_CATALOG, summary, signals)
    .map(idea => ({ idea, score: priorScore(idea, summary, tags) }))
    .sort((a, b) => b.score - a.score || a.idea.id.localeCompare(b.idea.id));
  for (const r of rest) add(r.idea, null);
  for (const idea of IDEA_CATALOG) if (idea.months.includes(summary.month)) add(idea, null);
  return pool;
}

function catalogPlan(c: Candidate, snapshot: IdeaSnapshot): Plan {
  const idea = c.template;
  const daypart = idea.dayparts[0]!;
  const weekend = daypart.startsWith("weekend");
  const fitting = idea.weekdays.filter(d => (d >= 6) === weekend);
  const options = fitting.length > 0 ? fitting : idea.weekdays;
  let weekday = options[0] ?? (weekend ? 6 : 4);
  for (const d of options) if ((snapshot.summary.weekdayFill[d] ?? 0) > (snapshot.summary.weekdayFill[weekday] ?? 0)) weekday = d;
  if (weekend && weekday < 6) weekday = 6;
  if (!weekend && weekday > 5) weekday = 4;
  const { why, reasonBasis } = serverWhy(idea, snapshot, idea.pitch);
  const memberCount = snapshot.summary.memberCount;
  return {
    title: flat(idea.title, IDEA_LIMITS.titleMax),
    description: flat(idea.description, IDEA_LIMITS.descriptionMax),
    theme: idea.theme,
    tagIds: idea.tagIds.slice(0, 4),
    goal: idea.goal,
    weekday,
    daypart,
    durationMinutes: Math.min(480, Math.max(15, idea.durationMinutes)),
    costBucket: costBucketOf(idea.costCents),
    groupSize: groupSizeOf(idea.groupMax),
    isOutdoor: idea.isOutdoor,
    venueType: idea.venueType,
    venueSearchHint: idea.venueSearchHint,
    why,
    reasonBasis,
    considerationIds: [],
    source: "catalog",
    ...(c.label ? { fitLabel: c.label } : {}),
    costCents: idea.costCents,
    capacity: Math.max(1, Math.min(idea.groupMax, memberCount ?? idea.groupMax)),
  };
}

/** Picks catalog ideas: unused themes first, then up to the per-theme cap; skips used titles and recent repeats. */
function selectCatalog(
  snapshot: IdeaSnapshot, state: State, count: number, titles: Set<string>, themeCounts: Map<ThemeKey, number>, startIndex: number,
): DipbotIdea[] {
  const out: DipbotIdea[] = [];
  const recent = recentTitles(snapshot);
  const pool = catalogPool(snapshot);
  for (const limit of [1, IDEA_LIMITS.maxPerTheme]) {
    for (const c of pool) {
      if (out.length >= count) return out;
      const { template } = c;
      if (titles.has(template.title.toLowerCase()) || (themeCounts.get(template.theme) ?? 0) >= limit) continue;
      if (isRepeat(template, recent)) continue;
      const idea = finalize(catalogPlan(c, snapshot), startIndex + out.length, state);
      if (!idea) continue;
      titles.add(idea.title.toLowerCase());
      themeCounts.set(idea.theme, (themeCounts.get(idea.theme) ?? 0) + 1);
      out.push(idea);
    }
  }
  return out;
}

/**
 * Deterministic catalog ideas (the free fallback and the top-up): the weekly ranking's heuristic order, one idea per theme
 * first, scheduled and covered like model ideas. Default count 4 without company data, else 5.
 */
export function fallbackIdeas(
  snapshot: IdeaSnapshot, now: Date, options: { count?: number; excludeTitles?: readonly string[]; excludeCovers?: readonly string[] } = {},
): DipbotIdea[] {
  const count = options.count ?? (snapshot.summary.dataLevel === "none" ? 4 : 5);
  const titles = new Set((options.excludeTitles ?? []).map(t => t.toLowerCase()));
  return selectCatalog(snapshot, newState(snapshot, now, options.excludeCovers), count, titles, new Map(), 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Build

export interface BuiltIdeas { ideas: DipbotIdea[]; agentCount: number }

/**
 * Repairs and completes the model's ideas (clean text, catalog tags with the theme tag first, aligned day and time, no
 * repeats, grounded why lines, server schedule and cover, contract-valid draft) and tops up from the catalog to the minimum.
 */
export function buildIdeas(snapshot: IdeaSnapshot, modelIdeas: ModelIdea[] | null, traces: readonly ToolTrace[], now: Date, locale: "en" | "es" = "en"): BuiltIdeas {
  const numbers = groundedNumbers(traces);
  const companyNumbers = groundedNumbers(traces.filter(t => !NON_COMPANY_TOOLS.has(t.name)));
  const state = newState(snapshot, now);
  const recent = recentTitles(snapshot);
  const titles = new Set<string>();
  const themeCounts = new Map<ThemeKey, number>();
  const ideas: DipbotIdea[] = [];

  for (const m of modelIdeas ?? []) {
    if (ideas.length >= IDEA_LIMITS.maxIdeas) break;
    const plan = repairAgent(m, snapshot);
    if (!plan || titles.has(plan.title.toLowerCase())) continue;
    if ((themeCounts.get(plan.theme) ?? 0) >= IDEA_LIMITS.maxPerTheme) continue;
    const template = templateOfPlan(plan, "candidate");
    if (isRepeat(template, recent)) continue;

    const mentions = mentionsCompanyData(plan.why, snapshot, companyNumbers);
    const keep = plan.why !== "" && isGrounded(plan.why, numbers) && interestClaimsHold(plan.why, snapshot) && !(snapshot.summary.dataLevel === "none" && mentions);
    if (keep) {
      plan.reasonBasis = snapshot.summary.dataLevel !== "none" && mentions ? "company_data" : "generic";
    } else if (locale !== "en") {
      // The server-built reasons are English: in another language keep the idea's own first sentence (generic, no company claim).
      plan.why = flat(plan.description.split(/(?<=[.!?])\s/)[0] ?? plan.title, IDEA_LIMITS.whyMax) || plan.title;
      plan.reasonBasis = "generic";
    } else {
      const generic = ideaById(m.catalogIdeaId ?? "")?.pitch ?? plan.description.split(/(?<=[.!?])\s/)[0] ?? plan.title;
      Object.assign(plan, serverWhy(template, snapshot, generic));
    }
    const idea = finalize(plan, ideas.length, state);
    if (!idea) continue;
    titles.add(idea.title.toLowerCase());
    themeCounts.set(idea.theme, (themeCounts.get(idea.theme) ?? 0) + 1);
    ideas.push(idea);
  }
  const agentCount = ideas.length;
  if (ideas.length < IDEA_LIMITS.minIdeas) {
    ideas.push(...selectCatalog(snapshot, state, IDEA_LIMITS.minIdeas - ideas.length, titles, themeCounts, ideas.length));
  }
  return { ideas, agentCount };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ranking

/** The decision request that scores the ideas (at most 6, so at most 24 questions) over the company's aggregate state. */
export function rankingRequest(ideas: readonly DipbotIdea[], snapshot: IdeaSnapshot): { state: string; questions: Record<string, DecisionQuestion> } {
  const templates = ideas.slice(0, MAX_RANKED).map(templateOfIdea);
  return {
    state: buildState(snapshot.summary, snapshot.signals),
    questions: candidateQuestions(templates, availability(snapshot.summary, snapshot.signals)),
  };
}

/**
 * Orders the ideas by the Jev composite (answers null: the prior only) and sets the fit label (none without company data).
 * Stable: ties keep agent ideas before catalog ones, then the input order.
 */
export function applyRanking(ideas: readonly DipbotIdea[], snapshot: IdeaSnapshot, answers: Record<string, DecisionAnswer> | null): DipbotIdea[] {
  const templates = ideas.map(templateOfIdea);
  const components = interpret(answers, templates);
  const tags = activeThemeTagIds(snapshot.signals);
  return ideas
    .map((idea, index) => {
      const prior = priorScore(templates[index]!, snapshot.summary, tags);
      const score = answers ? composite(components[index]!, prior) : prior;
      const { fitLabel: _old, ...rest } = idea;
      const label = fitLabel(score, snapshot.summary.dataLevel);
      return { idea: (label ? { ...rest, fitLabel: label } : rest) as DipbotIdea, score, index };
    })
    .sort((a, b) =>
      b.score - a.score
      || (a.idea.source === b.idea.source ? 0 : a.idea.source === "agent" ? -1 : 1)
      || a.index - b.index)
    .map(r => r.idea);
}
