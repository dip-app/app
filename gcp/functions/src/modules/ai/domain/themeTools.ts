import { z } from "zod";
import { THEME_KEYS, THEME_LABELS, themeForTags, type ThemeKey } from "../../suggestions/domain/catalog";
import { addDays, civilDate, mondayOf } from "../../suggestions/domain/signals";
import { capToolOutput, runIdeaTool, safeLine } from "./ideaTools";
import type { IdeaSnapshot, IdeaToolOutput } from "./ideaTypes";
import { bucketFor } from "./interests";
import { THEME_IDEAS, type ThemeIdea } from "./themeCatalog";

/**
 * Snapshot, limits and read-only tools of Dipbot Suggest theme (docs/design/stretch/dipbot-suggest-theme.md). Like the
 * daily ideas, every tool reads one snapshot the server loaded for the caller's own company BEFORE the model runs; no tool
 * takes a company argument. Outputs are aggregates and company-owned titles only: interest counts as buckets at or above
 * the privacy floor of 5 members, theme participation as the same buckets, never names, emails or per-member data.
 */

export const THEME_LIMITS = {
  maxToolCalls: 6,
  /** Model turns, the forced final turn included (the bounded retry is one more). */
  maxTurns: 4,
  deadlineMs: 25_000,
  maxToolResultChars: 3000,
  maxOutputTokens: 1500,
  /** Generous input bound of one turn for pricing (instructions, hint and tool results). */
  maxInputTokensPerTurn: 8000,
  /** One suggestion plus up to three alternatives; at least three (topped up from the catalog). */
  maxSuggestions: 4,
  minSuggestions: 3,
  /** Same limits as a weekly theme (CHALLENGE_LIMITS.titleMax) and a short description that fits the form. */
  titleMax: 60,
  descriptionMax: 400,
  whyMax: 120,
  maxWhy: 3,
  maxTags: 4,
  hintMax: 200,
  /** Weeks the portal offers ahead; free weeks are looked for in this window. */
  weeksAhead: 12,
  /** Past themes this recent (and every scheduled one) are never repeated. */
  duplicateWindowWeeks: 26,
  /** An illustration used this recently counts as "not fresh" for the ranking. */
  freshWeeks: 8,
  /** Past events this recent are also never repeated as a theme title. */
  eventWindowDays: 42,
} as const;

/** The portal's theme weeks are Monday to Sunday in this zone (apps/admin/src/lib/weeks.ts THEME_TIME_ZONE). */
export const THEME_TIME_ZONE = "America/New_York";

export const THEME_TOOL_NAMES = [
  "getTagUsage", "getPastThemes", "getPastEvents", "getAttendanceTrends", "getAvailableWeeks", "getThemeCatalog",
] as const;
export type ThemeToolName = (typeof THEME_TOOL_NAMES)[number];

/** One weekly theme of the company (past, running or scheduled). */
export interface ThemeRecord {
  title: string;
  tagIds: string[];
  /** Illustration key from `catalog://theme/<key>`, else null. */
  themeKey: ThemeKey | null;
  startDate: Date;
  endDate: Date;
  /** Exact participants; only ever emitted as a bucket at or above the privacy floor. */
  participantCount: number;
}

export interface ThemeSnapshot {
  idea: IdeaSnapshot;
  /** Themes that started in the last `duplicateWindowWeeks` weeks or are scheduled in the next `weeksAhead`, oldest first. */
  themes: ThemeRecord[];
  /** Free Mondays (civil "YYYY-MM-DD" in THEME_TIME_ZONE) in the next `weeksAhead` weeks, starting next week. */
  freeWeeks: string[];
  /** Mondays already taken by a theme in the same window, with that theme's title. */
  takenWeeks: Array<{ weekStart: string; title: string }>;
}

export interface ThemeToolDefinition { name: ThemeToolName; description: string; args: z.ZodObject<z.ZodRawShape> }
export interface ThemeTrace { name: ThemeToolName; ok: boolean; output: IdeaToolOutput }

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const iso = (civil: Date): string => civil.toISOString().slice(0, 10);

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: THEME_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});
function zoneOffset(instant: number): number {
  const p: Record<string, number> = {};
  for (const part of offsetFormatter.formatToParts(new Date(instant))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) - Math.floor(instant / 1000) * 1000;
}

/** 00:00 of a civil date in the theme zone, as an instant (DST safe, like the portal's startOfDay). */
export function themeDayStart(civil: Date): Date {
  const guess = civil.getTime();
  const first = guess - zoneOffset(guess);
  return new Date(guess - zoneOffset(first));
}

/** Monday of next week in the theme zone (the portal's `nextMonday`). */
export function nextThemeMonday(now: Date): Date {
  return addDays(mondayOf(civilDate(now, THEME_TIME_ZONE)), 7);
}

/** Illustration key of a stored `coverImageURL`. */
export function themeKeyOfUrl(url: unknown): ThemeKey | null {
  if (typeof url !== "string") return null;
  const key = /^catalog:\/\/theme\/([a-z]+)$/.exec(url)?.[1];
  return (THEME_KEYS as readonly string[]).includes(key ?? "") ? (key as ThemeKey) : null;
}

/** Free and taken Mondays in the window: a week is taken when any theme overlaps Monday 00:00 to Sunday 23:59:59. */
export function weekSlots(themes: readonly ThemeRecord[], now: Date, weeks: number = THEME_LIMITS.weeksAhead): Pick<ThemeSnapshot, "freeWeeks" | "takenWeeks"> {
  const freeWeeks: string[] = [];
  const takenWeeks: ThemeSnapshot["takenWeeks"] = [];
  const first = nextThemeMonday(now);
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(first, w * 7);
    const start = themeDayStart(monday).getTime();
    const end = themeDayStart(addDays(monday, 7)).getTime() - 1000;
    const clash = themes.find(t => t.startDate.getTime() <= end && t.endDate.getTime() >= start);
    if (clash) takenWeeks.push({ weekStart: iso(monday), title: clash.title });
    else freeWeeks.push(iso(monday));
  }
  return { freeWeeks, takenWeeks };
}

export function themeSnapshot(idea: IdeaSnapshot, themes: readonly ThemeRecord[]): ThemeSnapshot {
  const sorted = [...themes].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return { idea, themes: sorted, ...weekSlots(sorted, idea.signals.now) };
}

/** Themes that started on or before now and within the duplicate window. */
export function pastThemes(snapshot: ThemeSnapshot): ThemeRecord[] {
  const now = snapshot.idea.signals.now.getTime();
  return snapshot.themes.filter(t => t.startDate.getTime() <= now && now - t.startDate.getTime() <= THEME_LIMITS.duplicateWindowWeeks * WEEK_MS);
}

export function scheduledThemes(snapshot: ThemeSnapshot): ThemeRecord[] {
  const now = snapshot.idea.signals.now.getTime();
  return snapshot.themes.filter(t => t.startDate.getTime() > now);
}

const weeksAgo = (snapshot: ThemeSnapshot, t: ThemeRecord) =>
  Math.max(0, Math.round((snapshot.idea.signals.now.getTime() - t.startDate.getTime()) / WEEK_MS));

const weekOf = (t: ThemeRecord) => iso(mondayOf(civilDate(t.startDate, THEME_TIME_ZONE)));

const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** Catalog theme ideas that fit the month, the requested illustration first when given. */
export function catalogFor(snapshot: ThemeSnapshot, theme: ThemeKey | null = null): ThemeIdea[] {
  const month = snapshot.idea.summary.month;
  return THEME_IDEAS.filter(i => i.months.includes(month) && (theme === null || i.theme === theme));
}

type Args = Record<string, unknown>;
interface Tool { definition: ThemeToolDefinition; run(snapshot: ThemeSnapshot, args: Args): IdeaToolOutput }

const themeArg = z.enum(THEME_KEYS).nullable().describe("Only this theme illustration, or null for all.");

/** The idea tools that read the same aggregates: tag buckets, past events and fill trends. */
function delegate(name: "getTagUsage" | "getPastEvents" | "getAttendanceTrends") {
  return (snapshot: ThemeSnapshot, args: Args): IdeaToolOutput => {
    const result = runIdeaTool(snapshot.idea, name, args);
    if (!result.ok) throw new Error("tool failed");
    return result.output;
  };
}

function getPastThemes(snapshot: ThemeSnapshot, args: Args): IdeaToolOutput {
  const sinceWeeks = clampInt(args.sinceWeeks, 4, THEME_LIMITS.duplicateWindowWeeks, THEME_LIMITS.duplicateWindowWeeks);
  const now = snapshot.idea.signals.now.getTime();
  const past = pastThemes(snapshot)
    .filter(t => now - t.startDate.getTime() <= sinceWeeks * WEEK_MS)
    .reverse()
    .map(t => ({
      title: safeLine(t.title, 60) || "Untitled theme", theme: t.themeKey ?? themeForTags(t.tagIds), tagIds: t.tagIds.slice(0, 4),
      weekStart: weekOf(t), weeksAgo: weeksAgo(snapshot, t), joined: bucketFor(t.participantCount),
    }));
  const scheduled = scheduledThemes(snapshot).map(t => ({
    title: safeLine(t.title, 60) || "Untitled theme", theme: t.themeKey ?? themeForTags(t.tagIds), tagIds: t.tagIds.slice(0, 4), weekStart: weekOf(t),
  }));
  return { sinceWeeks, past, scheduled };
}

function getAvailableWeeks(snapshot: ThemeSnapshot): IdeaToolOutput {
  return { freeWeeks: snapshot.freeWeeks, takenWeeks: snapshot.takenWeeks.map(w => ({ weekStart: w.weekStart, title: safeLine(w.title, 60) })) };
}

function getThemeCatalog(snapshot: ThemeSnapshot, args: Args): IdeaToolOutput {
  const theme = (args.theme as ThemeKey | null) ?? null;
  return {
    themes: catalogFor(snapshot, theme).slice(0, 12).map(i => ({
      // No titles, so the model writes its own instead of copying one (eval 2026-11-26).
      id: i.id, theme: i.theme, themeLabel: THEME_LABELS[i.theme], tagIds: i.tagIds, description: i.description,
    })),
  };
}

const def = (name: ThemeToolName, description: string, args: z.ZodRawShape): ThemeToolDefinition => ({ name, description, args: z.object(args) });

const TOOLS: readonly Tool[] = [
  {
    definition: def("getTagUsage", "Member interests with at least 5 members, as size buckets (5-9, 10-19, 20+), with monthly growth when known.", {}),
    run: delegate("getTagUsage"),
  },
  {
    definition: def("getPastThemes", "This company's weekly themes: past ones (title, illustration theme, tags, week, weeks ago, participation bucket when 5 or more joined) and scheduled ones. Never repeat these.", {
      sinceWeeks: z.number().int().nullable().describe("Look back this many weeks, 4 to 26. null means 26."),
    }),
    run: getPastThemes,
  },
  {
    definition: def("getPastEvents", "Recent events this company held: title, theme, weekday, time of day, attendees, capacity, fill percent and cost bucket. Newest first.", {
      sinceDays: z.number().int().nullable().describe("Look back this many days, 7 to 180. null means 90."),
      theme: themeArg,
      limit: z.number().int().nullable().describe("Maximum events, 1 to 20. null means 12."),
    }),
    run: delegate("getPastEvents"),
  },
  {
    definition: def("getAttendanceTrends", "Average fill percent and event count by weekday, time of day and theme. Groups with fewer than 2 events are left out.", {}),
    run: delegate("getAttendanceTrends"),
  },
  {
    definition: def("getAvailableWeeks", "Free weeks (Monday dates) in the next 12 weeks and the weeks already taken by a theme.", {}),
    run: getAvailableWeeks,
  },
  {
    definition: def("getThemeCatalog", "Curated weekly theme ideas that fit the season, as inspiration (no titles: write your own). Never repeat a past theme.", { theme: themeArg }),
    run: getThemeCatalog,
  },
];

export function themeToolDefinitions(): readonly ThemeToolDefinition[] {
  return TOOLS.map(t => t.definition);
}

const TOOL_BY_NAME: ReadonlyMap<string, Tool> = new Map(TOOLS.map(t => [t.definition.name, t]));

type RunResult = ThemeTrace | { name: null; ok: false; output: IdeaToolOutput };

/** Runs one tool call against the snapshot. Unknown tools and bad arguments return an error object; unknown keys are stripped. */
export function runThemeTool(snapshot: ThemeSnapshot, name: string, rawArgs: unknown): RunResult {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { name: null, ok: false, output: { error: "unknown tool" } };
  const toolName = tool.definition.name;
  const invalid: RunResult = { name: toolName, ok: false, output: { error: "invalid arguments" } };
  let value: unknown = rawArgs;
  if (typeof rawArgs === "string") {
    try { value = rawArgs.trim() === "" ? {} : JSON.parse(rawArgs); } catch { return invalid; }
  }
  if (value === null || value === undefined) value = {};
  if (typeof value !== "object" || Array.isArray(value)) return invalid;
  const filled: Args = { ...(value as Args) };
  for (const key of Object.keys(tool.definition.args.shape)) if (filled[key] === undefined) filled[key] = null;
  const parsed = tool.definition.args.safeParse(filled);
  if (!parsed.success) return invalid;
  try {
    return { name: toolName, ok: true, output: capToolOutput(tool.run(snapshot, parsed.data), THEME_LIMITS.maxToolResultChars) };
  } catch {
    return { name: toolName, ok: false, output: { error: "tool failed" } };
  }
}

/**
 * The model's final answer (strict structured output). Lengths and counts are enforced by the server repair step, so a
 * slightly long answer is repaired rather than rejected.
 */
export function modelThemesSchema(catalogTagIds: readonly string[], freeWeeks: readonly string[]) {
  const tagId = catalogTagIds.length > 0 ? z.enum(catalogTagIds as [string, ...string[]]) : z.string();
  const week = freeWeeks.length > 0 ? z.enum(freeWeeks as [string, ...string[]]).nullable() : z.null();
  const theme = z.object({
    title: z.string().describe("Catchy, specific weekly theme title, 2 to 5 words, at most 40 characters."),
    description: z.string().describe("2 short sentences: what members do during the week, then what they post. At most 220 characters."),
    themeKey: z.enum(THEME_KEYS).describe("The illustration that fits best."),
    tagIds: z.array(tagId).describe("1 to 4 catalog tag ids, the theme's own tag first."),
    weekStart: week.describe("A free week from getAvailableWeeks, or null to let the server pick the first free week."),
    why: z.array(z.string()).describe("1 or 2 lines (each at most 90 characters), each naming one company fact from the tool results; no invented numbers."),
    catalogThemeId: z.string().nullable().describe("The catalog theme id it was inspired by, or null."),
  }).strict();
  return z.object({ themes: z.array(theme).describe("4 different weekly themes, best first, with different illustrations.") }).strict();
}
export type ModelThemes = z.infer<ReturnType<typeof modelThemesSchema>>;
export type ModelTheme = ModelThemes["themes"][number];
