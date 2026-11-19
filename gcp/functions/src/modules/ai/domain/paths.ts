/** Firestore document paths of the AI idea flow (server-owned; clients never read or write them). */
export const aiPaths = {
  settings: (companyId: string) => `companies/${companyId}/aiSettings/current`,
  month: (companyId: string, monthKey: string) => `companies/${companyId}/aiUsage/${monthKey}`,
  day: (companyId: string, dayKey: string, uid: string) => `companies/${companyId}/aiUsageDaily/${dayKey}_${uid}`,
  /** Dipbot credits of one calendar month in the company's time zone (ledger: used credits and per-request charges). */
  credits: (companyId: string, period: string) => `companies/${companyId}/aiCredits/${period}`,
  /** Company time zone lives next to the weekly email settings (read only). */
  emailSettings: (companyId: string) => `emailSettings/${companyId}`,
  /** Platform-wide spend of one UTC month, shared by every company (top level, server-owned). */
  platform: (monthKey: string) => `aiUsagePlatform/${monthKey}`,
  /** The saved Dipbot suggestions of the whole company (one document, server-only, shared by every admin). */
  suggestionCache: (companyId: string) => `companies/${companyId}/aiCache/suggestions`,
  /** The saved Dipbot daily ideas of the whole company (one document, server-only, with the run lease and refresh counters). */
  ideasCache: (companyId: string) => `companies/${companyId}/aiCache/ideas`,
  request: (companyId: string, uid: string, requestId: string) => `companies/${companyId}/aiRequests/${uid}_${requestId}`,
  /** Content-free record of one cover pick (provider, source, chosen key); never the event text. */
  coverPick: (companyId: string, uid: string, requestId: string) => `companies/${companyId}/aiCoverPicks/${uid}_${requestId}`,
  /** Cached ranked venue search of one company (24 h; server-only, never the event text). */
  venueSearch: (companyId: string, key: string) => `companies/${companyId}/aiVenueSearches/${key}`,
  /** Provider searches of one company on one UTC day (the daily cap that protects the places quota). */
  venueUsage: (companyId: string, dayKey: string) => `companies/${companyId}/aiVenueUsage/${dayKey}`,
  /** One Suggest theme press (24 h, TTL on expireAt): status, input hash, lease and the validated answer for a replay. Never the hint. */
  themeRequest: (companyId: string, uid: string, requestId: string) => `companies/${companyId}/aiThemeSuggestions/${uid}_${requestId}`,
  /** Suggest theme runs of one company on one UTC day: the company count and a per-admin count (3 days, TTL on expireAt). */
  themeUsage: (companyId: string, dayKey: string) => `companies/${companyId}/aiThemeUsage/${dayKey}`,
};

const two = (value: number) => String(value).padStart(2, "0");

/** "YYYYMM" in UTC. */
export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}`;
}

/** "YYYYMMDD" in UTC. */
export function dayKey(now: Date): string {
  return `${monthKey(now)}${two(now.getUTCDate())}`;
}
