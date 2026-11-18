import { createHash } from "node:crypto";
import { z } from "zod";
import { COVER_INDEX } from "../../covers/domain/catalog.generated";
import { isEligible } from "../../covers/domain/shortlist";
import { IDEA_CATALOG, THEME_KEYS, themeForTags, type ThemeKey } from "../../suggestions/domain/catalog";
import {
  WEEKDAY_NAMES, addDays, civilDate, daypartOf, localParts, summarize, type CompanySignals, type PastEvent,
} from "../../suggestions/domain/signals";
import type { CatalogTag } from "../application/ports";
import { CONSIDERATION_CATALOG_VERSION } from "./considerations";
import { cleanText, hasForbiddenContent } from "./drafts";
import { SUPPRESSION_THRESHOLD, bucketFor } from "./interests";
import {
  IDEA_LIMITS, type IdeaSnapshot, type IdeaToolDefinition, type IdeaToolName, type IdeaToolOutput, type ToolTrace,
} from "./ideaTypes";
import type { AiEventChoices } from "../../../generated/models";

/**
 * Read-only data tools of Dipbot daily ideas (docs/design/stretch/dipbot-daily-ideas.md). Every tool reads the one
 * tenant-scoped snapshot; none takes a company argument. Outputs are aggregates only: no descriptions, venues, creators,
 * emails, names of people or interest counts under the privacy floor.
 */

/** Bump when the idea algorithm changes so cached ideas are regenerated (part of the fingerprint). */
export const IDEA_ALGORITHM_VERSION = 1;

const DAY_MS = 86_400_000;
const PAST_EVENT_TITLE_MAX = 60;
const MIN_CELL_EVENTS = 2;
const CATALOG_ROWS = 12;
const COVER_LABELS = 20;

/** Builds the snapshot the tools read. */
export function ideaSnapshot(signals: CompanySignals, catalogTags: readonly CatalogTag[]): IdeaSnapshot {
  return { signals, summary: summarize(signals), catalogTags };
}

/** Typical per-person cost bucket for a cost in cents. */
export function costBucketOf(costCents: number): AiEventChoices["budget"] {
  return costCents <= 0 ? "free" : costCents < 1500 ? "under_15" : costCents <= 5000 ? "from_15_to_50" : "over_50";
}

/** Company-owned text made safe for a tool result: emails and links removed, one line, clamped. Empty when unsafe. */
export function safeLine(text: string, max: number): string {
  const flat = cleanText(text.replace(/\S+@\S+/g, " "), max).replace(/\s+/g, " ").trim();
  return hasForbiddenContent(flat) ? "" : flat;
}

const clampInt = (value: number | null | undefined, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

const iso = (civil: Date): string => civil.toISOString().slice(0, 10);

function fillOf(e: PastEvent): number | null {
  return e.capacity > 0 ? Math.min(1, Math.max(0, e.attendeeCount / e.capacity)) : null;
}

/** Aggregated fill cells shared by the trends tool and the fingerprint. */
interface Cell { key: string; events: number; fillPercent: number | null }

function cellsBy(events: readonly PastEvent[], keyOf: (e: PastEvent) => string | null): Cell[] {
  const groups = new Map<string, PastEvent[]>();
  for (const e of events) {
    const key = keyOf(e);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()]
    .map(([key, list]): Cell => {
      const fills = list.map(fillOf).filter((f): f is number => f !== null);
      return { key, events: list.length, fillPercent: fills.length === 0 ? null : Math.round(100 * fills.reduce((a, b) => a + b, 0) / fills.length) };
    })
    .filter(cell => cell.events >= MIN_CELL_EVENTS)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function trendCells(snapshot: IdeaSnapshot) {
  const { eligible, timeZone } = snapshot.summary;
  return {
    byWeekday: cellsBy(eligible, e => WEEKDAY_NAMES[localParts(e.start, timeZone).isoWeekday - 1] ?? null),
    byDaypart: cellsBy(eligible, e => daypartOf(e.start, timeZone)),
    byTheme: cellsBy(eligible, e => themeForTags(e.tagIds)),
  };
}

/** Key of the cell with the highest fill (ties by key); null when none has a fill. */
function leader(cells: readonly Cell[]): string | null {
  let best: Cell | null = null;
  for (const c of cells) if (c.fillPercent !== null && (best === null || c.fillPercent > best.fillPercent!)) best = c;
  return best?.key ?? null;
}

const themeArg = z.enum(THEME_KEYS).nullable().describe("Only this theme, or null for all themes.");

type Args = Record<string, unknown>;
interface Tool { definition: IdeaToolDefinition; run(snapshot: IdeaSnapshot, args: Args): IdeaToolOutput }

function def(name: IdeaToolName, description: string, args: z.ZodRawShape): IdeaToolDefinition {
  return { name, description, args: z.object(args) };
}

function getPastEvents(snapshot: IdeaSnapshot, args: Args): IdeaToolOutput {
  const { signals, summary } = snapshot;
  const sinceDays = clampInt(args.sinceDays as number | null, 7, 180, 90);
  const limit = clampInt(args.limit as number | null, 1, 20, 12);
  const theme = (args.theme as ThemeKey | null) ?? null;
  const since = signals.now.getTime() - sinceDays * DAY_MS;
  const events = summary.eligible
    .filter(e => e.end.getTime() >= since && (theme === null || themeForTags(e.tagIds) === theme))
    .slice(0, limit)
    .map(e => {
      const fill = fillOf(e);
      return {
        title: safeLine(e.title, PAST_EVENT_TITLE_MAX) || "Untitled event",
        theme: themeForTags(e.tagIds),
        tagIds: e.tagIds.slice(0, 4),
        weekday: WEEKDAY_NAMES[localParts(e.start, summary.timeZone).isoWeekday - 1],
        daypart: daypartOf(e.start, summary.timeZone),
        attendeeCount: e.attendeeCount,
        capacity: e.capacity,
        fillPercent: fill === null ? null : Math.round(fill * 100),
        costBucket: costBucketOf(e.costCents),
      };
    });
  return { sinceDays, events };
}

function getTagUsage(snapshot: IdeaSnapshot): IdeaToolOutput {
  const before = new Map((snapshot.signals.interestsMonthAgo ?? []).map(t => [t.tagId, t.memberCount]));
  const interests = snapshot.summary.interests
    .filter(i => i.members >= SUPPRESSION_THRESHOLD)
    .map(i => {
      const prior = before.get(i.tagId);
      const row: Record<string, unknown> = { tagId: i.tagId, name: safeLine(i.name, 40) || i.tagId, bucket: bucketFor(i.members) };
      row.monthlyGrowth = prior !== undefined && prior >= SUPPRESSION_THRESHOLD ? Math.round(i.members - prior) : null;
      return row;
    });
  return { interests };
}

function getUpcomingCalendar(snapshot: IdeaSnapshot, args: Args): IdeaToolOutput {
  const { signals, summary } = snapshot;
  const days = clampInt(args.days as number | null, 7, 28, 28);
  const today = civilDate(signals.now, summary.timeZone);
  const end = addDays(today, days).getTime();
  const perDay = new Map<string, number>();
  for (const e of signals.upcomingEvents) {
    const c = civilDate(e.start, summary.timeZone);
    if (c.getTime() < today.getTime() || c.getTime() > end) continue;
    perDay.set(iso(c), (perDay.get(iso(c)) ?? 0) + 1);
  }
  const weeks = summary.busyWeeks.map(w => ({ weekStart: iso(w.weekStart), events: w.events }));
  let busiest = weeks[0]!;
  for (const w of weeks) if (w.events > busiest.events) busiest = w;
  return {
    days: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, events]) => ({ date, events })),
    weeks,
    quietestWeekStart: iso(summary.quietestWeekStart),
    busiestWeekStart: busiest.weekStart,
    weeklyThemes: signals.weeklyThemes
      .filter(t => t.endDate.getTime() >= signals.now.getTime())
      .slice(0, 6)
      .map(t => ({ title: safeLine(t.title, 60), tagIds: t.tagIds.slice(0, 4), startDate: iso(t.startDate), endDate: iso(t.endDate) })),
  };
}

function getAttendanceTrends(snapshot: IdeaSnapshot): IdeaToolOutput {
  const cells = trendCells(snapshot);
  return {
    byWeekday: cells.byWeekday.map(c => ({ weekday: c.key, events: c.events, fillPercent: c.fillPercent })),
    byDaypart: cells.byDaypart.map(c => ({ daypart: c.key, events: c.events, fillPercent: c.fillPercent })),
    byTheme: cells.byTheme.map(c => ({ theme: c.key, events: c.events, fillPercent: c.fillPercent })),
  };
}

/** Round-robin over groups so a short list still spans several themes. */
function spread<T>(items: readonly T[], groupOf: (item: T) => string, max: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(groupOf(item), [...(groups.get(groupOf(item)) ?? []), item]);
  const out: T[] = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const list of groups.values()) {
      if (round < list.length && out.length < max) { out.push(list[round]!); added = true; }
    }
    if (!added) break;
  }
  return out;
}

function getIdeaCatalog(snapshot: IdeaSnapshot, args: Args): IdeaToolOutput {
  const theme = (args.theme as ThemeKey | null) ?? null;
  const fitting = IDEA_CATALOG.filter(i => i.months.includes(snapshot.summary.month) && (theme === null || i.theme === theme));
  return {
    ideas: spread(fitting, i => i.theme, CATALOG_ROWS).map(i => ({
      id: i.id, title: i.title, pitch: i.pitch, theme: i.theme, tagIds: i.tagIds, costBucket: i.budget,
      groupMin: i.groupMin, groupMax: i.groupMax, durationMinutes: i.durationMinutes,
    })),
  };
}

function getAvailableCoverLabels(_snapshot: IdeaSnapshot, args: Args): IdeaToolOutput {
  const theme = (args.theme as ThemeKey | null) ?? null;
  const seen = new Set<string>();
  const entries = COVER_INDEX
    .filter(e => isEligible(e) && (theme === null || e.themes.includes(theme)))
    .filter(e => { const k = e.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { labels: spread(entries, e => e.themes[0] ?? "", COVER_LABELS).map(e => e.label) };
}

const TOOLS: readonly Tool[] = [
  {
    definition: def("getPastEvents", "Recent events this company held: title, theme, weekday, time of day, attendees, capacity, fill percent and cost bucket. Newest first.", {
      sinceDays: z.number().int().nullable().describe("Look back this many days, 7 to 180. null means 90."),
      theme: themeArg,
      limit: z.number().int().nullable().describe("Maximum events, 1 to 20. null means 12."),
    }),
    run: getPastEvents,
  },
  {
    definition: def("getTagUsage", "Member interests with at least 5 members, as size buckets (5-9, 10-19, 20+), with monthly growth when known.", {}),
    run: getTagUsage,
  },
  {
    definition: def("getUpcomingCalendar", "Scheduled event counts per day and per week, the quietest and busiest week, and the active weekly challenge themes.", {
      days: z.number().int().nullable().describe("Days ahead, 7 to 28. null means 28."),
    }),
    run: getUpcomingCalendar,
  },
  {
    definition: def("getAttendanceTrends", "Average fill percent and event count by weekday, by time of day and by theme. Groups with fewer than 2 events are left out.", {}),
    run: getAttendanceTrends,
  },
  {
    definition: def("getIdeaCatalog", "Up to 12 curated event ideas that fit the current month, as inspiration. Never copy blindly.", { theme: themeArg }),
    run: getIdeaCatalog,
  },
  {
    definition: def("getAvailableCoverLabels", "Up to 20 labels of available cover pictures, so event titles can match a picture.", { theme: themeArg }),
    run: getAvailableCoverLabels,
  },
];

/** The six tools in the order of the design doc, for the provider request. */
export function ideaToolDefinitions(): readonly IdeaToolDefinition[] {
  return TOOLS.map(t => t.definition);
}

const TOOL_BY_NAME: ReadonlyMap<string, Tool> = new Map(TOOLS.map(t => [t.definition.name, t]));

/**
 * Drops trailing rows from the largest array fields until the serialized JSON fits `maxChars`, then adds
 * `truncated: true`. Output stays valid JSON; strings are never cut.
 */
export function capToolOutput(output: IdeaToolOutput, maxChars: number = IDEA_LIMITS.maxToolResultChars): IdeaToolOutput {
  const size = (o: IdeaToolOutput) => JSON.stringify(o).length;
  if (size(output) <= maxChars) return output;
  const out: IdeaToolOutput = { ...output, truncated: true };
  while (size(out) > maxChars) {
    let largest: string | null = null;
    let largestSize = -1;
    for (const [key, value] of Object.entries(out)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      const s = JSON.stringify(value).length;
      if (s > largestSize) { largest = key; largestSize = s; }
    }
    if (largest === null) return { error: "result too large", truncated: true };
    out[largest] = (out[largest] as unknown[]).slice(0, -1);
  }
  return out;
}

type RunResult = (ToolTrace & { name: IdeaToolName }) | { name: null; ok: false; output: IdeaToolOutput };

/**
 * Runs one tool call against the snapshot. Unknown tools and invalid arguments return an error object for the model
 * (never throw); unknown argument keys such as an invented `companyId` are stripped and never read.
 */
export function runIdeaTool(snapshot: IdeaSnapshot, name: string, rawArgs: unknown): RunResult {
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
    return { name: toolName, ok: true, output: capToolOutput(tool.run(snapshot, parsed.data)) };
  } catch {
    return { name: toolName, ok: false, output: { error: "tool failed" } };
  }
}

let catalogHash: string | null = null;
function catalogDigest(): string {
  catalogHash ??= createHash("sha256").update(IDEA_CATALOG.map(i => `${i.id}:${i.title}`).join("|")).digest("hex").slice(0, 12);
  return catalogHash;
}

const countBucket = (n: number): string => (n === 0 ? "0" : n <= 2 ? "1-2" : n <= 5 ? "3-5" : "6+");

/**
 * Stable hash of the inputs that should trigger a new run when they change materially (design doc, Fingerprint):
 * interest buckets above the floor, recent-event count bucket and the leading theme, weekday and time of day by fill,
 * the 4-week upcoming counts as buckets, active weekly theme titles, the month, catalog versions and the algorithm version.
 */
export function ideaFingerprint(snapshot: IdeaSnapshot): string {
  const { summary, signals } = snapshot;
  const cells = trendCells(snapshot);
  const recentSince = signals.now.getTime() - 42 * DAY_MS;
  const canonical = {
    algorithm: IDEA_ALGORITHM_VERSION,
    catalog: catalogDigest(),
    considerations: CONSIDERATION_CATALOG_VERSION,
    month: summary.month,
    dataLevel: summary.dataLevel,
    interests: summary.interests
      .filter(i => i.members >= SUPPRESSION_THRESHOLD)
      .map(i => [i.tagId, bucketFor(i.members)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    recentEvents: countBucket(summary.eligible.filter(e => e.end.getTime() >= recentSince).length),
    leadTheme: leader(cells.byTheme),
    leadWeekday: leader(cells.byWeekday),
    leadDaypart: leader(cells.byDaypart),
    upcoming: summary.busyWeeks.map(w => countBucket(w.events)),
    weeklyThemes: signals.weeklyThemes
      .filter(t => t.endDate.getTime() >= signals.now.getTime())
      .map(t => t.title.trim().toLowerCase())
      .sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}
