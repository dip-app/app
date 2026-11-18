import type { AiCredits } from "../../../generated/models";
import { AdminError, stored } from "../../admin/domain/errors";

/**
 * Dipbot credits: the only unit admins ever see for AI use. A credit is NOT a dollar conversion. Every tool has a fixed
 * price in this table so a cheap call and an expensive one are priced for the value of the action, and provider prices
 * can change without any visible change for admins. Dollar figures, models and token counts stay on the server (the
 * internal budget guard in quota.ts and pricing.ts); they never appear in a response, an audit entry or the portal.
 * The rationale lives in docs/ops/ai-events.md (internal only).
 *
 * To add a tool: add a row here, charge it with `chargeCredits` where the action starts, refund it when no result is
 * produced, and add a price to `creditCost` in the contract only if the UI shows one.
 */
export type CreditTool = "suggestPanel" | "generateDrafts" | "regenerateDrafts" | "weeklyEmail" | "coverPick" | "venueSearch" | "ideas";

export const CREDIT_COSTS: Readonly<Record<CreditTool, number>> = {
  /** One Dipbot Suggest panel visit: the per-step decision calls for the visit (free when cached). */
  suggestPanel: 1,
  /** Three drafts including every safety and fit check. */
  generateDrafts: 10,
  /** A regeneration is a fresh generation, so it costs the same. */
  regenerateDrafts: 10,
  /** The weekly suggested-events email: once per company run, not per admin. */
  weeklyEmail: 3,
  /**
   * "Let Dipbot choose" in the cover picker (pickEventCoverV1): one decision call (two above the per-call option limit),
   * about the size of a Suggest visit. Charged only when a model (Jev or OpenAI) answered; refunded when AI is off or no
   * model answered (provider failure or timeout, lexical fallback, heuristic provider). The covers Dipbot picks for
   * generated drafts are NOT priced here: they ride on the per-draft draftCheck call already covered by generateDrafts.
   */
  coverPick: 1,
  /**
   * Dipbot venue search (findVenuesV1): one places search plus one ranking call. Free when served from the 24 h cache;
   * charged before the search and refunded unless a model (Jev or OpenAI) ranked the results or the search failed.
   */
  venueSearch: 1,
  /**
   * One Dipbot daily ideas run (getDipbotIdeasV1, an automatic daily refresh or the Refresh button): a few cheap model
   * turns over the company's own data tools plus one ranking call. Reserved when the run starts and refunded exactly once
   * when no model idea survives validation (outage, deadline, malformed twice). Loading the page, a replay and an
   * unchanged-inputs check are free.
   */
  ideas: 3,
};

/** About 50 draft generations a month. A company can override it with `monthlyCredits` in its aiSettings document. */
export const DEFAULT_MONTHLY_CREDITS = 500;
/** Charges kept for idempotency per period: far above what an allowance can pay for. */
const MAX_CHARGES = 2000;

export type Doc = Record<string, unknown>;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; } catch { return null; }
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Local wall clock minus UTC, in ms, at an instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** "YYYYMM" of the calendar month `now` falls in, in the company's time zone (UTC when unset or invalid). */
export function creditPeriod(now: Date, timeZone: string | null): string {
  const p = localParts(now, timeZone ?? "UTC");
  return `${p.year}${String(p.month).padStart(2, "0")}`;
}

/** The instant the next calendar month starts in the company's time zone (when the allowance resets). */
export function creditResetAt(now: Date, timeZone: string | null): Date {
  const zone = timeZone ?? "UTC";
  const p = localParts(now, zone);
  const nextLocal = Date.UTC(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 0 : p.month, 1);
  // The offset can differ across the boundary (daylight saving), so refine once at the first guess.
  const first = nextLocal - offsetMs(new Date(nextLocal), zone);
  return new Date(nextLocal - offsetMs(new Date(first), zone));
}

export interface CreditLedger {
  period: string;
  resetsAt: Date;
  allowance: number;
  used: number;
  /** Charge key to credits, so a repeated request is never charged twice and a failed run is refunded exactly once. */
  charges: Record<string, number>;
}

export type ChargeOutcome = "charged" | "duplicate" | "insufficient";

/** The company's allowance: its `monthlyCredits` override when it is a whole number, else the default. */
export function allowanceOf(companySettings: Doc | null): number {
  const value = companySettings?.monthlyCredits;
  return isCount(value) ? value : DEFAULT_MONTHLY_CREDITS;
}

export type LedgerBase = Pick<CreditLedger, "period" | "resetsAt" | "allowance">;

/** The period, reset instant and allowance for `now`: time zone from the weekly email settings, allowance from aiSettings. */
export function ledgerBase(companySettings: Doc | null, emailSettings: Doc | null, now: Date): LedgerBase {
  const timeZone = validTimeZone(emailSettings?.timeZone);
  return { period: creditPeriod(now, timeZone), resetsAt: creditResetAt(now, timeZone), allowance: allowanceOf(companySettings) };
}

/** A ledger from its stored document (null is an empty ledger); a malformed document is an invariant failure. */
export function ledgerFromDoc(base: LedgerBase, ledgerDoc: Doc | null): CreditLedger {
  const charges: Record<string, number> = {};
  const raw = ledgerDoc?.charges ?? {};
  stored(typeof raw === "object" && raw !== null && !Array.isArray(raw), "AI credits");
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    stored(isCount(value), "AI credits");
    charges[key] = value;
  }
  const used = ledgerDoc?.used ?? 0;
  stored(isCount(used), "AI credits");
  return { ...base, used, charges };
}

export const creditsRemaining = (ledger: CreditLedger): number => Math.max(0, ledger.allowance - ledger.used);

/** Charges `credits` under `key` unless the key was already charged or the allowance cannot cover it. Mutates the ledger. */
export function chargeCredits(ledger: CreditLedger, key: string, credits: number): ChargeOutcome {
  if (key in ledger.charges) return "duplicate";
  if (credits > creditsRemaining(ledger) || Object.keys(ledger.charges).length >= MAX_CHARGES) return "insufficient";
  ledger.charges[key] = credits;
  ledger.used += credits;
  return "charged";
}

/** Gives back a charge exactly once (the key is removed). Returns whether anything was refunded. */
export function refundCredits(ledger: CreditLedger, key: string): boolean {
  const credits = ledger.charges[key];
  if (credits === undefined) return false;
  delete ledger.charges[key];
  ledger.used = Math.max(0, ledger.used - credits);
  return true;
}

export function ledgerDocument(ledger: CreditLedger): Doc {
  return { period: ledger.period, used: ledger.used, charges: { ...ledger.charges } };
}

/** What the client may see: whole credits, the reset instant and the fixed per-tool prices. No dollars, tokens or models. */
export function creditsSummary(ledger: CreditLedger): AiCredits {
  return {
    creditsAllowance: ledger.allowance,
    creditsUsed: ledger.used,
    creditsRemaining: creditsRemaining(ledger),
    resetsAt: ledger.resetsAt.toISOString(),
    creditCost: {
      suggest: CREDIT_COSTS.suggestPanel,
      generate: CREDIT_COSTS.generateDrafts,
      regenerate: CREDIT_COSTS.regenerateDrafts,
      weeklyEmail: CREDIT_COSTS.weeklyEmail,
      coverPick: CREDIT_COSTS.coverPick,
      venueSearch: CREDIT_COSTS.venueSearch,
      ideas: CREDIT_COSTS.ideas,
    },
  };
}

/** AI_CREDITS_EXHAUSTED carries the zero balance and the reset instant for the portal (never a dollar figure). */
export function creditsExhausted(ledger: CreditLedger): AdminError {
  return new AdminError(
    "resource-exhausted", "AI_CREDITS_EXHAUSTED", "This company has used this month's Dipbot credits.", [],
    { creditsRemaining: creditsRemaining(ledger), resetsAt: ledger.resetsAt.toISOString() },
  );
}
