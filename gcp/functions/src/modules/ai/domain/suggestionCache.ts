import { createHash } from "node:crypto";
import { z } from "zod";
import { CONSIDERATION_CATALOG_VERSION, CONSIDERATION_IDS } from "./considerations";
import type { SuggestionFacts } from "./suggestions";
import { SUGGESTION_QUESTIONS } from "./suggestions";

/**
 * The saved company-level Dipbot suggestions (companies/{c}/aiCache/suggestions, server-only). One document per company,
 * overwritten on each recompute and shared by every admin. It is reused while its fingerprint matches the company's
 * current data and it is younger than the max age; otherwise it is shown as stale and only an explicit refresh
 * recomputes it. Policy and rationale: docs/ops/ai-events.md.
 */

/** Bump when the question set or the way answers are built changes: it invalidates every saved answer. */
export const SUGGESTION_ALGORITHM_VERSION = 1;
export const DEFAULT_CACHE_MAX_AGE_DAYS = 7;
export const DAY_MS = 24 * 60 * 60_000;
/** A refresh in flight holds the lease this long; a crashed holder is taken over after it. */
export const LEASE_MS = 90_000;

/** Coarse bucket of a count, so a few members or events more do not change the fingerprint. */
export function countBucket(n: number): string {
  if (n <= 0) return "0";
  if (n < 5) return "1-4";
  if (n < 10) return "5-9";
  if (n < 20) return "10-19";
  if (n < 50) return "20-49";
  if (n < 100) return "50-99";
  return "100+";
}

function eventCountBucket(n: number): string {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n < 5) return "2-4";
  if (n < 10) return "5-9";
  if (n < 20) return "10-19";
  if (n < 40) return "20-39";
  return "40+";
}

/** The key of the largest count (ties to the earlier key); null when everything is zero. */
function leader<K extends string>(record: Record<K, number>, keys: readonly K[]): K | null {
  let best: K | null = null;
  let top = 0;
  for (const key of keys) if ((record[key] ?? 0) > top) { best = key; top = record[key]; }
  return best;
}

export interface FingerprintInput {
  facts: SuggestionFacts;
  /** The largest exact interest count (a lower bound of how many members picked interests); bucketed here. */
  maxInterestCount: number;
}

/**
 * Hash of everything the saved answer was derived from, each input reduced to what a reader would call a material
 * change: the interest buckets exactly as the model sees them, the weekly theme, the recent-event stats as a count
 * bucket and the leading value of each dimension, the interested-member count bucket, and the catalog versions.
 */
export function suggestionFingerprint(input: FingerprintInput): string {
  const { facts } = input;
  const past = facts.past && facts.past.total > 0 ? facts.past : null;
  const canonical = {
    v: SUGGESTION_ALGORITHM_VERSION,
    questions: SUGGESTION_QUESTIONS,
    considerations: [CONSIDERATION_CATALOG_VERSION, CONSIDERATION_IDS.length],
    catalog: facts.catalog.map(tag => tag.id).sort(),
    interests: facts.interests.map(i => [i.tagId, i.bucket]),
    members: countBucket(input.maxInterestCount),
    theme: facts.theme ? [facts.theme.title, [...facts.theme.tagIds].sort()] : null,
    past: past && {
      total: eventCountBucket(past.total),
      outdoor: past.outdoor * 2 > past.total,
      budget: leader(past.budget, ["free", "under_15", "from_15_to_50", "over_50"]),
      timing: leader(past.timing, ["weekday_lunch", "after_work", "weekend"]),
      size: leader(past.size, ["small", "team", "company"]),
      tags: Object.entries(past.tags).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([id]) => id),
    },
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

const SuggestionRow = z.object({
  question: z.enum(["interest", "goal", "groupSize", "setting", "budget", "timing"]),
  value: z.string(),
  probability: z.number().min(0).max(1),
  reason: z.string(),
  reasonBasis: z.enum(["company_data", "generic"]).default("generic"),
});

/** The stored document. `computedAt` and `leaseUntil` are Dates (Firestore Timestamps are converted by the store). */
export const CacheSchema = z.object({
  provider: z.enum(["jev", "openai"]),
  suggestions: z.array(SuggestionRow).max(6),
  considerations: z.array(z.object({ id: z.string(), probability: z.number().min(0).max(1) })).max(80).default([]),
  fingerprint: z.string().min(8),
  requestId: z.string().optional(),
});
export type StoredCache = z.infer<typeof CacheSchema> & { computedAt: Date };

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date } | null | undefined;
  return maybe && typeof maybe.toDate === "function" ? maybe.toDate() : null;
};

/** The saved answer, or null when absent or malformed (a bad document is treated as no cache). */
export function readCache(doc: Record<string, unknown> | null | undefined): StoredCache | null {
  if (!doc) return null;
  const parsed = CacheSchema.safeParse(doc);
  const computedAt = toDate(doc.computedAt);
  if (!parsed.success || !computedAt) return null;
  return { ...parsed.data, computedAt };
}

/** A live lease: another request is computing right now. */
export function activeLease(doc: Record<string, unknown> | null | undefined, now: Date): { holder: string } | null {
  const until = toDate(doc?.leaseUntil);
  const holder = typeof doc?.leaseHolder === "string" ? doc.leaseHolder : "";
  return until && holder && until.getTime() > now.getTime() ? { holder } : null;
}

export type CacheState =
  | { status: "fresh" }
  | { status: "stale"; reason: "data" | "age" };

/** Fresh while the fingerprint matches and the answer is younger than `maxAgeMs`; otherwise stale with the reason. */
export function cacheState(cache: StoredCache, fingerprint: string, now: Date, maxAgeMs: number): CacheState {
  if (cache.fingerprint !== fingerprint) return { status: "stale", reason: "data" };
  if (now.getTime() - cache.computedAt.getTime() >= maxAgeMs) return { status: "stale", reason: "age" };
  return { status: "fresh" };
}
