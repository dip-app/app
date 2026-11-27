/**
 * Hard checks of the Dipbot evaluation: deterministic, free, run on the RAW model answer (before the server repairs it)
 * so prompt quality is visible, plus a few on the final answer the admin sees. Every check counts problems; 0 is clean.
 */
import { hasForbiddenContent } from "../../../functions/src/modules/ai/domain/drafts";
import { groundedNumbers, isGrounded } from "../../../functions/src/modules/ai/domain/ideaValidate";
import type { ModelIdea, ToolTrace } from "../../../functions/src/modules/ai/domain/ideaTypes";
import { titleSimilarity } from "../../../functions/src/modules/ai/domain/themeValidate";
import type { ModelTheme } from "../../../functions/src/modules/ai/domain/themeTools";

const ES = new Set(["el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una", "para", "con", "por", "se", "tu", "tus", "es", "al", "su", "más", "como", "lo", "cada", "equipo", "semana"]);
const EN = new Set(["the", "and", "to", "of", "a", "in", "for", "with", "your", "is", "on", "at", "it", "this", "from", "or", "be", "team", "week", "you"]);

/** "es", "en" or "unknown" by stopword counts (good enough to catch a whole answer in the wrong language). */
export function languageOf(text: string): "es" | "en" | "unknown" {
  const words = text.toLowerCase().normalize("NFC").match(/[a-záéíóúñü]+/g) ?? [];
  let es = 0;
  let en = 0;
  for (const w of words) { if (ES.has(w)) es += 1; if (EN.has(w)) en += 1; }
  if (es + en < 3) return "unknown";
  return es > en * 1.5 ? "es" : en > es * 1.5 ? "en" : "unknown";
}

const EM_DASH = /[—–]/;
const ALCOHOL = /\b(?:beer|wine|cocktails?|happy hour|brewery|bar crawl|pub crawl|shots?|tequila|vino|cerveza)\b/i;
const NUMBER = /\d/;

export interface IdeaChecks {
  answered: boolean;
  rawCount: number;
  countOk: boolean;
  distinctThemes: number;
  overThemeCap: number;
  ungroundedWhy: number;
  noDataClaims: number;
  overLength: number;
  forbidden: number;
  emDashes: number;
  repeatsOfPast: number;
  internalDuplicates: number;
  misalignedDay: number;
  wrongLanguage: number;
  alcoholCentered: number;
  catalogCopies: number;
  /** Problems summed (countOk false counts 1); the headline hard-check number. */
  problems: number;
}

const COMPANY_WORDS = /\b(your|you've|teammates?|colleagues?|coworkers?|members?|employees?|filled|signed up|picked|tu|tus|equipo|compañeros)\b/i;

function similarToAny(title: string, others: readonly string[], threshold = 0.6): boolean {
  return others.some(o => titleSimilarity(title, o) >= threshold);
}

function internalDupes(titles: readonly string[]): number {
  let n = 0;
  titles.forEach((a, i) => { if (titles.slice(0, i).some(b => titleSimilarity(a, b) >= 0.6)) n += 1; });
  return n;
}

export function checkIdeas(raw: ModelIdea[] | null, traces: readonly ToolTrace[], ctx: {
  locale: "en" | "es"; dataLevel: string; mustNotRepeat: readonly string[]; pastTitles: readonly string[]; catalogTitles: readonly string[];
}): IdeaChecks {
  const ideas = raw ?? [];
  const numbers = groundedNumbers(traces);
  const themes = new Map<string, number>();
  for (const i of ideas) themes.set(i.theme, (themes.get(i.theme) ?? 0) + 1);
  const avoid = [...ctx.mustNotRepeat, ...ctx.pastTitles];
  const c: IdeaChecks = {
    answered: raw !== null,
    rawCount: ideas.length,
    countOk: ideas.length >= 4 && ideas.length <= 6,
    distinctThemes: themes.size,
    overThemeCap: [...themes.values()].filter(n => n > 2).length,
    ungroundedWhy: ideas.filter(i => !isGrounded(i.why, numbers)).length,
    noDataClaims: ctx.dataLevel === "none" ? ideas.filter(i => COMPANY_WORDS.test(i.why) || NUMBER.test(i.why)).length : 0,
    overLength: ideas.filter(i => i.title.length > 80 || i.description.length > 400 || i.why.length > 96).length,
    forbidden: ideas.filter(i => [i.title, i.description, i.why, i.venueSearchHint].some(hasForbiddenContent)).length,
    emDashes: ideas.filter(i => EM_DASH.test(`${i.title} ${i.description} ${i.why}`)).length,
    repeatsOfPast: ideas.filter(i => similarToAny(i.title, avoid)).length,
    internalDuplicates: internalDupes(ideas.map(i => i.title)),
    misalignedDay: ideas.filter(i => (i.daypart.startsWith("weekend") ? i.weekday < 6 : i.weekday > 5)).length,
    wrongLanguage: ideas.filter(i => { const l = languageOf(`${i.title}. ${i.description} ${i.why}`); return l !== "unknown" && l !== ctx.locale; }).length,
    alcoholCentered: ideas.filter(i => ALCOHOL.test(`${i.title} ${i.description}`)).length,
    catalogCopies: ideas.filter(i => ctx.catalogTitles.some(t => t.toLowerCase() === i.title.toLowerCase())).length,
    problems: 0,
  };
  c.problems = (c.answered ? 0 : 1) + (c.countOk ? 0 : 1) + (c.distinctThemes >= 3 || !c.answered ? 0 : 1) + c.overThemeCap + c.ungroundedWhy + c.noDataClaims
    + c.overLength + c.forbidden + c.emDashes + c.repeatsOfPast + c.internalDuplicates + c.misalignedDay + c.wrongLanguage + c.alcoholCentered;
  return c;
}

export interface ThemeChecks {
  answered: boolean;
  rawCount: number;
  countOk: boolean;
  distinctIllustrations: number;
  ungroundedWhy: number;
  noDataClaims: number;
  overLength: number;
  forbidden: number;
  emDashes: number;
  repeatsOfPast: number;
  internalDuplicates: number;
  wrongLanguage: number;
  badWeek: number;
  problems: number;
}

export function checkThemes(raw: ModelTheme[] | null, traces: readonly ToolTrace[], ctx: {
  locale: "en" | "es"; dataLevel: string; mustNotRepeat: readonly string[]; freeWeeks: readonly string[];
}): ThemeChecks {
  const themes = raw ?? [];
  const numbers = groundedNumbers(traces);
  const c: ThemeChecks = {
    answered: raw !== null,
    rawCount: themes.length,
    countOk: themes.length === 4,
    distinctIllustrations: new Set(themes.map(t => t.themeKey)).size,
    ungroundedWhy: themes.filter(t => t.why.some(w => !isGrounded(w, numbers))).length,
    noDataClaims: ctx.dataLevel === "none" ? themes.filter(t => t.why.some(w => COMPANY_WORDS.test(w) || NUMBER.test(w))).length : 0,
    overLength: themes.filter(t => t.title.length > 60 || t.description.length > 300 || t.why.some(w => w.length > 100) || t.why.length > 3).length,
    forbidden: themes.filter(t => [t.title, t.description, ...t.why].some(hasForbiddenContent)).length,
    emDashes: themes.filter(t => EM_DASH.test(`${t.title} ${t.description} ${t.why.join(" ")}`)).length,
    repeatsOfPast: themes.filter(t => similarToAny(t.title, ctx.mustNotRepeat)).length,
    internalDuplicates: internalDupes(themes.map(t => t.title)),
    wrongLanguage: themes.filter(t => { const l = languageOf(`${t.title}. ${t.description} ${t.why.join(" ")}`); return l !== "unknown" && l !== ctx.locale; }).length,
    badWeek: themes.filter(t => t.weekStart !== null && !ctx.freeWeeks.includes(t.weekStart)).length,
    problems: 0,
  };
  c.problems = (c.answered ? 0 : 1) + (c.countOk ? 0 : 1) + (c.distinctIllustrations >= Math.min(4, c.rawCount) ? 0 : 1) + c.ungroundedWhy + c.noDataClaims
    + c.overLength + c.forbidden + c.emDashes + c.repeatsOfPast + c.internalDuplicates + c.wrongLanguage + c.badWeek;
  return c;
}

export interface DraftChecks {
  valid: boolean;
  count: number;
  overLength: number;
  forbidden: number;
  emDashes: number;
  internalDuplicates: number;
  wrongLanguage: number;
  alcoholCentered: number;
  namedVenue: number;
  problems: number;
}

const VENUE_WORDS = "Cafe|Café|Bar|Park|Center|Centre|Grill|Brewery|Gym|Museum|Lounge|Bowl|Studio|Gallery|Theater|Theatre|Arena|Hotel";
const NAMED_VENUE = new RegExp(`\\b(?:[A-Z][\\w'’&-]+\\s+){1,3}(?:${VENUE_WORDS})\\b`);

export function checkDrafts(raw: Array<Record<string, unknown>>, ctx: { locale: "en" | "es"; expected: number; valid: boolean; allowAlcohol: boolean }): DraftChecks {
  const s = (d: Record<string, unknown>, k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const c: DraftChecks = {
    valid: ctx.valid,
    count: raw.length,
    overLength: raw.filter(d => s(d, "title").length > 80 || s(d, "description").length > 800 || s(d, "rationale").length > 140 || s(d, "costNote").length > 120).length,
    forbidden: raw.filter(d => ["title", "description", "rationale", "costNote", "venueSearchHint"].some(k => hasForbiddenContent(s(d, k)))).length,
    emDashes: raw.filter(d => EM_DASH.test(`${s(d, "title")} ${s(d, "description")} ${s(d, "rationale")}`)).length,
    internalDuplicates: internalDupes(raw.map(d => s(d, "title"))),
    wrongLanguage: raw.filter(d => { const l = languageOf(`${s(d, "title")}. ${s(d, "description")} ${s(d, "rationale")}`); return l !== "unknown" && l !== ctx.locale; }).length,
    alcoholCentered: ctx.allowAlcohol ? 0 : raw.filter(d => ALCOHOL.test(s(d, "title"))).length,
    namedVenue: raw.filter(d => NAMED_VENUE.test(`${s(d, "venueSearchHint")}\n${s(d, "title")}`)).length,
    problems: 0,
  };
  c.problems = (c.valid ? 0 : 1) + (raw.length === ctx.expected ? 0 : 1) + c.overLength + c.forbidden + c.emDashes + c.internalDuplicates + c.wrongLanguage + c.alcoholCentered + c.namedVenue;
  return c;
}
