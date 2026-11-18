import { z } from "zod";
import type { DipbotIdea } from "../../../generated/models";
import type { CatalogTag } from "../application/ports";
import { THEME_KEYS } from "../../suggestions/domain/catalog";
import type { CompanySignals, CompanySummary } from "../../suggestions/domain/signals";
import { BUDGETS, DAYPARTS, GOALS, GROUP_SIZES, VENUE_TYPES } from "./vocabulary";

/**
 * Shared types and limits of Dipbot daily ideas (docs/design/stretch/dipbot-daily-ideas.md). A tool-using model proposes
 * event ideas from scratch; every tool reads one tenant-scoped snapshot that the server loaded for the caller's own
 * company BEFORE the model runs, so no tool can reach another company whatever the model sends.
 */

/** Hard limits of one ideas run. */
export const IDEA_LIMITS = {
  /** Tool calls per run, all turns together (parallel calls in one turn count one each). */
  maxToolCalls: 6,
  /** Model turns per run, the forced final turn included (the bounded retry is one more). */
  maxTurns: 4,
  /** Whole-run deadline (the agent loop aborts the provider call when it passes). */
  deadlineMs: 25_000,
  /** Serialized JSON size cap of one tool result, in characters; longer results are cut to fewer rows, never mid-JSON. */
  maxToolResultChars: 3000,
  /** Output token ceiling of one model turn. */
  maxOutputTokens: 3000,
  /** Generous input bound of one turn for pricing (instructions + tool results). */
  maxInputTokensPerTurn: 10_000,
  minIdeas: 4,
  maxIdeas: 6,
  /** Ideas are scheduled in the next 4 weeks, at least this many days ahead. */
  horizonDays: 28,
  leadDays: 2,
  /** At most this many ideas share a theme. */
  maxPerTheme: 2,
  titleMax: 80,
  descriptionMax: 400,
  /** Two card lines on desktop; longer model lines are cut at a word boundary. */
  whyMax: 96,
} as const;

export const IDEA_TOOL_NAMES = [
  "getPastEvents", "getTagUsage", "getUpcomingCalendar", "getAttendanceTrends", "getIdeaCatalog", "getAvailableCoverLabels",
] as const;
export type IdeaToolName = (typeof IDEA_TOOL_NAMES)[number];

/**
 * Everything the tools may read, loaded once for the caller's company (companyId from the verified membership). Exact
 * interest counts live in `signals` but tools only ever emit buckets above the privacy floor.
 */
export interface IdeaSnapshot {
  signals: CompanySignals;
  summary: CompanySummary;
  catalogTags: readonly CatalogTag[];
}

/** A tool as the provider sees it: name, description and a strict JSON-schema-able zod object of arguments. */
export interface IdeaToolDefinition {
  name: IdeaToolName;
  description: string;
  /** Arguments schema. Unknown keys (for example a `companyId` the model invents) are stripped, never used. */
  args: z.ZodObject<z.ZodRawShape>;
}

/** What a tool returns to the model: JSON-serializable aggregates only, already size-capped. */
export type IdeaToolOutput = Record<string, unknown>;

/** One executed tool call, kept for grounding (numbers) and the content-free audit (names only). */
export interface ToolTrace { name: IdeaToolName; ok: boolean; output: IdeaToolOutput }

/**
 * The model's final answer: strict structured output. Bounds that OpenAI strict mode cannot express (string lengths,
 * array sizes) are enforced by the server repair step, not here, so a slightly long answer is repaired, not rejected.
 */
export function modelIdeasSchema(catalogTagIds: readonly string[], considerationIds: readonly string[]) {
  const tagId = catalogTagIds.length > 0 ? z.enum(catalogTagIds as [string, ...string[]]) : z.string();
  const consideration = considerationIds.length > 0 ? z.enum(considerationIds as [string, ...string[]]) : z.string();
  const idea = z.object({
    title: z.string().describe("Short, specific event title, at most 8 words."),
    description: z.string().describe("1 to 3 sentences an HR admin could paste into the event."),
    theme: z.enum(THEME_KEYS),
    tagIds: z.array(tagId).describe("1 to 4 catalog tag ids, the theme tag first."),
    goal: z.enum(GOALS),
    weekday: z.number().int().describe("Best day, 1 = Monday to 7 = Sunday."),
    daypart: z.enum(DAYPARTS),
    durationMinutes: z.number().int(),
    costBucket: z.enum(BUDGETS),
    groupSize: z.enum(GROUP_SIZES),
    isOutdoor: z.boolean(),
    venueType: z.enum(VENUE_TYPES),
    venueSearchHint: z.string().describe("Generic search words for a venue, never a business name."),
    why: z.string().describe("One short line (at most 90 characters) on why this fits the company, quoting only numbers that appear in tool results."),
    considerationIds: z.array(consideration).describe("0 to 3 consideration ids that matter for this idea."),
    catalogIdeaId: z.string().nullable().describe("The catalog idea id it was inspired by, or null."),
  }).strict();
  return z.object({ ideas: z.array(idea).describe("4 to 6 ideas across different themes.") }).strict();
}
export type ModelIdeas = z.infer<ReturnType<typeof modelIdeasSchema>>;
export type ModelIdea = ModelIdeas["ideas"][number];

/** What a run produced, before the cache write. `ideas` are final contract objects. */
export interface IdeaRunResult {
  ideas: DipbotIdea[];
  /** Tool names in call order (audit and logs; never arguments or results). */
  tools: IdeaToolName[];
  /** True when the model produced at least one idea that survived validation (charge only then). */
  answered: boolean;
}
