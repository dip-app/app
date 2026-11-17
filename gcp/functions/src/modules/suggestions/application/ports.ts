import type { AiLog, AiSettings, DecisionPort, InterestSource, TagCatalog } from "../../ai/application/ports";
import type { Engine, RankedIdea } from "../domain/rank";
import type { DataLevel, PastEvent, UpcomingEvent, WeeklyThemeInfo } from "../domain/signals";

/** Weekly send time in the company time zone: `weekday` 1 = Monday to 7 = Sunday, `hour` 0 to 23. */
export interface Schedule { weekday: number; hour: number }
export const DEFAULT_SCHEDULE: Schedule = { weekday: 1, hour: 9 };

/** Paths of the server-owned documents of this feature (deny-all rules; Admin SDK only). */
export const suggestionPaths = {
  schedule: (companyId: string) => `companies/${companyId}/suggestionsEmail/settings`,
  digests: (companyId: string) => `companies/${companyId}/suggestionDigests`,
  digest: (companyId: string, weekKey: string) => `companies/${companyId}/suggestionDigests/${weekKey}`,
  emailSettings: (companyId: string) => `emailSettings/${companyId}`,
};

/** Everything the job and the portal need to know about one company, read at once. */
export interface CompanyContext {
  /** `emailSettings/{c}.enabled === true`. */
  emailEnabled: boolean;
  /** Valid IANA zone from `emailSettings/{c}.timeZone`, else null. */
  timeZone: string | null;
  /** Raw `companies/{c}/aiSettings/current` (null when absent), fed to `effectiveLimits`. */
  aiSettings: Record<string, unknown> | null;
  /** `companies/{c}/suggestionsEmail/settings`, null when the admins never changed it. */
  schedule: Schedule | null;
}

/** A finished weekly digest (`companies/{c}/suggestionDigests/{weekKey}`, TTL on `expireAt`). */
export interface StoredDigest {
  weekKey: string;
  weekLabel: string;
  engine: Engine;
  dataLevel: DataLevel;
  dataNote: string | null;
  ideas: RankedIdea[];
  /** Exact interest counts, kept to compute growth about four weeks later. */
  tagCounts: Record<string, number>;
  memberCount: number | null;
  createdAt: Date;
  expireAt: Date;
}

/** Transactional lease on one company-week: first caller builds, the rest reuse the result or wait. */
export type DigestClaim = { kind: "claimed" } | { kind: "ready"; digest: StoredDigest } | { kind: "busy" };

export interface SuggestionsStore {
  /** Ids of companies with `emailSettings/{c}.enabled == true`, at most `limit`. */
  listEmailCompanies(limit: number): Promise<string[]>;
  companyContext(companyId: string): Promise<CompanyContext>;
  /** Active (not deactivated) members with role `admin`. */
  listAdmins(companyId: string): Promise<Array<{ uid: string }>>;
  /** Active members of the company, or null when unknown. */
  memberCount(companyId: string): Promise<number | null>;
  /** Events that started in the last 180 days (malformed documents skipped). */
  pastEvents(companyId: string, now: Date): Promise<PastEvent[]>;
  /** Events starting in the next 28 days, not canceled. */
  upcomingEvents(companyId: string, now: Date): Promise<UpcomingEvent[]>;
  /** Weekly challenge themes running now or starting within the next three weeks. */
  weeklyThemes(companyId: string, now: Date): Promise<WeeklyThemeInfo[]>;
  /** Idea ids shown in the digests of the previous six weeks. */
  recentIdeaIds(companyId: string, weekKey: string): Promise<string[]>;
  /** `tagCounts` of the digest nearest to four weeks before `weekKey` (three to five weeks back), or null. */
  tagCountsAboutFourWeeksAgo(companyId: string, weekKey: string): Promise<Record<string, number> | null>;
  getDigest(companyId: string, weekKey: string): Promise<StoredDigest | null>;
  /** Transaction: none or an expired `building` lease -> `building` with a new lease; `ready` -> that digest; live `building` -> busy. */
  claimDigest(companyId: string, weekKey: string, now: Date, leaseMs: number): Promise<DigestClaim>;
  /** Marks the digest `ready` with its content. */
  finishDigest(companyId: string, weekKey: string, digest: StoredDigest): Promise<void>;
}

/** One decision engine slot. `null` means not configured (no key, or turned off). */
export interface SuggestionEngines { jev: DecisionPort | null; openai: DecisionPort | null }

/** Model ids used to price the worst case of each engine. */
export interface EngineModels { jev: string; openai: string }

/** Shares the company's AI budget (monthly and daily) without counting a generation. */
export interface SuggestionBudget {
  /** Reserves the worst case; false when the feature is off or the budget cannot cover it (nothing is written then). */
  reserve(companyId: string, key: string, worstMicros: number, now: Date): Promise<boolean>;
  /** Drops the reservation and adds the actual spend and tokens (once, not as a generation). */
  settle(companyId: string, key: string, spentMicros: number, tokensIn: number, tokensOut: number, now: Date): Promise<void>;
}

export interface BuildDeps {
  store: SuggestionsStore;
  interests: InterestSource;
  catalog: TagCatalog;
  engines: SuggestionEngines;
  models: EngineModels;
  budget: SuggestionBudget;
  /** Operational log: ids, engine, counts and cost only, never titles. */
  log?: AiLog;
  /** Lease length of a digest build; default five minutes. */
  leaseMs?: number;
}

export interface SuggestionsConfig {
  /** `EMAIL_ENABLED`. */
  emailEnabled: boolean;
  /** `EMAIL_DEFAULT_TIME_ZONE`, used when the company has none. */
  defaultTimeZone: string;
  /** HMAC key for the deep links (`EMAIL_UNSUBSCRIBE_KEY`); a missing or short key disables links. */
  signingKey: string;
  /** `https://letsdip.work`. */
  origin: string;
}

export type { AiSettings };
