/** Firestore document paths of the AI idea flow (server-owned; clients never read or write them). */
export const aiPaths = {
  settings: (companyId: string) => `companies/${companyId}/aiSettings/current`,
  month: (companyId: string, monthKey: string) => `companies/${companyId}/aiUsage/${monthKey}`,
  day: (companyId: string, dayKey: string, uid: string) => `companies/${companyId}/aiUsageDaily/${dayKey}_${uid}`,
  /** Platform-wide spend of one UTC month, shared by every company (top level, server-owned). */
  platform: (monthKey: string) => `aiUsagePlatform/${monthKey}`,
  request: (companyId: string, uid: string, requestId: string) => `companies/${companyId}/aiRequests/${uid}_${requestId}`,
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
