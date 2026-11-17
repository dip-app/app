import type { AiUsageSummary } from "../../../generated/models";
import { AdminError, stored } from "../../admin/domain/errors";
import type { AiSettings } from "../application/ports";

/** The callable times out at 300 s and the run deadline is 240 s; a reservation outlives both so caps never heal mid-run. */
export const RUN_DEADLINE_MS = 240_000;
export const RESERVATION_TTL_MS = 7 * 60_000;

export interface PendingReservation { uid: string; micros: number; expiresAt: Date }
/** Spend and tokens of one UTC day of the month, keyed by "DD" in `MonthState.days`. */
export interface DaySpend { spentMicros: number; inputTokens: number; outputTokens: number }
export interface MonthState {
  generations: number;
  spentMicros: number;
  inputTokens: number;
  outputTokens: number;
  days: Record<string, DaySpend>;
  pending: Record<string, PendingReservation>;
}
export interface DayState { generations: number; flags: number; /** Reservations made today, failed runs included. */ attempts: number }
export interface Limits {
  enabled: boolean;
  monthlyBudgetMicros: number;
  /** Company-wide spend cap per UTC day. */
  dailyBudgetMicros: number;
  monthlyGenerationLimit: number;
  dailyGenerationLimit: number;
  dailyFlagLimit: number;
  dailyAttemptLimit: number;
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

/** "DD" (UTC) key of a date inside the month document's `days` map. */
export const dayOfMonth = (now: Date) => String(now.getUTCDate()).padStart(2, "0");

export const emptyMonth = (): MonthState => ({ generations: 0, spentMicros: 0, inputTokens: 0, outputTokens: 0, days: {}, pending: {} });

function readDays(raw: unknown): Record<string, DaySpend> {
  const value = raw ?? {};
  stored(typeof value === "object" && value !== null && !Array.isArray(value), "AI usage");
  const days: Record<string, DaySpend> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    stored(/^\d{2}$/.test(key) && typeof entry === "object" && entry !== null && !Array.isArray(entry), "AI usage");
    const record = entry as Record<string, unknown>;
    days[key] = { spentMicros: counter(record, "spentMicros"), inputTokens: counter(record, "inputTokens"), outputTokens: counter(record, "outputTokens") };
  }
  return days;
}

/** Live (unexpired, well-formed) reservations of a stored `pending` map. */
function readPending(raw: unknown, now: Date): Record<string, PendingReservation> {
  const rawPending = raw ?? {};
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
  return pending;
}

/** Tolerates documents written before the token and per-day fields existed. */
export function readMonth(doc: Record<string, unknown> | null, now: Date): MonthState {
  if (doc === null) return emptyMonth();
  const pending = readPending(doc.pending, now);
  return {
    generations: counter(doc, "generations"),
    spentMicros: counter(doc, "spentMicros"),
    inputTokens: counter(doc, "inputTokens"),
    outputTokens: counter(doc, "outputTokens"),
    days: readDays(doc.days),
    pending,
  };
}

/** Adds one run's spend and tokens to the month totals and to the "DD" entry of the day it was reserved on. */
export function addSpend(month: MonthState, dd: string, spend: DaySpend): void {
  month.spentMicros += spend.spentMicros;
  month.inputTokens += spend.inputTokens;
  month.outputTokens += spend.outputTokens;
  const before = month.days[dd] ?? { spentMicros: 0, inputTokens: 0, outputTokens: 0 };
  month.days[dd] = {
    spentMicros: before.spentMicros + spend.spentMicros,
    inputTokens: before.inputTokens + spend.inputTokens,
    outputTokens: before.outputTokens + spend.outputTokens,
  };
}

export function readDay(doc: Record<string, unknown> | null): DayState {
  if (doc === null) return { generations: 0, flags: 0, attempts: 0 };
  return { generations: counter(doc, "generations"), flags: counter(doc, "flags"), attempts: counter(doc, "attempts") };
}

/** Deployment limits, narrowed or widened by the company document, which must also opt in (`enabled: true`). */
export function effectiveLimits(settings: AiSettings, companySettings: Record<string, unknown> | null): Limits {
  const override = (key: string): number | null => {
    const value = companySettings?.[key];
    return isCount(value) ? value : null;
  };
  const cents = override("monthlyBudgetCents");
  const dailyCents = override("dailyBudgetCents");
  return {
    enabled: settings.enabled && companySettings?.enabled === true,
    monthlyBudgetMicros: cents === null ? settings.monthlyBudgetMicros : cents * 10_000,
    dailyBudgetMicros: dailyCents === null ? settings.dailyBudgetMicros : dailyCents * 10_000,
    monthlyGenerationLimit: override("monthlyGenerationLimit") ?? settings.monthlyGenerationLimit,
    dailyGenerationLimit: override("dailyGenerationLimit") ?? settings.dailyGenerationLimit,
    dailyFlagLimit: settings.dailyFlagLimit,
    dailyAttemptLimit: settings.dailyAttemptLimit,
  };
}

function figures(month: MonthState, day: DayState, uid: string, limits: Limits, worstMicros: number, now: Date) {
  const reservations = Object.values(month.pending);
  const pendingMicros = reservations.reduce((sum, r) => sum + r.micros, 0);
  const myPending = reservations.filter(r => r.uid === uid).length;
  const monthlyRemaining = Math.max(0, limits.monthlyGenerationLimit - month.generations - reservations.length);
  const dailyRemaining = Math.max(0, limits.dailyGenerationLimit - day.generations - myPending);
  const headroom = (left: number) => (left < worstMicros ? 0 : worstMicros > 0 ? Math.floor(left / worstMicros) : Number.MAX_SAFE_INTEGER);
  const monthBudgetLeft = limits.monthlyBudgetMicros - month.spentMicros - pendingMicros;
  const dayBudgetLeft = limits.dailyBudgetMicros - (month.days[dayOfMonth(now)]?.spentMicros ?? 0) - pendingMicros;
  const monthEnough = monthBudgetLeft >= worstMicros;
  const dayEnough = dayBudgetLeft >= worstMicros;
  return {
    monthlyRemaining, dailyRemaining, monthEnough, dayEnough,
    budgetRemaining: Math.min(headroom(monthBudgetLeft), headroom(dayBudgetLeft)),
  };
}

export function usageSummary(month: MonthState, day: DayState, uid: string, limits: Limits, worstMicros: number, now: Date): AiUsageSummary {
  const f = figures(month, day, uid, limits, worstMicros, now);
  return {
    monthlyGenerationLimit: limits.monthlyGenerationLimit,
    monthlyGenerationsUsed: month.generations,
    dailyGenerationLimit: limits.dailyGenerationLimit,
    dailyGenerationsUsed: day.generations,
    generationsRemaining: limits.enabled ? Math.min(f.monthlyRemaining, f.dailyRemaining, f.budgetRemaining) : 0,
    budgetExhausted: !(f.monthEnough && f.dayEnough),
  };
}

/** Throws when a new reservation would exceed a limit. Does not check `enabled` (the caller does). */
export function checkReservation(month: MonthState, day: DayState, uid: string, limits: Limits, worstMicros: number, now: Date): void {
  if (day.flags >= limits.dailyFlagLimit) {
    throw new AdminError("resource-exhausted", "AI_FLAG_LIMIT", "Too many notes were declined today. Try again tomorrow.");
  }
  if (day.attempts >= limits.dailyAttemptLimit) {
    throw new AdminError("resource-exhausted", "AI_DAILY_LIMIT", "You have used today's idea requests. Try again tomorrow.");
  }
  const f = figures(month, day, uid, limits, worstMicros, now);
  if (f.dailyRemaining <= 0) {
    throw new AdminError("resource-exhausted", "AI_DAILY_LIMIT", "You have used today's idea requests. Try again tomorrow.");
  }
  if (f.monthlyRemaining <= 0) {
    throw new AdminError("resource-exhausted", "AI_MONTHLY_LIMIT", "This company has used this month's idea requests.");
  }
  if (!f.dayEnough) {
    throw new AdminError("resource-exhausted", "AI_BUDGET_EXHAUSTED", "Today's idea budget is used up. Try again tomorrow.");
  }
  if (!f.monthEnough) {
    throw new AdminError("resource-exhausted", "AI_BUDGET_EXHAUSTED", "This month's idea budget is used up.");
  }
}

export function monthDocument(month: MonthState): Record<string, unknown> {
  const pending: Record<string, { uid: string; micros: number; expiresAt: Date }> = {};
  for (const [key, r] of Object.entries(month.pending)) pending[key] = { uid: r.uid, micros: r.micros, expiresAt: r.expiresAt };
  const days: Record<string, DaySpend> = {};
  for (const [key, d] of Object.entries(month.days)) days[key] = { spentMicros: d.spentMicros, inputTokens: d.inputTokens, outputTokens: d.outputTokens };
  return {
    generations: month.generations,
    spentMicros: month.spentMicros,
    inputTokens: month.inputTokens,
    outputTokens: month.outputTokens,
    days,
    pending,
  };
}

/** Platform-wide spend of one UTC month (all companies). Reservations expire like the company ones. */
export interface PlatformState { spentMicros: number; pending: Record<string, PendingReservation> }

export function readPlatform(doc: Record<string, unknown> | null, now: Date): PlatformState {
  if (doc === null) return { spentMicros: 0, pending: {} };
  return { spentMicros: counter(doc, "spentMicros"), pending: readPending(doc.pending, now) };
}

export function platformDocument(state: PlatformState): Record<string, unknown> {
  const pending: Record<string, { uid: string; micros: number; expiresAt: Date }> = {};
  for (const [key, r] of Object.entries(state.pending)) pending[key] = { uid: r.uid, micros: r.micros, expiresAt: r.expiresAt };
  return { spentMicros: state.spentMicros, pending };
}

/** Refuses a reservation that would push the platform past its monthly ceiling (same error as an exhausted company budget). */
export function checkPlatform(state: PlatformState, ceilingMicros: number, worstMicros: number): void {
  const pendingMicros = Object.values(state.pending).reduce((sum, r) => sum + r.micros, 0);
  if (state.spentMicros + pendingMicros + worstMicros > ceilingMicros) {
    throw new AdminError("resource-exhausted", "AI_BUDGET_EXHAUSTED", "This month's idea budget is used up.");
  }
}
