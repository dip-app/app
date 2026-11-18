import { z } from "zod";
import type { DipbotIdea } from "../../../generated/models";
import { validTimeZone } from "./credits";

/**
 * The saved Dipbot daily ideas of a company (companies/{c}/aiCache/ideas, server-only). One document per company: the
 * ideas of the last successful run, their fingerprint, and the counters that make the refresh policy idempotent
 * (`autoRunDay`, `manualRefreshes`) plus the run lease. Policy and rationale: docs/design/stretch/dipbot-daily-ideas.md.
 */

export const DEFAULT_IDEAS_MAX_AGE_HOURS = 24;
export const DEFAULT_IDEAS_MANUAL_PER_DAY = 3;
export const HOUR_MS = 3_600_000;
/** A run in flight holds the lease this long; a crashed holder is taken over after it. */
export const IDEAS_LEASE_MS = 90_000;

/** Loose shape check of a stored idea: the server wrote it, so only the fields the portal and the replay rely on. */
const StoredIdea = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  theme: z.string(),
  tagIds: z.array(z.string()),
  why: z.string(),
  reasonBasis: z.enum(["company_data", "generic"]),
  fitLabel: z.enum(["perfect", "great", "good"]).optional(),
  weekday: z.number().int().min(1).max(7),
  daypart: z.string(),
  startsAt: z.string(),
  durationMinutes: z.number(),
  costBucket: z.string(),
  groupSize: z.string(),
  considerationIds: z.array(z.string()),
  coverImageURL: z.string(),
  choices: z.object({}).passthrough(),
  draft: z.object({}).passthrough(),
  source: z.enum(["agent", "catalog"]),
}).passthrough();

export type IdeasProvider = "openai" | "demo";

export const IdeasCacheSchema = z.object({
  ideas: z.array(StoredIdea).min(1).max(12),
  fingerprint: z.string().min(8),
  provider: z.enum(["openai", "demo"]),
  model: z.string(),
  tools: z.array(z.string()).max(20).default([]),
  creditsCharged: z.number().int().min(0).default(0),
  rankedBy: z.enum(["jev", "openai", "heuristic"]).default("heuristic"),
  /** Company data level at generation, so a plain visit can answer without reading the company's events. */
  dataLevel: z.enum(["none", "some", "rich"]).default("some"),
  requestId: z.string().optional(),
});

export interface StoredIdeas {
  ideas: DipbotIdea[];
  fingerprint: string;
  provider: IdeasProvider;
  model: string;
  tools: string[];
  creditsCharged: number;
  rankedBy: "jev" | "openai" | "heuristic";
  dataLevel: "none" | "some" | "rich";
  requestId?: string | undefined;
  generatedAt: Date;
  checkedAt: Date;
}

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date } | null | undefined;
  return maybe && typeof maybe.toDate === "function" ? maybe.toDate() : null;
};

/** The stored ideas, or null when absent or malformed (a bad document counts as nothing stored, never an error). */
export function readIdeasCache(doc: Record<string, unknown> | null | undefined): StoredIdeas | null {
  if (!doc) return null;
  const parsed = IdeasCacheSchema.safeParse(doc);
  const generatedAt = toDate(doc.generatedAt);
  if (!parsed.success || !generatedAt) return null;
  const checkedAt = toDate(doc.checkedAt) ?? generatedAt;
  const { ideas, ...rest } = parsed.data;
  return { ...rest, ideas: ideas as unknown as DipbotIdea[], generatedAt, checkedAt };
}

/** Counters that live on the document even when no ideas are stored (a failed run still uses up its day). */
export interface IdeasMeta {
  /** Local day key (YYYYMMDD) of the last automatic model run. */
  autoRunDay: string | null;
  manualRefreshes: { day: string; count: number } | null;
}

const DAY_KEY = /^\d{8}$/;

export function readIdeasMeta(doc: Record<string, unknown> | null | undefined): IdeasMeta {
  const raw = doc?.manualRefreshes as { day?: unknown; count?: unknown } | null | undefined;
  const manual = raw && typeof raw.day === "string" && DAY_KEY.test(raw.day) && typeof raw.count === "number" && Number.isSafeInteger(raw.count) && raw.count >= 0
    ? { day: raw.day, count: raw.count } : null;
  return { autoRunDay: typeof doc?.autoRunDay === "string" && DAY_KEY.test(doc.autoRunDay) ? doc.autoRunDay : null, manualRefreshes: manual };
}

/** Manual refreshes already used on `day`. */
export const manualCountOn = (meta: IdeasMeta, day: string): number => (meta.manualRefreshes?.day === day ? meta.manualRefreshes.count : 0);

/** The later of when the ideas were generated and when an unchanged-inputs check last confirmed them. */
export const lastConfirmedAt = (cache: StoredIdeas): Date => (cache.checkedAt.getTime() > cache.generatedAt.getTime() ? cache.checkedAt : cache.generatedAt);

/** Fresh while the last confirmation is younger than `maxAgeMs`, else stale. */
export function ideasStatus(cache: StoredIdeas, now: Date, maxAgeMs: number): "fresh" | "stale" {
  return now.getTime() - lastConfirmedAt(cache).getTime() < maxAgeMs ? "fresh" : "stale";
}

/** "YYYYMMDD" of `now` in the company's time zone (UTC when unset or invalid). */
export function localDayKey(now: Date, timeZone: string | null): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: validTimeZone(timeZone) ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}`;
}

/**
 * The time-and-history part of the automatic refresh rule: (a) nothing was ever stored, or (b) the stored ideas are older
 * than the max age, and in both cases today's local day has not had an automatic run yet (one per company per day, whatever
 * the outcome). Credits, the dollar budget and a configured model are checked by the caller.
 */
export function autoRefreshDue(input: { cache: StoredIdeas | null; meta: IdeasMeta; now: Date; maxAgeMs: number; timeZone: string | null }): boolean {
  const { cache, meta, now, maxAgeMs, timeZone } = input;
  if (meta.autoRunDay === localDayKey(now, timeZone)) return false;
  return cache === null || ideasStatus(cache, now, maxAgeMs) === "stale";
}
