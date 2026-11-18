import type { AiCredits } from "./adminTypes";
import { t, tn } from "./aiStrings";

/** Below this share of the monthly allowance the portal shows a low-credits state. */
export const LOW_CREDITS_SHARE = 0.2;

export type CreditLevel = "ok" | "low" | "out";

export interface CreditsView {
  left: number;
  total: number;
  /** Share of the allowance still left, 0 to 100. */
  pct: number;
  level: CreditLevel;
  /** "Dec 1": the reset day. */
  date: string;
  /** Out of credits for the paid draft actions (fewer left than one run costs). */
  out: boolean;
}

/** "Dec 1" in the viewer's time zone (the reset is local midnight of the company, which is where admins work). */
export function resetDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the first of next month";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
}

export function creditsView(credits: AiCredits, timeZone?: string): CreditsView {
  const left = Math.max(0, credits.creditsRemaining);
  const total = Math.max(0, credits.creditsAllowance);
  const out = left < credits.creditCost.generate;
  const level: CreditLevel = out ? "out" : left < total * LOW_CREDITS_SHARE ? "low" : "ok";
  return { left, total, pct: total > 0 ? Math.min(100, Math.round((left / total) * 100)) : 0, level, date: resetDate(credits.resetsAt, timeZone), out };
}

/** "1 credit" or "10 credits". */
export const creditsText = (n: number) => tn("credits.unit", n);

/** A button label with its price, for example "Generate drafts, 10 credits". */
export function priceLabel(key: "action.generateCost" | "results.regenerateCost", credits: AiCredits): string {
  return t(key, { cost: creditsText(credits.creditCost[key === "action.generateCost" ? "generate" : "regenerate"]) });
}
