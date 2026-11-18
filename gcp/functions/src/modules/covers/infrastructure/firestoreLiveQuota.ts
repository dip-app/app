import type { LiveQuota, QuotaDenial } from "../application/livePorts";
import { DAY_MS, type FirestoreLike } from "./firestoreTypes";

export const LIVE_USAGE_COLLECTION = "coverLiveUsage";
const WINDOW_MS = 60_000;

export interface LiveQuotaLimits { companyDaily: number; platformDaily: number; instancePerMinute: number }

/** UTC day key, e.g. 2026-11-18. */
export const usageDayKey = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Per-instance sliding window (non-blocking: Pixabay allows 100 requests per minute per key across instances), then
 * transactional daily counters per UTC day. A denial never increments.
 */
export class FirestoreLiveQuota implements LiveQuota {
  private stamps: number[] = [];
  constructor(private readonly db: FirestoreLike, private readonly limits: LiveQuotaLimits) {}

  async tryConsume(companyId: string, now: Date): Promise<QuotaDenial | null> {
    const t = now.getTime();
    this.stamps = this.stamps.filter(s => t - s < WINDOW_MS);
    if (this.stamps.length >= this.limits.instancePerMinute) return "instance_rate";

    const ref = this.db.collection(LIVE_USAGE_COLLECTION).doc(usageDayKey(now));
    const denial = await this.db.runTransaction(async (tx): Promise<QuotaDenial | null> => {
      const snap = await tx.get(ref);
      const d = snap.data();
      const total = typeof d?.total === "number" ? d.total : 0;
      const byCompanyRaw = d?.byCompany;
      const byCompany: Record<string, number> = {};
      if (typeof byCompanyRaw === "object" && byCompanyRaw !== null) {
        for (const [k, v] of Object.entries(byCompanyRaw)) if (typeof v === "number") byCompany[k] = v;
      }
      const mine = byCompany[companyId] ?? 0;
      if (mine >= this.limits.companyDaily) return "company_daily";
      if (total >= this.limits.platformDaily) return "platform_daily";
      byCompany[companyId] = mine + 1;
      tx.set(ref, { total: total + 1, byCompany, expireAt: new Date(t + 3 * DAY_MS) });
      return null;
    });
    if (denial === null) this.stamps.push(t);
    return denial;
  }
}
