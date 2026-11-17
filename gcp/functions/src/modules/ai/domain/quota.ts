import type { AiUsageSummary } from "../../../generated/models";
import { AdminError, stored } from "../../admin/domain/errors";
import type { AiSettings } from "../application/ports";

export const RESERVATION_TTL_MS = 5 * 60_000;

export interface PendingReservation { uid: string; micros: number; expiresAt: Date }
export interface MonthState { generations: number; spentMicros: number; pending: Record<string, PendingReservation> }
export interface DayState { generations: number; flags: number }
export interface Limits {
  enabled: boolean;
  monthlyBudgetMicros: number;
  monthlyGenerationLimit: number;
  dailyGenerationLimit: number;
  dailyFlagLimit: number;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function counter(doc: Record<string, unknown>, key: string): number {
  const value = doc[key] ?? 0;
  stored(isCount(value), "AI usage");
  return value;
}

/** Accepts a Date or a Firestore Timestamp-like object. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => unknown }).toDate();
    return date instanceof Date ? date : null;
  }
  return null;
}

export function readMonth(doc: Record<string, unknown> | null, now: Date): MonthState {
  if (doc === null) return { generations: 0, spentMicros: 0, pending: {} };
  const rawPending = doc.pending ?? {};
  stored(typeof rawPending === "object" && rawPending !== null && !Array.isArray(rawPending), "AI usage");
  const pending: Record<string, PendingReservation> = {};
  for (const [key, entry] of Object.entries(rawPending as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { uid, micros } = entry as Record<string, unknown>;
    const expiresAt = toDate((entry as Record<string, unknown>).expiresAt);
    if (typeof uid !== "string" || !isCount(micros) || expiresAt === null || Number.isNaN(expiresAt.getTime())) continue;
    if (expiresAt.getTime() <= now.getTime()) continue;
    pending[key] = { uid, micros, expiresAt };
  }
  return { generations: counter(doc, "generations"), spentMicros: counter(doc, "spentMicros"), pending };
}

export function readDay(doc: Record<string, unknown> | null): DayState {
  if (doc === null) return { generations: 0, flags: 0 };
  return { generations: counter(doc, "generations"), flags: counter(doc, "flags") };
}

/** Deployment limits, narrowed or widened by the company document, which must also opt in (`enabled: true`). */
export function effectiveLimits(settings: AiSettings, companySettings: Record<string, unknown> | null): Limits {
  const override = (key: string): number | null => {
    const value = companySettings?.[key];
    return isCount(value) ? value : null;
  };
  const cents = override("monthlyBudgetCents");
  return {
    enabled: settings.enabled && companySettings?.enabled === true,
    monthlyBudgetMicros: cents === null ? settings.monthlyBudgetMicros : cents * 10_000,
    monthlyGenerationLimit: override("monthlyGenerationLimit") ?? settings.monthlyGenerationLimit,
    dailyGenerationLimit: override("dailyGenerationLimit") ?? settings.dailyGenerationLimit,
    dailyFlagLimit: settings.dailyFlagLimit,
  };
}

function figures(month: MonthState, day: DayState, uid: string, limits: Limits, worstMicros: number) {
  const reservations = Object.values(month.pending);
  const pendingMicros = reservations.reduce((sum, r) => sum + r.micros, 0);
  const myPending = reservations.filter(r => r.uid === uid).length;
  const monthlyRemaining = Math.max(0, limits.monthlyGenerationLimit - month.generations - reservations.length);
  const dailyRemaining = Math.max(0, limits.dailyGenerationLimit - day.generations - myPending);
  const budgetLeft = limits.monthlyBudgetMicros - month.spentMicros - pendingMicros;
  const enough = budgetLeft >= worstMicros;
  const budgetRemaining = !enough ? 0 : worstMicros > 0 ? Math.floor(budgetLeft / worstMicros) : Number.MAX_SAFE_INTEGER;
  return { monthlyRemaining, dailyRemaining, budgetRemaining, enough };
}

export function usageSummary(month: MonthState, day: DayState, uid: string, limits: Limits, worstMicros: number): AiUsageSummary {
  const f = figures(month, day, uid, limits, worstMicros);
  return {
    monthlyGenerationLimit: limits.monthlyGenerationLimit,
    monthlyGenerationsUsed: month.generations,
    dailyGenerationLimit: limits.dailyGenerationLimit,
    dailyGenerationsUsed: day.generations,
    generationsRemaining: limits.enabled ? Math.min(f.monthlyRemaining, f.dailyRemaining, f.budgetRemaining) : 0,
    budgetExhausted: !f.enough,
  };
}

/** Throws when a new reservation would exceed a limit. Does not check `enabled` (the caller does). */
export function checkReservation(month: MonthState, day: DayState, uid: string, limits: Limits, worstMicros: number): void {
  if (day.flags >= limits.dailyFlagLimit) {
    throw new AdminError("resource-exhausted", "AI_FLAG_LIMIT", "Too many notes were declined today. Try again tomorrow.");
  }
  const f = figures(month, day, uid, limits, worstMicros);
  if (f.dailyRemaining <= 0) {
    throw new AdminError("resource-exhausted", "AI_DAILY_LIMIT", "You have used today's idea requests. Try again tomorrow.");
  }
  if (f.monthlyRemaining <= 0) {
    throw new AdminError("resource-exhausted", "AI_MONTHLY_LIMIT", "This company has used this month's idea requests.");
  }
  if (!f.enough) {
    throw new AdminError("resource-exhausted", "AI_BUDGET_EXHAUSTED", "This month's idea budget is used up.");
  }
}

export function monthDocument(month: MonthState): Record<string, unknown> {
  const pending: Record<string, { uid: string; micros: number; expiresAt: Date }> = {};
  for (const [key, r] of Object.entries(month.pending)) pending[key] = { uid: r.uid, micros: r.micros, expiresAt: r.expiresAt };
  return { generations: month.generations, spentMicros: month.spentMicros, pending };
}
